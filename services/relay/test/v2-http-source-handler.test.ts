import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  generateProtocolV2KeyPair,
  openProtocolV2Envelope,
  sealProtocolV2Event,
  type ProtocolV2Envelope,
} from "@bbbbbapp/protocol";
import { createV2HttpSourceHandler } from "../src/v2/http-source-handler.js";
import { MemoryV2SourceStore } from "../src/v2/memory-source-store.js";

const relay = "https://relay.example";
const inboxId = "inbox_primary_0001";
const readCredential = "read_credential_that_is_long_enough_0001";
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");

async function harness() {
  const store = new MemoryV2SourceStore();
  const logs: Record<string, unknown>[] = [];
  const notifications: string[] = [];
  const deferred: Promise<void>[] = [];
  let now = Date.parse("2026-07-19T08:00:00Z");
  const handler = createV2HttpSourceHandler({
    store,
    now: () => now,
    randomBytes: (length) => randomBytes(length),
    randomUUID,
    hash: async (value) => digest(value),
    equal: (left, right) => left === right,
    validateTransferRecipientKey: async (value) => value === "K".repeat(600),
    encryptTransferURL: async (_recipientPublicKey, sourceURL) => Buffer.from(sourceURL).toString("base64url"),
    notify: async (id) => { notifications.push(id); },
    defer: (promise) => { deferred.push(promise); },
    log: (entry) => { logs.push(entry); },
  });
  const request = (path: string, init: RequestInit = {}) => handler(new Request(`${relay}${path}`, init));
  const keys = await generateProtocolV2KeyPair();
  const inboxResponse = await request("/v2/inboxes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inboxId, publicKey: keys.publicKey, readCredential }) });
  assert.equal(inboxResponse.status, 201);
  return { store, logs, notifications, deferred, keys, request, setNow: (value: number) => { now = value; } };
}

async function createCliSource(value: Awaited<ReturnType<typeof harness>>) {
  const sessionResponse = await value.request("/v2/cli-sources/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName: "Encrypted builds" }) });
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json() as { sessionId: string; setupSecret: string; claimURL: string };
  const claimSecret = new URL(session.claimURL).searchParams.get("secret");
  assert.ok(claimSecret);
  const claimResponse = await value.request(`/v2/add-source/sessions/${session.sessionId}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimSecret }) });
  assert.equal(claimResponse.status, 200);
  assert.equal((await claimResponse.json() as { method: string }).method, "cli");
  const approval = await value.request(`/v2/add-source/sessions/${session.sessionId}/approve`, { method: "POST", headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" }, body: JSON.stringify({ inboxId, claimSecret }) });
  assert.equal(approval.status, 204);
  assert.equal(approval.headers.get("cache-control"), "no-store");
  assert.match(approval.headers.get("x-bbbbb-source-id") ?? "", /^[A-Za-z0-9_-]{16,128}$/u);
  assert.equal(await approval.text(), "");
  const response = await value.request(`/v2/add-source/sessions/${session.sessionId}`, { headers: { authorization: `Bearer ${session.setupSecret}` } });
  assert.equal(response.status, 200);
  return await response.json() as {
    source: { sourceId: string; name: string; method: string };
    profile: { version: number; relay: string; inboxId: string; sourceId: string; source: string; inboxPublicKey: string; writeCredential: string };
  };
}

async function createSource(value: Awaited<ReturnType<typeof harness>>) {
  const sessionResponse = await value.request("/v2/add-source/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName: "MacBook builds" }) });
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json() as { sessionId: string; setupSecret: string; claimURL: string; code: string };
  const claimURL = new URL(session.claimURL);
  const claimSecret = claimURL.searchParams.get("secret");
  assert.ok(claimSecret);
  const claim = await value.request(`/v2/add-source/sessions/${session.sessionId}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimSecret }) });
  assert.equal(claim.status, 200);
  const claimed = await claim.json() as Record<string, unknown>;
  assert.deepEqual({ ...claimed, expiresAt: "<bounded>" }, {
    version: 2,
    sessionId: session.sessionId,
    sourceName: "MacBook builds",
    method: "http",
    trust: "This Source can send activity to your private inbox.",
    expiresAt: "<bounded>",
  });
  const sourceCountBeforeApproval = value.store.sources.size;
  const approval = await value.request(`/v2/add-source/sessions/${session.sessionId}/approve`, { method: "POST", headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" }, body: JSON.stringify({ inboxId, claimSecret }) });
  assert.equal(approval.status, 204);
  const pendingSourceId = approval.headers.get("x-bbbbb-source-id");
  assert.match(pendingSourceId ?? "", /^[A-Za-z0-9_-]{16,128}$/u);
  assert.equal(approval.headers.get("cache-control"), "no-store");
  assert.equal(await approval.text(), "");
  assert.equal(value.store.sources.size, sourceCountBeforeApproval);
  assert.equal(value.store.sessions.get(session.sessionId)?.sourceId, pendingSourceId);
  const handoff = await value.request(`/v2/add-source/sessions/${session.sessionId}`, { headers: { authorization: `Bearer ${session.setupSecret}` } });
  assert.equal(handoff.status, 200);
  const result = await handoff.json() as { sourceURL: string; source: { sourceId: string; name: string } };
  assert.equal(result.source.name, "MacBook builds");
  assert.equal((await value.request(`/v2/add-source/sessions/${session.sessionId}`, { headers: { authorization: `Bearer ${session.setupSecret}` } })).status, 200);
  return { ...result, session };
}

test("five-minute session claims, approves, and issues one hash-only HTTP Source URL", async () => {
  const value = await harness();
  const created = await createSource(value);
  const raw = JSON.stringify({ sources: [...value.store.sources.values()], sessions: [...value.store.sessions.values()] });
  const credential = new URL(created.sourceURL).searchParams.get("key");
  assert.ok(credential);
  assert.equal(raw.includes(credential), false);
  assert.equal(value.logs.some((entry) => JSON.stringify(entry).includes(credential)), false);
  const second = await value.request(`/v2/add-source/sessions/${created.session.sessionId}`, { headers: { authorization: `Bearer ${created.session.setupSecret}` } });
  assert.deepEqual(await second.json(), { version: 2, state: "consumed", expiresAt: "2026-07-19T08:05:00.000Z" });
});

test("approval reveals only one pending Source ID and concurrent collection creates one Source", async () => {
  const value = await harness();
  const sessionResponse = await value.request("/v2/add-source/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceName: "Concurrent requester" }),
  });
  const session = await sessionResponse.json() as {
    sessionId: string;
    setupSecret: string;
    claimURL: string;
  };
  const claimSecret = new URL(session.claimURL).searchParams.get("secret");
  assert.ok(claimSecret);
  const approval = await value.request(`/v2/add-source/sessions/${session.sessionId}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${readCredential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ inboxId, claimSecret }),
  });
  const pendingSourceId = approval.headers.get("x-bbbbb-source-id");
  assert.match(pendingSourceId ?? "", /^[A-Za-z0-9_-]{16,128}$/u);
  assert.equal(value.store.sources.size, 0);

  const polls = await Promise.all([
    value.request(`/v2/add-source/sessions/${session.sessionId}`, {
      headers: { authorization: `Bearer ${session.setupSecret}` },
    }),
    value.request(`/v2/add-source/sessions/${session.sessionId}`, {
      headers: { authorization: `Bearer ${session.setupSecret}` },
    }),
  ]);
  const bodies = await Promise.all(polls.map((response) => response.text()));
  assert.equal(bodies.filter((body) => body.includes("\"sourceURL\"")).length, 1);
  assert.equal(value.store.sources.size, 1);
  assert.ok(pendingSourceId);
  assert.equal((await value.store.getSource(pendingSourceId))?.sourceId, pendingSourceId);

  const serialized = JSON.stringify({
    logs: value.logs,
    sessions: [...value.store.sessions.values()],
    sources: [...value.store.sources.values()],
  });
  const completed = bodies.find((body) => body.includes("\"sourceURL\""));
  assert.ok(completed);
  const credential = new URL((JSON.parse(completed) as { sourceURL: string }).sourceURL)
    .searchParams.get("key");
  assert.ok(credential);
  assert.equal(serialized.includes(credential), false);
});

test("failed, expired, cancelled, replayed, and rate-limited requests never reveal a Source ID", async () => {
  const value = await harness();
  const create = async (name: string) => {
    const response = await value.request("/v2/add-source/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName: name }),
    });
    return await response.json() as {
      sessionId: string;
      setupSecret: string;
      claimURL: string;
    };
  };

  const wrong = await create("Wrong approval");
  const wrongSecret = new URL(wrong.claimURL).searchParams.get("secret");
  assert.ok(wrongSecret);
  const unauthorized = await value.request(`/v2/add-source/sessions/${wrong.sessionId}/approve`, {
    method: "POST",
    headers: {
      authorization: "Bearer wrong_credential_that_is_long_enough_0001",
      "content-type": "application/json",
    },
    body: JSON.stringify({ inboxId, claimSecret: wrongSecret }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("x-bbbbb-source-id"), null);

  const cancelled = await create("Cancelled approval");
  assert.equal((await value.request(`/v2/add-source/sessions/${cancelled.sessionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${cancelled.setupSecret}` },
  })).status, 204);
  const cancelledApproval = await value.request(`/v2/add-source/sessions/${cancelled.sessionId}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${readCredential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inboxId,
      claimSecret: new URL(cancelled.claimURL).searchParams.get("secret"),
    }),
  });
  assert.equal(cancelledApproval.status, 404);
  assert.equal(cancelledApproval.headers.get("x-bbbbb-source-id"), null);

  const expired = await create("Expired approval");
  value.setNow(Date.parse("2026-07-19T08:05:00.001Z"));
  const expiredApproval = await value.request(`/v2/add-source/sessions/${expired.sessionId}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${readCredential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      inboxId,
      claimSecret: new URL(expired.claimURL).searchParams.get("secret"),
    }),
  });
  assert.equal(expiredApproval.status, 404);
  assert.equal(expiredApproval.headers.get("x-bbbbb-source-id"), null);

  value.setNow(Date.parse("2026-07-19T08:00:00Z"));
  const replayed = await create("Replay approval");
  const replaySecret = new URL(replayed.claimURL).searchParams.get("secret");
  assert.ok(replaySecret);
  const approvalInit = {
    method: "POST",
    headers: {
      authorization: `Bearer ${readCredential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ inboxId, claimSecret: replaySecret }),
  };
  const firstApproval = await value.request(
    `/v2/add-source/sessions/${replayed.sessionId}/approve`,
    approvalInit
  );
  assert.equal(firstApproval.status, 204);
  assert.ok(firstApproval.headers.get("x-bbbbb-source-id"));
  const replayApproval = await value.request(
    `/v2/add-source/sessions/${replayed.sessionId}/approve`,
    approvalInit
  );
  assert.equal(replayApproval.status, 409);
  assert.equal(replayApproval.headers.get("x-bbbbb-source-id"), null);

  let rateLimited: Response | undefined;
  for (let index = 0; index < 9; index += 1) {
    rateLimited = await value.request("/v2/add-source/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName: `Rate limit ${index}` }),
    });
  }
  assert.equal(rateLimited?.status, 429);
  assert.equal(rateLimited?.headers.get("x-bbbbb-source-id"), null);
});

