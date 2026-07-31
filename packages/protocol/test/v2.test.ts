import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalizeProtocolV2Event,
  allowsProtocolV2HistoryRead,
  generateProtocolV2KeyPair,
  normalizeHttpV2Input,
  openProtocolV2Envelope,
  sealProtocolV2Event,
  validateProtocolV2Envelope,
  type ProtocolV2Envelope,
  type ProtocolV2Event,
} from "../src/index.js";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/protocol-v2-hpke.json", import.meta.url), "utf8"),
) as {
  recipient: { publicKey: string; privateKey: string };
  event: ProtocolV2Event;
  envelope: ProtocolV2Envelope;
};

test("the deterministic Protocol 2 HPKE fixture opens", async () => {
  assert.deepEqual(await openProtocolV2Envelope(fixture.envelope, fixture.recipient.privateKey), fixture.event);
});

test("both generic categories and bounded scalar details validate", () => {
  for (const category of ["attention", "activity"] as const) {
    assert.equal(canonicalizeProtocolV2Event({ ...fixture.event, category }).category, category);
  }
  assert.deepEqual(
    canonicalizeProtocolV2Event({ ...fixture.event, details: { z: true, a: 1, m: "value" } }).details,
    { a: 1, m: "value", z: true },
  );
});

test("HTTP defaults to neutral activity and authenticates its Source method", () => {
  const supplied = {
    eventId: fixture.event.eventId,
    sourceId: fixture.event.sourceId,
    source: fixture.event.source,
    sourceMethod: "http" as const,
    occurredAt: fixture.event.occurredAt,
  };
  const http = normalizeHttpV2Input({}, supplied);
  assert.equal(http.category, "activity");
  assert.equal(http.label, "Update");
  assert.equal(http.sourceMethod, "http");
});

test("HTTP-sealed and CLI-sealed inputs preserve distinct authenticated Source methods", async () => {
  const supplied = {
    eventId: fixture.event.eventId,
    sourceId: fixture.event.sourceId,
    source: fixture.event.source,
    occurredAt: fixture.event.occurredAt,
  };
  const input = { category: "activity", label: "Started", work: fixture.event.work, message: fixture.event.message, details: fixture.event.details };
  const httpEvent = normalizeHttpV2Input(input, { ...supplied, sourceMethod: "http" });
  const cliEvent = canonicalizeProtocolV2Event({ version: 2, ...supplied, sourceMethod: "cli", ...input });
  const [httpEnvelope, cliEnvelope] = await Promise.all([
    sealProtocolV2Event(httpEvent, fixture.envelope.inboxId, fixture.recipient.publicKey),
    sealProtocolV2Event(cliEvent, fixture.envelope.inboxId, fixture.recipient.publicKey),
  ]);
  assert.deepEqual(await openProtocolV2Envelope(httpEnvelope, fixture.recipient.privateKey), httpEvent);
  assert.deepEqual(await openProtocolV2Envelope(cliEnvelope, fixture.recipient.privateKey), cliEvent);
  assert.notEqual(httpEvent.sourceMethod, cliEvent.sourceMethod);
});

test("unknown fields, invalid details, byte overflow, and protocol 1 are rejected", () => {
  const invalid = [
    { ...fixture.event, version: 1 },
    { ...fixture.event, action: { label: "Open", url: "https://example.com" } },
    { ...fixture.event, sourceMethod: "socket" },
    { ...fixture.event, details: { nested: { no: true } } },
    { ...fixture.event, details: { null: null } },
    { ...fixture.event, details: { infinite: Number.POSITIVE_INFINITY } },
    { ...fixture.event, work: "x".repeat(201) },
    { ...fixture.event, occurredAt: "2026-02-31T10:42:00Z" },
    { ...fixture.event, details: Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`k${index}`, index])) },
  ];
  for (const value of invalid) assert.throws(() => canonicalizeProtocolV2Event(value));
  assert.throws(() => validateProtocolV2Envelope({ version: 1, eventId: fixture.event.eventId, nonce: "x", ciphertext: "x" }));
});

test("byte limits are UTF-8 based and fractional RFC 3339 timestamps are accepted", () => {
  assert.equal(canonicalizeProtocolV2Event({ ...fixture.event, source: "界".repeat(26) }).source, "界".repeat(26));
  assert.throws(() => canonicalizeProtocolV2Event({ ...fixture.event, source: "界".repeat(27) }));
  assert.equal(canonicalizeProtocolV2Event({ ...fixture.event, occurredAt: "2026-07-18T10:42:00.123Z" }).occurredAt, "2026-07-18T10:42:00.123Z");
});

test("authenticated inbox, Source, event, suite, and ciphertext metadata reject tampering", async () => {
  const variants = [
    { ...fixture.envelope, inboxId: "inbox_other" },
    { ...fixture.envelope, sourceId: "source_other" },
    { ...fixture.envelope, eventId: "018f6f18-7f2f-7d3d-a932-70a79fbe31a5" },
    { ...fixture.envelope, suite: "other-suite" },
    { ...fixture.envelope, ciphertext: `A${fixture.envelope.ciphertext.slice(1)}` },
  ];
  for (const value of variants) {
    await assert.rejects(openProtocolV2Envelope(value, fixture.recipient.privateKey));
  }
});

test("public key alone seals but cannot read or decrypt retained events", async () => {
  const sealed = await sealProtocolV2Event(fixture.event, fixture.envelope.inboxId, fixture.recipient.publicKey);
  assert.deepEqual(await openProtocolV2Envelope(sealed, fixture.recipient.privateKey), fixture.event);
  await assert.rejects(openProtocolV2Envelope(sealed, fixture.recipient.publicKey));
  const unrelated = await generateProtocolV2KeyPair();
  await assert.rejects(openProtocolV2Envelope(sealed, unrelated.privateKey));
});

test("a Source write capability is structurally separate from inbox history authority", () => {
  const sourceCapability = {
    kind: "source-write",
    inboxId: fixture.envelope.inboxId,
    sourceId: fixture.event.sourceId,
    source: fixture.event.source,
    inboxPublicKey: fixture.recipient.publicKey,
    writeCredential: "write-only-secret",
  } as const;
  assert.equal(allowsProtocolV2HistoryRead(sourceCapability), false);
  assert.equal("privateKey" in sourceCapability, false);
  assert.equal("readCredential" in sourceCapability, false);
  assert.equal(allowsProtocolV2HistoryRead({
    kind: "inbox-read",
    inboxId: fixture.envelope.inboxId,
    readCredential: "read-secret",
  }), true);
});
