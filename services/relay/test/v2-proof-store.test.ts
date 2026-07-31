import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ProtocolV2ProofStore } from "../src/v2/proof-store.js";

const fixture = JSON.parse(
  await readFile(new URL("../../../packages/protocol/fixtures/protocol-v2-hpke.json", import.meta.url), "utf8"),
) as { envelope: Record<string, unknown> };

test("retains ciphertext-only envelopes, rejects duplicates, and expires after seven days", () => {
  const store = new ProtocolV2ProofStore();
  const now = Date.parse("2026-07-18T12:00:00Z");
  assert.equal(store.put("inbox_primary", fixture.envelope, now), "inserted");
  assert.equal(store.put("inbox_primary", fixture.envelope, now + 1), "duplicate");
  const raw = JSON.stringify(store.inspectRaw("inbox_primary"));
  for (const plaintext of ["MacBook builds", "Run release tests", "All 184 tests passed", "succeeded"]) {
    assert.equal(raw.includes(plaintext), false);
  }
  assert.equal(store.list("inbox_primary", now).length, 1);
  assert.equal(store.list("inbox_primary", now + ProtocolV2ProofStore.retentionMilliseconds + 1).length, 0);
});

test("drops corrupt retained rows while returning valid encrypted history", () => {
  const store = new ProtocolV2ProofStore();
  const now = Date.parse("2026-07-18T12:00:00Z");
  store.put("inbox_primary", fixture.envelope, now);
  store.injectCorruptRowForTest("inbox_primary", {
    eventId: "018f6f18-7f2f-7d3d-a932-70a79fbe31a5",
    acceptedAt: now,
    envelopeJson: "{not-json",
  });
  assert.deepEqual(store.list("inbox_primary", now), [fixture.envelope]);
  assert.equal(store.inspectRaw("inbox_primary").length, 1);
});

test("keeps only the newest one hundred encrypted envelopes", () => {
  const store = new ProtocolV2ProofStore();
  const now = Date.parse("2026-07-18T12:00:00Z");
  for (let index = 0; index < 101; index += 1) {
    const suffix = index.toString(16).padStart(12, "0");
    store.put("inbox_primary", {
      ...fixture.envelope,
      eventId: `018f6f18-7f2f-7d3d-a932-${suffix}`,
    }, now + index);
  }
  const rows = store.inspectRaw("inbox_primary");
  assert.equal(rows.length, 100);
  assert.equal(rows[0]?.eventId, "018f6f18-7f2f-7d3d-a932-000000000001");
});
