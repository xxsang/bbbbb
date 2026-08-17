import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { ProtocolV2Envelope } from "@bbbbbapp/protocol";
import { MemoryV2SourceStore } from "../src/v2/memory-source-store.js";
import { V2_DAY_MS, V2_ROLLING_WINDOW_MS, v2TierPolicy, type V2Source, type V2TierPolicy } from "../src/v2/source-store.js";

const fixture = JSON.parse(
  await readFile(new URL("../../../packages/protocol/fixtures/protocol-v2-hpke.json", import.meta.url), "utf8"),
) as { envelope: ProtocolV2Envelope };

const inboxId = fixture.envelope.inboxId;
const base = Date.parse("2026-07-01T00:00:00Z");
const source = (sourceId: string): V2Source => ({
  sourceId,
  inboxId,
  name: sourceId,
  method: "cli",
  credentialHash: "hash",
  enabled: true,
  createdAt: base,
  updatedAt: base,
  lastSuccessAt: null,
});
const sources = [source("source_alpha"), source("source_beta")];
const envelope = (index: number, sourceId = sources[index % sources.length]!.sourceId): ProtocolV2Envelope => ({
  ...fixture.envelope,
  eventId: `018f6f18-7f2f-7d3d-a932-${index.toString(16).padStart(12, "0")}`,
  sourceId,
});

function storeWithSources() {
  const store = new MemoryV2SourceStore();
  store.inboxes.set(inboxId, { inboxId, publicKey: "public", readCredentialHash: "hash", createdAt: base });
  for (const value of sources) store.sources.set(value.sourceId, value);
  return store;
}

test("Free rolling allowance aggregates across Sources without a daily cap", async () => {
  const rollingStore = storeWithSources();
  const free = v2TierPolicy("free");
  for (let index = 0; index < 1_000; index += 1) {
    const acceptedAt = base + index;
    assert.equal((await rollingStore.putEvent(sources[index % 2]!, envelope(index), acceptedAt, free)).kind, "inserted");
  }
  assert.deepEqual(await rollingStore.putEvent(sources[1]!, envelope(1_000, sources[1]!.sourceId), base + 1_000, free), {
    kind: "quota_exceeded",
    scope: "rolling_30_days",
    retryAt: base + V2_ROLLING_WINDOW_MS,
  });
});

test("duplicates do not consume accepted usage and rolling capacity releases at the exact boundary", async () => {
  const store = storeWithSources();
  const small = { ...v2TierPolicy("free"), rolling30Days: 2 } satisfies V2TierPolicy;
  assert.equal((await store.putEvent(sources[0]!, envelope(1, sources[0]!.sourceId), base, small)).kind, "inserted");
  assert.equal((await store.putEvent(sources[1]!, envelope(1, sources[1]!.sourceId), base + 1, small)).kind, "duplicate");
  assert.equal((await store.putEvent(sources[1]!, envelope(2, sources[1]!.sourceId), base + 2, small)).kind, "inserted");
  assert.equal((await store.putEvent(sources[0]!, envelope(3, sources[0]!.sourceId), base + 3, small)).kind, "quota_exceeded");
  assert.equal((await store.putEvent(sources[0]!, envelope(3, sources[0]!.sourceId), base + V2_ROLLING_WINDOW_MS, small)).kind, "inserted");
});

test("event and Source deletion or replacement do not refund usage, while Inbox deletion removes it", async () => {
  const store = storeWithSources();
  const one = { ...v2TierPolicy("free"), rolling30Days: 1 } satisfies V2TierPolicy;
  assert.equal((await store.putEvent(sources[0]!, envelope(1, sources[0]!.sourceId), base, one)).kind, "inserted");
  await store.deleteEvents(inboxId);
  await store.deleteSource(sources[0]!.sourceId);
  const replacement = source("source_replacement");
  store.sources.set(replacement.sourceId, replacement);
  assert.equal((await store.putEvent(replacement, envelope(2, replacement.sourceId), base + 1, one)).kind, "quota_exceeded");
  assert.equal(store.usage.get(inboxId)?.size, 1);
  await store.deleteInbox(inboxId);
  assert.equal(store.usage.has(inboxId), false);
});

test("Free and Plus retention caps do not erase 30-day accounting", async () => {
  for (const [tier, count, retained] of [["free", 101, 100], ["plus", 501, 500]] as const) {
    const store = storeWithSources();
    const policy = v2TierPolicy(tier);
    for (let index = 0; index < count; index += 1) {
      const acceptedAt = base + index;
      assert.equal((await store.putEvent(sources[index % 2]!, envelope(index), acceptedAt, policy)).kind, "inserted");
    }
    const now = base + count - 1;
    assert.equal((await store.listEvents(inboxId, now, policy)).length, retained);
    assert.equal((await store.getUsage(inboxId, now, policy)).rolling30Days.accepted, count);
  }
});

test("Plus retains encrypted recovery beyond Free's seven-day window", async () => {
  const store = storeWithSources();
  const plus = v2TierPolicy("plus");
  assert.equal((await store.putEvent(sources[0]!, envelope(1, sources[0]!.sourceId), base, plus)).kind, "inserted");
  assert.equal((await store.listEvents(inboxId, base + 8 * V2_DAY_MS, plus)).length, 1);
  assert.equal((await store.listEvents(inboxId, base + 8 * V2_DAY_MS, v2TierPolicy("free"))).length, 0);
});

test("downgraded usage remains reportable while Free admission stays blocked", async () => {
  const store = storeWithSources();
  const plus = v2TierPolicy("plus");
  for (let index = 0; index < 1_001; index += 1) {
    assert.equal((await store.putEvent(sources[index % 2]!, envelope(index), base + index, plus)).kind, "inserted");
  }

  const free = v2TierPolicy("free");
  const usage = await store.getUsage(inboxId, base + 2_000, free);
  assert.equal(usage.tier, "free");
  assert.equal(usage.rolling30Days.accepted, 1_001);
  assert.equal((await store.putEvent(sources[0]!, envelope(1_002), base + 2_001, free)).kind, "quota_exceeded");
});
