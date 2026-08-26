import { PLUS_PRODUCT_ID } from "@bbbbbapp/protocol";
import type { V2VerifiedAppleNotification } from "./apple-store-verifier.js";
import type { V2EntitlementEnvironment, V2EntitlementNotificationApplyResult, V2SourceStore } from "./source-store.js";

export async function applyVerifiedAppleNotification(
  store: Pick<V2SourceStore, "applyEntitlementNotification">,
  notification: V2VerifiedAppleNotification,
  receivedAt: number,
  deriveEntitlementId: (originalTransactionId: string, environment: V2EntitlementEnvironment) => Promise<string>,
): Promise<V2EntitlementNotificationApplyResult> {
  const claim = notification.transaction ? {
    entitlementId: await deriveEntitlementId(notification.transaction.originalTransactionId, notification.transaction.environment),
    productId: PLUS_PRODUCT_ID,
    environment: notification.transaction.environment,
    status: notification.transaction.status,
    stateChangedAt: notification.transaction.stateChangedAt,
    verifiedAt: Math.max(receivedAt, notification.transaction.stateChangedAt),
  } : null;
  return store.applyEntitlementNotification(notification.notificationUUID, notification.notificationType, receivedAt, claim);
}
