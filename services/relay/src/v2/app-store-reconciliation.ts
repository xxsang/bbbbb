import { PLUS_PRODUCT_ID } from "@bbbbbapp/protocol";
import type { V2VerifiedAppleNotification, V2VerifiedAppleTransaction } from "./apple-store-verifier.js";
import { applyVerifiedAppleNotification } from "./entitlement-lifecycle.js";
import type { V2EntitlementEnvironment, V2SourceStore } from "./source-store.js";

const HOUR_MS = 60 * 60 * 1_000;
const CHECKPOINT_OVERLAP_HOURS = 12;
const PROVIDER_BOUNDARY_SAFETY_MS = 5 * 60 * 1_000;
const MAX_PAGES = 100;

interface NotificationHistoryPage {
  readonly paginationToken?: string;
  readonly hasMore?: boolean;
  readonly notificationHistory?: readonly { readonly signedPayload?: string }[];
}

interface TransactionHistoryPage {
  readonly revision?: string;
  readonly hasMore?: boolean;
  readonly signedTransactions?: readonly string[];
}

export interface AppStoreNotificationHistoryClient {
  getNotificationHistory(
    paginationToken: string | null,
    request: { startDate: number; endDate: number; onlyFailures: boolean },
  ): Promise<NotificationHistoryPage>;
  getTransactionHistory(originalTransactionId: string, revision: string | null): Promise<TransactionHistoryPage>;
}

export interface AppStoreNotificationHistorySource {
  readonly environment: Exclude<V2EntitlementEnvironment, "xcode">;
  readonly historyLimitHours: number;
  readonly client: AppStoreNotificationHistoryClient;
  readonly verifyNotification: (signedPayload: string, now: number) => Promise<V2VerifiedAppleNotification>;
  readonly verifyTransaction: (signedTransaction: string, now: number) => Promise<V2VerifiedAppleTransaction>;
}

export interface AppStoreReconciliationResult {
  readonly environments: number;
  readonly failedEnvironments: number;
  readonly pages: number;
  readonly notifications: number;
  readonly applied: number;
  readonly idempotent: number;
  readonly stale: number;
  readonly ignored: number;
  readonly transactionPages: number;
  readonly currentStates: number;
  readonly currentApplied: number;
  readonly currentIdempotent: number;
  readonly currentStale: number;
  readonly checkpoints: number;
}

function latestTransaction(left: V2VerifiedAppleTransaction | null, right: V2VerifiedAppleTransaction): V2VerifiedAppleTransaction {
  if (left === null || right.stateChangedAt > left.stateChangedAt) return right;
  if (right.stateChangedAt === left.stateChangedAt && right.status === "revoked") return right;
  return left;
}

async function currentTransaction(
  source: AppStoreNotificationHistorySource,
  originalTransactionId: string,
  now: number,
  counts: { transactionPages: number },
): Promise<V2VerifiedAppleTransaction> {
  let revision: string | null = null;
  let latest: V2VerifiedAppleTransaction | null = null;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await source.client.getTransactionHistory(originalTransactionId, revision);
    counts.transactionPages += 1;
    for (const signedTransaction of page.signedTransactions ?? []) {
      if (typeof signedTransaction !== "string" || signedTransaction.length < 16 || signedTransaction.length > 64 * 1_024) throw new TypeError("App Store transaction history payload is invalid");
      const transaction = await source.verifyTransaction(signedTransaction, now);
      if (transaction.environment !== source.environment || transaction.originalTransactionId !== originalTransactionId) throw new TypeError("App Store transaction history identity mismatch");
      latest = latestTransaction(latest, transaction);
    }
    if (page.hasMore !== true) break;
    if (typeof page.revision !== "string" || page.revision.length < 1 || page.revision.length > 512 || page.revision === revision) throw new TypeError("App Store transaction history pagination is invalid");
    revision = page.revision;
    if (pageNumber === MAX_PAGES - 1) throw new Error("App Store transaction history pagination exceeded its bound");
  }
  if (latest === null) throw new TypeError("App Store transaction history is empty");
  return latest;
}