test("CLI Source approval issues one write-only public-key profile and accepts only sealed events", async () => {
  const value = await harness();
  const created = await createCliSource(value);
  assert.equal(created.source.method, "cli");
  assert.deepEqual({ ...created.profile, inboxPublicKey: "<public>", writeCredential: "<secret>" }, {
    version: 2,
    relay,
    inboxId,
    sourceId: created.source.sourceId,
    source: "Encrypted builds",
    inboxPublicKey: "<public>",
    writeCredential: "<secret>",
  });
  assert.equal(created.profile.inboxPublicKey, value.keys.publicKey);
  const stored = JSON.stringify({ sources: [...value.store.sources.values()], sessions: [...value.store.sessions.values()] });
  assert.equal(stored.includes(created.profile.writeCredential), false);
  assert.equal("readCredential" in created.profile, false);
  assert.equal("privateKey" in created.profile, false);

  const event = {
    version: 2,
    eventId: "018f6f18-7f2f-7d3d-a932-70a79fbe31a4",
    sourceId: created.profile.sourceId,
    source: created.profile.source,
    sourceMethod: "cli",
    category: "activity",
    label: "Succeeded",
    occurredAt: "2026-07-19T08:00:00.000Z",
    work: "Run encrypted checks",
    message: "All checks passed",
  } as const;
  const envelope = await sealProtocolV2Event(event, inboxId, created.profile.inboxPublicKey);
  const sourcePath = `/v2/sources/${created.profile.sourceId}/events`;
  const headers = { authorization: `Bearer ${created.profile.writeCredential}`, "content-type": "application/json" };
  assert.equal((await value.request(sourcePath, { headers })).status, 204);
  const accepted = await value.request(sourcePath, { method: "POST", headers, body: JSON.stringify(envelope) });
  assert.deepEqual(await accepted.json(), { accepted: true, duplicate: false, eventId: event.eventId });
  const duplicate = await value.request(sourcePath, { method: "POST", headers, body: JSON.stringify(envelope) });
  assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true, eventId: event.eventId });
  assert.equal((await value.request(sourcePath, { method: "POST", headers, body: JSON.stringify({ work: event.work }) })).status, 400);
  const retained = JSON.stringify([...value.store.events.values()].map((events) => [...events.values()]));
  assert.equal(retained.includes(event.work), false);
  assert.equal(retained.includes(event.message), false);
  const history = await value.request(`/v2/inboxes/${inboxId}/events`, { headers: { authorization: `Bearer ${readCredential}` } });
  const decoded = await Promise.all(((await history.json()) as { events: ProtocolV2Envelope[] }).events.map((item) => openProtocolV2Envelope(item, value.keys.privateKey)));
  assert.deepEqual(decoded, [event]);

  const testPath = `/v2/inboxes/${inboxId}/sources/${created.source.sourceId}/test`;
  assert.equal((await value.request(testPath, { method: "POST", headers: { authorization: `Bearer ${readCredential}` } })).status, 202);
  const afterTest = await value.request(`/v2/inboxes/${inboxId}/events`, { headers: { authorization: `Bearer ${readCredential}` } });
  const tested = await Promise.all(((await afterTest.json()) as { events: ProtocolV2Envelope[] }).events.map((item) => openProtocolV2Envelope(item, value.keys.privateKey)));
  assert.equal(tested.find((item) => item.work === "Setup test")?.sourceMethod, "cli");
});

