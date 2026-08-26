import assert from "node:assert/strict";
import test from "node:test";
import { reconcileAppStoreNotificationHistory } from "../src/v2/app-store-reconciliation.js";
import { MemoryV2SourceStore } from "../src/v2/memory-source-store.js";

const now = 2_000_000_000_000;
const originalTransactionId = "2000000000000001";
const entitlementId = "derived_entitlement_AAAAAAAAAAAAA";

function source(calls: Array<{ kind: string; token: string | null; request?: unknown }>, environment: "sandbox" | "production" = "sandbox") {
  return {
    environment,
    historyLimitHours: environment === "production" ? 4_320 : 720,
    client: {
      getNotificationHistory: async (token: string | null, request: unknown) => {
        calls.push({ kind: "notifications", token, request });
        return token === null
          ? { hasMore: true, paginationToken: "page_2", notificationHistory: [{ signedPayload: "refund.signed.payload" }] }
          : { hasMore: false, notificationHistory: [{ signedPayload: "reversal.signed.payload" }] };
      },
      getTransactionHistory: async (_transactionId: string, revision: string | null) => {
        calls.push({ kind: "transactions", token: revision });
        return revision === null
          ? { hasMore: true, revision: "transaction_page_2", signedTransactions: ["revoked.signed.transaction"] }
          : { hasMore: false, signedTransactions: ["active.signed.transaction"] };
      },
    },
    verifyNotification: async (signedPayload: string) => signedPayload.startsWith("refund") ? {
      notificationUUID: "123e4567-e89b-42d3-a456-426614174020",
      notificationType: "REFUND",
      transaction: { originalTransactionId, status: "revoked" as const, stateChangedAt: 200, environment: "sandbox" as const },
    } : {
      notificationUUID: "123e4567-e89b-42d3-a456-426614174021",
      notificationType: "REFUND_REVERSED",
      transaction: { originalTransactionId, status: "active" as const, stateChangedAt: 300, environment: "sandbox" as const },
    },
    verifyTransaction: async (signedTransaction: string) => ({
      originalTransactionId,
      status: signedTransaction.startsWith("active") ? "active" as const : "revoked" as const,
      stateChangedAt: signedTransaction.startsWith("active") ? 300 : 200,
      environment: "sandbox" as const,
    }),
  };
}

test("notification recovery checkpoints and confirms current non-consumable state without retaining Apple identifiers", async () => {
  const store = new MemoryV2SourceStore();
  const inboxId = "inbox_entitlement_a";
  await store.createInbox({ inboxId, publicKey: "public", readCredentialHash: "hash", createdAt: 1 });
  await store.applyEntitlement({ entitlementId, productId: "org.shenren.bbbbb.plus", environment: "sandbox", status: "active", stateChangedAt: 100, verifiedAt: 110 }, inboxId);
  const calls: Array<{ kind: string; token: string | null; request?: unknown }> = [];
  const run = () => reconcileAppStoreNotificationHistory({ store, sources: [source(calls)], now, deriveEntitlementId: async () => entitlementId });

  assert.deepEqual(await run(), {
    environments: 1, failedEnvironments: 0, pages: 2, notifications: 2, applied: 2, idempotent: 0, stale: 0, ignored: 0,
    transactionPages: 2, currentStates: 1, currentApplied: 0, currentIdempotent: 1, currentStale: 0, checkpoints: 1,
  });
  assert.equal(await store.getEntitlementTier(inboxId, now + 1), "plus");
  assert.equal(await store.getAppStoreReconciliationCheckpoint("sandbox"), now);
  assert.deepEqual(calls[0]?.request, { startDate: now - 720 * 60 * 60 * 1_000 + 5 * 60 * 1_000, endDate: now, onlyFailures: false });
  assert.equal(JSON.stringify({ entitlements: store.entitlements, notifications: store.entitlementNotifications, checkpoints: store.appStoreReconciliationCheckpoints }).includes(originalTransactionId), false);

  calls.length = 0;
  const repeated = await run();
  assert.equal(repeated.idempotent, 2);
  assert.equal(repeated.currentIdempotent, 1);
  assert.deepEqual(calls[0]?.request, { startDate: now - 12 * 60 * 60 * 1_000, endDate: now, onlyFailures: false });
});

test("a current-state failure never advances the durable checkpoint", async () => {
  const store = new MemoryV2SourceStore();
  const broken = source([]);
  broken.client.getTransactionHistory = async () => ({ hasMore: false, signedTransactions: [] });
  const result = await reconcileAppStoreNotificationHistory({ store, sources: [broken], now, deriveEntitlementId: async () => entitlementId });
  assert.equal(result.failedEnvironments, 1);
  assert.equal(result.checkpoints, 0);
  assert.equal(await store.getAppStoreReconciliationCheckpoint("sandbox"), null);
});

test("one unavailable Apple environment never blocks another environment checkpoint", async () => {
  const store = new MemoryV2SourceStore();
  const unavailable = source([], "production");
  unavailable.client.getNotificationHistory = async () => { throw new Error("unavailable"); };
  const available = source([]);
  const result = await reconcileAppStoreNotificationHistory({ store, sources: [unavailable, available], now, deriveEntitlementId: async () => entitlementId });
  assert.equal(result.failedEnvironments, 1);
  assert.equal(result.checkpoints, 1);
  assert.equal(await store.getAppStoreReconciliationCheckpoint("production"), null);
  assert.equal(await store.getAppStoreReconciliationCheckpoint("sandbox"), now);
});