export async function reconcileAppStoreNotificationHistory({
  store,
  sources,
  now,
  deriveEntitlementId,
}: {
  readonly store: V2SourceStore;
  readonly sources: readonly AppStoreNotificationHistorySource[];
  readonly now: number;
  readonly deriveEntitlementId: (originalTransactionId: string, environment: V2EntitlementEnvironment) => Promise<string>;
}): Promise<AppStoreReconciliationResult> {
  if (!Number.isSafeInteger(now) || now < 0 || sources.length < 1 || new Set(sources.map(({ environment }) => environment)).size !== sources.length) throw new TypeError("App Store reconciliation configuration is invalid");
  const counts = { environments: sources.length, failedEnvironments: 0, pages: 0, notifications: 0, applied: 0, idempotent: 0, stale: 0, ignored: 0, transactionPages: 0, currentStates: 0, currentApplied: 0, currentIdempotent: 0, currentStale: 0, checkpoints: 0 };
  for (const source of sources) {
    if (!Number.isSafeInteger(source.historyLimitHours) || source.historyLimitHours < 1 || source.historyLimitHours > 4_320) throw new TypeError("App Store reconciliation history limit is invalid");
    try {
      const checkpoint = await store.getAppStoreReconciliationCheckpoint(source.environment);
      const providerMaximumHours = source.environment === "production" ? 4_320 : 720;
      const boundarySafety = source.historyLimitHours === providerMaximumHours ? PROVIDER_BOUNDARY_SAFETY_MS : 0;
      const earliest = now - source.historyLimitHours * HOUR_MS + boundarySafety;
      const startDate = checkpoint === null ? earliest : Math.max(earliest, checkpoint - CHECKPOINT_OVERLAP_HOURS * HOUR_MS);
      const affectedTransactions = new Set<string>();
      let paginationToken: string | null = null;
      for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
        const page = await source.client.getNotificationHistory(paginationToken, { startDate, endDate: now, onlyFailures: false });
        counts.pages += 1;
        for (const item of page.notificationHistory ?? []) {
          if (typeof item.signedPayload !== "string" || item.signedPayload.length < 16 || item.signedPayload.length > 64 * 1_024) throw new TypeError("App Store reconciliation payload is invalid");
          const notification = await source.verifyNotification(item.signedPayload, now);
          if (notification.transaction && notification.transaction.environment !== source.environment) throw new TypeError("App Store reconciliation environment mismatch");
          const result = await applyVerifiedAppleNotification(store, notification, now, deriveEntitlementId);
          counts.notifications += 1;
          counts[result] += 1;
          if (notification.transaction) affectedTransactions.add(notification.transaction.originalTransactionId);
        }
        if (page.hasMore !== true) break;
        if (typeof page.paginationToken !== "string" || page.paginationToken.length < 1 || page.paginationToken.length > 512 || page.paginationToken === paginationToken) throw new TypeError("App Store reconciliation pagination is invalid");
        paginationToken = page.paginationToken;
        if (pageNumber === MAX_PAGES - 1) throw new Error("App Store reconciliation pagination exceeded its bound");
      }
      for (const originalTransactionId of affectedTransactions) {
        const transaction = await currentTransaction(source, originalTransactionId, now, counts);
        const result = await store.reconcileEntitlement({ entitlementId: await deriveEntitlementId(originalTransactionId, source.environment), productId: PLUS_PRODUCT_ID, environment: source.environment, status: transaction.status, stateChangedAt: transaction.stateChangedAt, verifiedAt: Math.max(now, transaction.stateChangedAt) });
        counts.currentStates += 1;
        if (result === "applied") counts.currentApplied += 1;
        else if (result === "idempotent") counts.currentIdempotent += 1;
        else counts.currentStale += 1;
      }
      await store.advanceAppStoreReconciliationCheckpoint(source.environment, now, now);
      counts.checkpoints += 1;
    } catch {
      counts.failedEnvironments += 1;
    }
  }
  return counts;
}