test("same-phone code is claimable and approvable only with inbox authority", async () => {
  const value = await harness();
  const response = await value.request("/v2/add-source/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName: "Same phone" }) });
  const session = await response.json() as { sessionId: string; setupSecret: string; code: string };
  const claim = await value.request("/v2/add-source/claims", { method: "POST", headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" }, body: JSON.stringify({ inboxId, code: session.code }) });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json() as { sourceName: string }).sourceName, "Same phone");
  const unauthorized = await value.request(`/v2/add-source/sessions/${session.sessionId}/approve`, { method: "POST", headers: { authorization: "Bearer wrong_credential_that_is_long_enough_0001", "content-type": "application/json" }, body: JSON.stringify({ inboxId, code: session.code }) });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("x-bbbbb-source-id"), null);
  const approval = await value.request(`/v2/add-source/sessions/${session.sessionId}/approve`, { method: "POST", headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" }, body: JSON.stringify({ inboxId, code: session.code }) });
  assert.equal(approval.status, 204);
  assert.match(approval.headers.get("x-bbbbb-source-id") ?? "", /^[A-Za-z0-9_-]{16,128}$/u);
  assert.equal((await value.request(`/v2/add-source/sessions/${session.sessionId}`, { headers: { authorization: `Bearer ${session.setupSecret}` } })).status, 200);
});

test("one-use Source transfer rotates the credential and stores only receiver ciphertext", async () => {
  const value = await harness();
  const created = await createSource(value);
  const oldURL = new URL(created.sourceURL);
  const createTransfer = await value.request("/v2/source-transfers/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipientPublicKey: "K".repeat(600), receiverLabel: "Work browser" }),
  });
  assert.equal(createTransfer.status, 201);
  const transfer = await createTransfer.json() as {
    sessionId: string;
    code: string;
    receiverSecret: string;
    claimURL: string;
  };
  assert.equal(createTransfer.headers.get("x-bbbbb-session"), transfer.sessionId);
  assert.equal(createTransfer.headers.get("x-bbbbb-code"), transfer.code);
  assert.equal(createTransfer.headers.get("x-bbbbb-receiver-secret"), transfer.receiverSecret);
  const claimSecret = new URL(transfer.claimURL).searchParams.get("secret");
  assert.ok(claimSecret);

  const claim = await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimSecret }),
  });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json() as { receiverLabel: string }).receiverLabel, "Work browser");

  const unauthorized = await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}/complete`, {
    method: "POST",
    headers: { authorization: "Bearer wrong_read_credential_that_is_long_enough", "content-type": "application/json" },
    body: JSON.stringify({ inboxId, sourceId: created.source.sourceId, claimSecret }),
  });
  assert.equal(unauthorized.status, 401);

  const complete = await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" },
    body: JSON.stringify({ inboxId, sourceId: created.source.sourceId, claimSecret }),
  });
  assert.equal(complete.status, 204);
  assert.equal((await value.request(oldURL.pathname + oldURL.search, { method: "POST" })).status, 401);
  assert.equal((await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${transfer.receiverSecret}` },
  })).status, 409);

  const stored = JSON.stringify([...value.store.transferSessions.values()]);
  assert.equal(stored.includes(created.sourceURL), false);
  assert.equal(JSON.stringify(value.logs).includes(created.sourceURL), false);
  assert.equal((await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}`, {
    headers: { authorization: "Bearer wrong_receiver_secret_that_is_long_enough" },
  })).status, 401);

  const handoff = await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}`, {
    headers: { authorization: `Bearer ${transfer.receiverSecret}` },
  });
  assert.equal(handoff.status, 200);
  const ciphertext = (await handoff.json() as { ciphertext: string }).ciphertext;
  const nextURL = new URL(Buffer.from(ciphertext, "base64url").toString());
  assert.equal(nextURL.origin, relay);
  assert.equal((await value.request(nextURL.pathname + nextURL.search, { method: "POST" })).status, 202);
  assert.equal((await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}`, {
    headers: { authorization: `Bearer ${transfer.receiverSecret}` },
  })).status, 404);
  assert.equal(value.store.transferSessions.get(transfer.sessionId)?.ciphertext, null);
});

test("Source transfer code claims only an awaiting authenticated session", async () => {
  const value = await harness();
  const created = await createSource(value);
  const response = await value.request("/v2/source-transfers/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipientPublicKey: "K".repeat(600), receiverLabel: "Headless server" }),
  });
  const transfer = await response.json() as { sessionId: string; code: string; receiverSecret: string };
  const claim = await value.request("/v2/source-transfers/claims", {
    method: "POST",
    headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" },
    body: JSON.stringify({ inboxId, code: transfer.code }),
  });
  assert.equal(claim.status, 200);
  assert.equal((await claim.json() as { receiverLabel: string }).receiverLabel, "Headless server");
  const complete = await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" },
    body: JSON.stringify({ inboxId, sourceId: created.source.sourceId, code: transfer.code }),
  });
  assert.equal(complete.status, 204);
  const raw = await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}?format=ciphertext`, {
    headers: { authorization: `Bearer ${transfer.receiverSecret}` },
  });
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get("content-type"), "application/octet-stream");
  const nextURL = Buffer.from(await raw.arrayBuffer()).toString();
  assert.match(nextURL, /^https:\/\/relay\.example\/v2\/sources\/.+\/events\?key=/u);
});

