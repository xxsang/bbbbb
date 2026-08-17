import assert from "node:assert/strict";
import test from "node:test";
import { AppleStoreTransactionVerifier, AppleStoreVerifierSet, AppleTransactionVerificationError, deriveV2EntitlementId } from "../src/v2/apple-store-verifier.js";

const now = Date.parse("2026-08-13T12:00:00Z");
const payload = {
  originalTransactionId: "2000000000000001",
  transactionId: "2000000000000002",
  bundleId: "org.shenren.bbbbb",
  productId: "org.shenren.bbbbb.plus",
  purchaseDate: now - 1_000,
  originalPurchaseDate: now - 1_000,
  quantity: 1,
  type: "Non-Consumable",
  appAccountToken: "123e4567-e89b-42d3-a456-426614174000",
  inAppOwnershipType: "PURCHASED",
  signedDate: now,
  environment: "Xcode",
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const xcodeJWS = (value: Record<string, unknown>) => `${encode({ alg: "ES256" })}.${encode(value)}.signature`;

test("official Apple verifier normalizes only the frozen Xcode non-consumable", async () => {
  const verifier = new AppleStoreTransactionVerifier("xcode");
  assert.deepEqual(await verifier.verify(xcodeJWS(payload), now), {
    originalTransactionId: payload.originalTransactionId,
    status: "active",
    stateChangedAt: now,
    environment: "xcode",
  });
  assert.deepEqual(await verifier.verify(xcodeJWS({ ...payload, revocationDate: now + 1 }), now + 1), {
    originalTransactionId: payload.originalTransactionId,
    status: "revoked",
    stateChangedAt: now + 1,
    environment: "xcode",
  });
});

test("official Apple verifier rejects product, type, ownership, token, identifiers, and future drift", async () => {
  const verifier = new AppleStoreTransactionVerifier("xcode");
  const invalid = [
    { ...payload, productId: "org.shenren.bbbbb.other" },
    { ...payload, type: "Consumable" },
    { ...payload, inAppOwnershipType: "FAMILY_SHARED" },
    { ...payload, appAccountToken: "not-a-uuid" },
    { ...payload, originalTransactionId: "not-numeric" },
    { ...payload, transactionId: "not-numeric" },
    { ...payload, quantity: 2 },
    { ...payload, signedDate: now + 5 * 60 * 1_000 + 1 },
  ];
  for (const value of invalid) {
    await assert.rejects(verifier.verify(xcodeJWS(value), now), (error) => error instanceof AppleTransactionVerificationError && error.kind === "invalid");
  }
  await assert.rejects(verifier.verify("not-a-jws", now), (error) => error instanceof AppleTransactionVerificationError);
});

test("official Apple verifier accepts only verified refund and revoke notification transitions", async () => {
  const verifier = new AppleStoreTransactionVerifier("xcode");
  const revokedTransaction = xcodeJWS({ ...payload, revocationDate: now });
  const notification = {
    notificationType: "REFUND",
    notificationUUID: "123e4567-e89b-42d3-a456-426614174001",
    data: {
      environment: "Xcode",
      bundleId: "org.shenren.bbbbb",
      signedTransactionInfo: revokedTransaction,
    },
    version: "2.0",
    signedDate: now,
  };
  assert.deepEqual(await verifier.verifyNotification(xcodeJWS(notification), now), {
    notificationUUID: notification.notificationUUID,
    notificationType: "REFUND",
    transaction: {
      originalTransactionId: payload.originalTransactionId,
      status: "revoked",
      stateChangedAt: now,
      environment: "xcode",
    },
  });
  assert.deepEqual(await verifier.verifyNotification(xcodeJWS({ ...notification, notificationType: "ONE_TIME_CHARGE" }), now), {
    notificationUUID: notification.notificationUUID,
    notificationType: "ONE_TIME_CHARGE",
    transaction: null,
  });
  await assert.rejects(
    verifier.verifyNotification(xcodeJWS({ ...notification, data: { ...notification.data, signedTransactionInfo: xcodeJWS(payload) } }), now),
    (error) => error instanceof AppleTransactionVerificationError && error.kind === "invalid",
  );
  for (const invalid of [
    { ...notification, notificationUUID: "invalid" },
    { ...notification, version: "1.0" },
    { ...notification, signedDate: now + 5 * 60 * 1_000 + 1 },
  ]) await assert.rejects(verifier.verifyNotification(xcodeJWS(invalid), now), AppleTransactionVerificationError);
});

test("entitlement identity derivation is deterministic, keyed, and bounded", async () => {
  const first = await deriveV2EntitlementId(payload.originalTransactionId, "sandbox", "A".repeat(32));
  assert.equal(first, await deriveV2EntitlementId(payload.originalTransactionId, "sandbox", "A".repeat(32)));
  assert.notEqual(first, await deriveV2EntitlementId(payload.originalTransactionId, "production", "A".repeat(32)));
  assert.notEqual(first, await deriveV2EntitlementId(payload.originalTransactionId, "sandbox", "B".repeat(32)));
  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(first.includes(payload.originalTransactionId), false);
  await assert.rejects(deriveV2EntitlementId(payload.originalTransactionId, "sandbox", "short"));
  await assert.rejects(deriveV2EntitlementId("invalid", "sandbox", "A".repeat(32)));
});

test("verifier set accepts either Apple environment and preserves failure semantics", async () => {
  const active = {
    originalTransactionId: payload.originalTransactionId,
    status: "active" as const,
    stateChangedAt: now,
    environment: "sandbox" as const,
  };
  const notification = {
    notificationUUID: "123e4567-e89b-42d3-a456-426614174001",
    notificationType: "ONE_TIME_CHARGE",
    transaction: null,
  };
  const invalid = {
    verify: async () => { throw new AppleTransactionVerificationError("invalid"); },
    verifyNotification: async () => { throw new AppleTransactionVerificationError("invalid"); },
  };
  const sandbox = {
    verify: async () => active,
    verifyNotification: async () => notification,
  };
  const set = new AppleStoreVerifierSet([invalid, sandbox]);
  assert.deepEqual(await set.verify("signed", now), active);
  assert.deepEqual(await set.verifyNotification("signed", now), notification);

  await assert.rejects(new AppleStoreVerifierSet([invalid]).verify("signed", now), (error) => error instanceof AppleTransactionVerificationError && error.kind === "invalid");
  const retryable = { ...invalid, verify: async () => { throw new AppleTransactionVerificationError("retryable"); } };
  await assert.rejects(new AppleStoreVerifierSet([invalid, retryable]).verify("signed", now), (error) => error instanceof AppleTransactionVerificationError && error.kind === "retryable");
  assert.throws(() => new AppleStoreVerifierSet([]), /at least one Apple verifier/u);
});
