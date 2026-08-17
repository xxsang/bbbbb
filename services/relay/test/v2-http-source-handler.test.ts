import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import {
  generateProtocolV2KeyPair,
  openProtocolV2Envelope,
  sealProtocolV2Event,
  type ProtocolV2Envelope,
  type V2Tier,
} from "@bbbbbapp/protocol";
import { createV2HttpSourceHandler } from "../src/v2/http-source-handler.js";
import type { V2HttpSourceHandlerDependencies } from "../src/v2/http-source-handler.js";
import { AppleTransactionVerificationError, type V2VerifiedAppleNotification, type V2VerifiedAppleTransaction } from "../src/v2/apple-store-verifier.js";
import { MemoryV2SourceStore } from "../src/v2/memory-source-store.js";

const relay = "https://relay.example";
const inboxId = "inbox_primary_0001";
const readCredential = "read_credential_that_is_long_enough_0001";
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");

type EntitlementDependencies = Pick<V2HttpSourceHandlerDependencies, "verifyEntitlementTransaction" | "verifyEntitlementNotification" | "deriveEntitlementId">;

async function harness(tier: V2Tier = "free", entitlement?: EntitlementDependencies) {
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
    resolveTier: tier === "plus"
      ? async () => tier
      : (requestedInboxId) => store.getEntitlementTier(requestedInboxId),
    ...(entitlement ?? {}),
  });
  const request = (path: string, init: RequestInit = {}) => handler(new Request(`${relay}${path}`, init));
  const keys = await generateProtocolV2KeyPair();
  const inboxResponse = await request("/v2/inboxes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inboxId, publicKey: keys.publicKey, readCredential }) });
  assert.equal(inboxResponse.status, 201);
  return { store, logs, notifications, deferred, keys, request, setNow: (value: number) => { now = value; } };
}