test("Source transfer code guessing is bounded and a disabled Source is never rotated", async () => {
  const value = await harness();
  const created = await createSource(value);
  const before = await value.store.getSource(created.source.sourceId);
  assert.ok(before);
  await value.store.updateSourceEnabled(created.source.sourceId, false, Date.parse("2026-07-19T08:00:00Z"));

  const response = await value.request("/v2/source-transfers/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recipientPublicKey: "K".repeat(600), receiverLabel: "Computer browser" }),
  });
  const transfer = await response.json() as { sessionId: string; code: string };
  const claim = await value.request("/v2/source-transfers/claims", {
    method: "POST",
    headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" },
    body: JSON.stringify({ inboxId, code: transfer.code }),
  });
  assert.equal(claim.status, 200);
  assert.equal((await value.request(`/v2/source-transfers/sessions/${transfer.sessionId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" },
    body: JSON.stringify({ inboxId, sourceId: created.source.sourceId, code: transfer.code }),
  })).status, 404);
  assert.equal((await value.store.getSource(created.source.sourceId))?.credentialHash, before.credentialHash);

  for (let attempt = 0; attempt < 11; attempt += 1) {
    assert.equal((await value.request("/v2/source-transfers/claims", {
      method: "POST",
      headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" },
      body: JSON.stringify({ inboxId, code: String(800_000 + attempt) }),
    })).status, 404);
  }
  assert.equal((await value.request("/v2/source-transfers/claims", {
    method: "POST",
    headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" },
    body: JSON.stringify({ inboxId, code: "999999" }),
  })).status, 429);
});

test("empty, JSON, and form submissions seal canonical events and duplicate retry stays single", async () => {
  const value = await harness();
  const created = await createSource(value);
  const eventId = "018f6f18-7f2f-7d3d-a932-70a79fbe31a4";
  const empty = await value.request(new URL(created.sourceURL).pathname + new URL(created.sourceURL).search, { method: "POST", headers: { "idempotency-key": eventId } });
  assert.equal(empty.status, 202);
  assert.deepEqual(await empty.json(), { accepted: true, duplicate: false, eventId });
  const duplicate = await value.request(new URL(created.sourceURL).pathname + new URL(created.sourceURL).search, { method: "POST", headers: { "idempotency-key": eventId } });
  assert.deepEqual(await duplicate.json(), { accepted: true, duplicate: true, eventId });
  const jsonResponse = await value.request(new URL(created.sourceURL).pathname + new URL(created.sourceURL).search, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: "attention", label: "Approval needed", work: "Review release", details: { attempt: 2, cached: false } }) });
  assert.equal(jsonResponse.status, 202);
  const formResponse = await value.request(new URL(created.sourceURL).pathname + new URL(created.sourceURL).search, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ category: "attention", label: "Failed", work: "Build app", message: "Tests failed" }) });
  assert.equal(formResponse.status, 202);
  await Promise.all(value.deferred);
  assert.equal(value.notifications.length, 3);
  const historyResponse = await value.request(`/v2/inboxes/${inboxId}/events`, { headers: { authorization: `Bearer ${readCredential}` } });
  const history = await historyResponse.json() as { events: ProtocolV2Envelope[] };
  assert.equal(history.events.length, 3);
  const decoded = await Promise.all(history.events.map((event) => openProtocolV2Envelope(event, value.keys.privateKey)));
  assert.deepEqual(decoded.map((event) => event.category), ["activity", "attention", "attention"]);
  assert.deepEqual(decoded.map((event) => event.label), ["Update", "Approval needed", "Failed"]);
  assert.deepEqual(decoded.map((event) => event.source), ["MacBook builds", "MacBook builds", "MacBook builds"]);
  assert.deepEqual(decoded.map((event) => event.sourceMethod), ["http", "http", "http"]);
  const stored = JSON.stringify([...value.store.events.values()].map((events) => [...events.values()]));
  for (const plaintext of ["Review release", "Build app", "Tests failed", "MacBook builds"]) assert.equal(stored.includes(plaintext), false);
});

test("HTTP Source sealing and storage failures stay retryable and secret-safe", async () => {
  const sealing = await harness();
  const sealingSource = await createSource(sealing);
  const sealingURL = new URL(sealingSource.sourceURL);
  const inbox = sealing.store.inboxes.get(inboxId);
  assert.ok(inbox);
  sealing.store.inboxes.set(inboxId, { ...inbox, publicKey: "invalid-public-key" });
  const sealingResponse = await sealing.request(sealingURL.pathname + sealingURL.search, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ work: "private sealing failure payload" }),
  });
  assert.equal(sealingResponse.status, 503);
  assert.deepEqual(await sealingResponse.json(), { error: "temporarily_unavailable" });
  assert.ok(sealing.logs.some((entry) => entry.event === "v2_event_failed" && entry.kind === "sealing"));
  assert.equal(JSON.stringify(sealing.logs).includes("private sealing failure payload"), false);

  const storage = await harness();
  const storageSource = await createSource(storage);
  const storageURL = new URL(storageSource.sourceURL);
  storage.store.putEvent = async () => { throw new Error("injected storage failure"); };
  const storageResponse = await storage.request(storageURL.pathname + storageURL.search, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ work: "private storage failure payload" }),
  });
  assert.equal(storageResponse.status, 503);
  assert.deepEqual(await storageResponse.json(), { error: "temporarily_unavailable" });
  assert.ok(storage.logs.some((entry) => entry.event === "v2_event_failed" && entry.kind === "storage"));
  assert.equal(JSON.stringify(storage.logs).includes("private storage failure payload"), false);
});

test("Source management keeps old credential on replacement failure and exactly one on success", async () => {
  const value = await harness();
  const created = await createSource(value);
  const headers = { authorization: `Bearer ${readCredential}`, "content-type": "application/json" };
  const sourcePath = `/v2/inboxes/${inboxId}/sources/${created.source.sourceId}`;
  assert.equal((await value.request(sourcePath, { method: "PATCH", headers, body: JSON.stringify({ name: "Release checks" }) })).status, 200);
  assert.equal((await value.request(`${sourcePath}/test`, { method: "POST", headers })).status, 202);
  assert.equal((await value.request(sourcePath, { method: "PATCH", headers, body: JSON.stringify({ enabled: false }) })).status, 200);
  const oldURL = new URL(created.sourceURL);
  assert.equal((await value.request(oldURL.pathname + oldURL.search, { method: "POST" })).status, 403);
  await value.request(sourcePath, { method: "PATCH", headers, body: JSON.stringify({ enabled: true }) });
  value.store.failNextCredentialReplacement = true;
  assert.equal((await value.request(`${sourcePath}/credential`, { method: "POST", headers })).status, 503);
  assert.equal((await value.request(oldURL.pathname + oldURL.search, { method: "POST" })).status, 202);
  const replacement = await value.request(`${sourcePath}/credential`, { method: "POST", headers });
  assert.equal(replacement.status, 200);
  const replacementURL = new URL((await replacement.json() as { sourceURL: string }).sourceURL);
  assert.equal((await value.request(oldURL.pathname + oldURL.search, { method: "POST" })).status, 401);
  assert.equal((await value.request(replacementURL.pathname + replacementURL.search, { method: "POST" })).status, 202);
  assert.equal((await value.request(sourcePath, { method: "DELETE", headers })).status, 204);
  assert.equal((await value.request(replacementURL.pathname + replacementURL.search, { method: "POST" })).status, 401);
});

test("Source deletion is scoped and authenticated hosted deletion removes the complete inbox", async () => {
  const value = await harness();
  const first = await createSource(value);
  const second = await createSource(value);
  const firstURL = new URL(first.sourceURL);
  const secondURL = new URL(second.sourceURL);
  assert.equal((await value.request(firstURL.pathname + firstURL.search, { method: "POST" })).status, 202);
  assert.equal((await value.request(secondURL.pathname + secondURL.search, { method: "POST" })).status, 202);

  const inboxHeaders = { authorization: `Bearer ${readCredential}` };
  const firstSourcePath = `/v2/inboxes/${inboxId}/sources/${first.source.sourceId}`;
  assert.equal((await value.request(firstSourcePath, { method: "DELETE", headers: inboxHeaders })).status, 204);
  const afterSourceDelete = await value.request(`/v2/inboxes/${inboxId}/events`, { headers: inboxHeaders });
  const remaining = (await afterSourceDelete.json() as { events: ProtocolV2Envelope[] }).events;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.sourceId, second.source.sourceId);

  assert.equal((await value.request(`/v2/inboxes/${inboxId}/events`, { method: "DELETE" })).status, 401);
  assert.equal((await value.request(`/v2/inboxes/${inboxId}/events`, { method: "DELETE", headers: inboxHeaders })).status, 204);
  const afterHistoryDelete = await value.request(`/v2/inboxes/${inboxId}/events`, { headers: inboxHeaders });
  assert.deepEqual(await afterHistoryDelete.json(), { version: 2, events: [] });

  const otherInbox = { inboxId: "inbox_secondary_0002", publicKey: value.keys.publicKey, readCredentialHash: digest("other_read_credential_that_is_long_enough"), createdAt: Date.parse("2026-07-19T08:00:00Z") };
  assert.equal(await value.store.createInbox(otherInbox), true);
  assert.equal((await value.request(`/v2/inboxes/${inboxId}`, { method: "DELETE" })).status, 401);
  assert.equal((await value.request(`/v2/inboxes/${inboxId}`, { method: "DELETE", headers: inboxHeaders })).status, 204);
  assert.equal(await value.store.getInbox(inboxId), null);
  assert.deepEqual(await value.store.listSources(inboxId), []);
  assert.equal([...value.store.sessions.values()].some((session) => session.inboxId === inboxId), false);
  assert.equal(value.store.events.has(inboxId), false);
  assert.deepEqual(await value.store.getInbox(otherInbox.inboxId), otherInbox);
});

test("expired sessions, invalid fields, oversized bodies, and disabled Sources use bounded errors", async () => {
  const value = await harness();
  const sessionResponse = await value.request("/v2/add-source/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceName: "MacBook builds" }) });
  const session = await sessionResponse.json() as { sessionId: string; setupSecret: string };
  value.setNow(Date.parse("2026-07-19T08:05:00.001Z"));
  assert.equal((await value.request(`/v2/add-source/sessions/${session.sessionId}`, { headers: { authorization: `Bearer ${session.setupSecret}` } })).status, 404);

  value.setNow(Date.parse("2026-07-19T08:06:00Z"));
  const created = await createSource(value);
  const url = new URL(created.sourceURL);
  const invalid = await value.request(url.pathname + url.search, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "spoof", category: "activity" }) });
  assert.deepEqual(await invalid.json(), { error: "invalid_input" });
  assert.ok(value.logs.some((entry) => entry.event === "v2_event_rejected" && entry.kind === "validation"));
  const oversized = await value.request(url.pathname + url.search, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "x".repeat(17_000) }) });
  assert.equal(oversized.status, 413);
  for (const log of value.logs) {
    const serialized = JSON.stringify(log);
    assert.equal(serialized.includes("spoof"), false);
    assert.equal(serialized.includes("xxxxx"), false);
  }
});