test("entitlement verification is read-authorized, replay-safe, movable, revocable, and secret-safe", async () => {
  let verified: V2VerifiedAppleTransaction = {
    originalTransactionId: "2000000000000001",
    status: "active",
    stateChangedAt: Date.parse("2026-07-19T07:59:00Z"),
    environment: "xcode",
  };
  const value = await harness("free", {
    verifyEntitlementTransaction: async () => verified,
    deriveEntitlementId: async () => "derived_entitlement_AAAAAAAAAAAAA",
  });
  const path = `/v2/inboxes/${inboxId}/entitlement/verify`;
  const body = JSON.stringify({ version: 2, signedTransaction: "header.payload.signature" });
  assert.equal((await value.request(path, { method: "POST", headers: { "content-type": "application/json" }, body })).status, 401);
  const first = await value.request(path, { method: "POST", headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" }, body });
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await first.json(), { version: 2, state: "plus" });
  assert.equal(await value.store.getEntitlementTier(inboxId), "plus");
  assert.deepEqual((await (await value.request(`/v2/inboxes/${inboxId}/usage`, { headers: { authorization: `Bearer ${readCredential}` } })).json() as { recovery: unknown }).recovery, {
    maximumEvents: 500,
    maximumAgeDays: 30,
  });
  assert.deepEqual(await (await value.request(path, { method: "POST", headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" }, body })).json(), { version: 2, state: "plus" });

  const secondInbox = "inbox_secondary_0002";
  const secondCredential = "read_credential_that_is_long_enough_0002";
  await value.store.createInbox({ inboxId: secondInbox, publicKey: value.keys.publicKey, readCredentialHash: digest(secondCredential), createdAt: 1 });
  const moved = await value.request(`/v2/inboxes/${secondInbox}/entitlement/verify`, { method: "POST", headers: { authorization: `Bearer ${secondCredential}`, "content-type": "application/json" }, body });
  assert.deepEqual(await moved.json(), { version: 2, state: "plus" });
  assert.equal(await value.store.getEntitlementTier(inboxId), "free");

  verified = { ...verified, status: "revoked", stateChangedAt: Date.parse("2026-07-19T08:00:00Z") };
  const revoked = await value.request(`/v2/inboxes/${secondInbox}/entitlement/verify`, { method: "POST", headers: { authorization: `Bearer ${secondCredential}`, "content-type": "application/json" }, body });
  assert.deepEqual(await revoked.json(), { version: 2, state: "free" });
  assert.deepEqual((await (await value.request(`/v2/inboxes/${secondInbox}/usage`, { headers: { authorization: `Bearer ${secondCredential}` } })).json() as { recovery: unknown }).recovery, {
    maximumEvents: 100,
    maximumAgeDays: 7,
  });
  const evidence = JSON.stringify(value.logs);
  assert.equal(evidence.includes("2000000000000001"), false);
  assert.equal(evidence.includes("derived_entitlement"), false);
  assert.equal(evidence.includes("header.payload.signature"), false);
});

test("entitlement verification fails closed when absent, invalid, or retryable", async () => {
  const unavailable = await harness();
  const init = { method: "POST", headers: { authorization: `Bearer ${readCredential}`, "content-type": "application/json" }, body: JSON.stringify({ version: 2, signedTransaction: "header.payload.signature" }) };
  assert.equal((await unavailable.request(`/v2/inboxes/${inboxId}/entitlement/verify`, init)).status, 503);

  const retryable = await harness("free", {
    verifyEntitlementTransaction: async () => { throw new AppleTransactionVerificationError("retryable"); },
    deriveEntitlementId: async () => "derived_entitlement_AAAAAAAAAAAAA",
  });
  assert.deepEqual(await (await retryable.request(`/v2/inboxes/${inboxId}/entitlement/verify`, init)).json(), { error: "verification_unavailable" });
  const invalid = await retryable.request(`/v2/inboxes/${inboxId}/entitlement/verify`, { ...init, body: JSON.stringify({ version: 2, signedTransaction: "invalid" }) });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_transaction" });
});

test("verified App Store notifications revoke once, reject stale transitions, and retain no signed payload", async () => {
  let notification: V2VerifiedAppleNotification = {
    notificationUUID: "123e4567-e89b-42d3-a456-426614174001",
    notificationType: "REFUND",
    transaction: {
      originalTransactionId: "2000000000000001",
      status: "revoked",
      stateChangedAt: Date.parse("2026-07-19T08:00:00Z"),
      environment: "xcode",
    },
  };
  const value = await harness("free", {
    verifyEntitlementNotification: async () => notification,
    deriveEntitlementId: async () => "derived_entitlement_AAAAAAAAAAAAA",
  });
  await value.store.applyEntitlement({
    entitlementId: "derived_entitlement_AAAAAAAAAAAAA",
    productId: "org.shenren.bbbbb.plus",
    environment: "xcode",
    status: "active",
    stateChangedAt: Date.parse("2026-07-19T07:59:00Z"),
    verifiedAt: Date.parse("2026-07-19T07:59:30Z"),
  }, inboxId);
  assert.equal(await value.store.getEntitlementTier(inboxId), "plus");
  const request = () => value.request("/v2/app-store/notifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedPayload: "header.payload.signature" }),
  });
  const first = await request();
  assert.equal(first.status, 204);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(await value.store.getEntitlementTier(inboxId), "free");
  assert.equal(value.store.entitlementNotifications.size, 1);
  assert.equal((await request()).status, 204);
  assert.equal(value.store.entitlementNotifications.size, 1);

  notification = {
    ...notification,
    notificationUUID: "123e4567-e89b-42d3-a456-426614174002",
    transaction: { ...notification.transaction!, stateChangedAt: Date.parse("2026-07-19T07:58:00Z") },
  };
  assert.equal((await request()).status, 204);
  assert.equal(value.store.entitlements.get("derived_entitlement_AAAAAAAAAAAAA")?.stateChangedAt, Date.parse("2026-07-19T08:00:00Z"));

  notification = {
    notificationUUID: "123e4567-e89b-42d3-a456-426614174003",
    notificationType: "TEST",
    transaction: null,
  };
  assert.equal((await request()).status, 204);
  assert.equal(value.store.entitlementNotifications.size, 3);
  const evidence = JSON.stringify({ logs: value.logs, notifications: [...value.store.entitlementNotifications.values()] });
  for (const forbidden of ["header.payload.signature", "2000000000000001", "derived_entitlement"]) assert.equal(evidence.includes(forbidden), false);
});

test("App Store notification endpoint fails closed for invalid, unavailable, and retryable verification", async () => {
  const body = JSON.stringify({ signedPayload: "header.payload.signature" });
  const unavailable = await harness();
  assert.equal((await unavailable.request("/v2/app-store/notifications", { method: "POST", headers: { "content-type": "application/json" }, body })).status, 503);
  const retryable = await harness("free", {
    verifyEntitlementNotification: async () => { throw new AppleTransactionVerificationError("retryable"); },
    deriveEntitlementId: async () => "derived_entitlement_AAAAAAAAAAAAA",
  });
  await retryable.store.applyEntitlement({
    entitlementId: "derived_entitlement_AAAAAAAAAAAAA",
    productId: "org.shenren.bbbbb.plus",
    environment: "xcode",
    status: "active",
    stateChangedAt: Date.parse("2026-07-19T07:59:00Z"),
    verifiedAt: Date.parse("2026-07-19T07:59:30Z"),
  }, inboxId);
  assert.equal((await retryable.request("/v2/app-store/notifications", { method: "POST", headers: { "content-type": "application/json" }, body })).status, 503);
  assert.equal(await retryable.store.getEntitlementTier(inboxId), "plus");
  assert.equal((await retryable.request("/v2/app-store/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedPayload: "invalid" }) })).status, 400);
});

test("usage is Inbox-authorized and reflects only the relay-resolved tier", async () => {
  const value = await harness("plus");
  const unauthorized = await value.request(`/v2/inboxes/${inboxId}/usage`);
  assert.equal(unauthorized.status, 401);
  const response = await value.request(`/v2/inboxes/${inboxId}/usage`, { headers: { authorization: `Bearer ${readCredential}` } });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    version: 2,
    tier: "plus",
    rolling30Days: { accepted: 0, limit: 10_000, nextReleaseAt: null },
    burst: { limit: 20 },
    recovery: { maximumEvents: 500, maximumAgeDays: 30 },
  });
});

test("authenticated burst attempts aggregate by Inbox across Sources and invalid bodies still count", async () => {
  const value = await harness();
  const first = await createSource(value);
  const second = await createSource(value);
  const urls = [new URL(first.sourceURL), new URL(second.sourceURL)];
  for (let index = 0; index < 20; index += 1) {
    const url = urls[index % 2]!;
    const response = await value.request(url.pathname + url.search, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid-json",
    });
    assert.equal(response.status, 400);
  }
  const url = urls[0]!;
  const rejected = await value.request(url.pathname + url.search, { method: "POST" });
  assert.equal(rejected.status, 429);
  assert.deepEqual(await rejected.json(), {
    error: "inbox_quota_exceeded",
    scope: "burst",
    retryAt: "2026-07-19T08:01:00.000Z",
  });
  assert.equal(rejected.headers.get("retry-after"), "60");
  assert.equal(value.store.events.size, 0);
  assert.equal(value.notifications.length, 0);
});

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

test("encrypted history paginates the complete Plus allowance with bounded cursors", async () => {
  const value = await harness("plus");
  const acceptedAt = Date.parse("2026-07-19T07:00:00Z");
  const entries = new Map<string, { envelope: ProtocolV2Envelope; acceptedAt: number }>();
  for (let index = 0; index < 120; index += 1) {
    const eventId = `018f6f18-7f2f-7d3d-a932-${index.toString(16).padStart(12, "0")}`;
    entries.set(eventId, {
      acceptedAt: acceptedAt + index,
      envelope: {
        version: 2,
        eventId,
        inboxId,
        sourceId: "source_history_0001",
        suite: "DHKEM-P256-HKDF-SHA256/HKDF-SHA256/AES-128-GCM",
        enc: "bounded",
        ciphertext: "bounded",
      },
    });
  }
  value.store.events.set(inboxId, entries);

  const collected = new Set<string>();
  let cursor: string | null = null;
  const pageSizes: number[] = [];
  do {
    const suffix = cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
    const response = await value.request(`/v2/inboxes/${inboxId}/events${suffix}`, {
      headers: { authorization: `Bearer ${readCredential}` },
    });
    assert.equal(response.status, 200);
    const page = await response.json() as { events: ProtocolV2Envelope[]; nextCursor?: string };
    pageSizes.push(page.events.length);
    for (const event of page.events) collected.add(event.eventId);
    cursor = page.nextCursor ?? null;
  } while (cursor !== null);

  assert.deepEqual(pageSizes, [50, 50, 20]);
  assert.equal(collected.size, 120);
  assert.equal((await value.request(`/v2/inboxes/${inboxId}/events?cursor=invalid`, {
    headers: { authorization: `Bearer ${readCredential}` },
  })).status, 400);
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
