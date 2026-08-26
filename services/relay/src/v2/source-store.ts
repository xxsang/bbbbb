import {
  PLUS_PRODUCT_ID,
  V2_TIER_LIMITS,
  type ProtocolV2Envelope,
  type ProtocolV2UsageSnapshot,
  type V2QuotaScope,
  type V2Tier,
} from "@bbbbbapp/protocol";

export const V2_DAY_MS = 24 * 60 * 60 * 1_000;
export const V2_ROLLING_WINDOW_MS = 30 * V2_DAY_MS;

export interface V2TierPolicy {
  readonly tier: V2Tier;
  readonly rolling30Days: number;
  readonly burst: number;
  readonly recoveryMaximumEvents: number;
  readonly recoveryMaximumAgeDays: number;
}

export function v2TierPolicy(tier: V2Tier): V2TierPolicy {
  return { tier, ...V2_TIER_LIMITS[tier] };
}

export interface V2Inbox {
  readonly inboxId: string;
  readonly publicKey: string;
  readonly readCredentialHash: string;
  readonly createdAt: number;
}

export interface V2Source {
  readonly sourceId: string;
  readonly inboxId: string;
  readonly name: string;
  readonly method: "http" | "cli";
  readonly credentialHash: string;
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastSuccessAt: number | null;
}

export interface V2AddSourceSession {
  readonly sessionId: string;
  readonly code: string;
  readonly claimSecretHash: string;
  readonly setupSecretHash: string;
  readonly sourceName: string;
  readonly method: "http" | "cli";
  readonly inboxId: string | null;
  readonly sourceId: string | null;
  readonly state: "awaiting_approval" | "approved" | "consumed" | "cancelled";
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface V2SourceTransferSession {
  readonly sessionId: string;
  readonly code: string;
  readonly claimSecretHash: string;
  readonly receiverSecretHash: string;
  readonly recipientPublicKey: string;
  readonly receiverLabel: string;
  readonly inboxId: string | null;
  readonly sourceId: string | null;
  readonly ciphertext: string | null;
  readonly state: "awaiting_approval" | "completed" | "consumed" | "cancelled";
  readonly createdAt: number;
  readonly expiresAt: number;
}

export const V2_ENTITLEMENT_ENVIRONMENTS = ["xcode", "sandbox", "production"] as const;
export type V2EntitlementEnvironment = (typeof V2_ENTITLEMENT_ENVIRONMENTS)[number];

export interface V2VerifiedEntitlementClaim {
  readonly entitlementId: string;
  readonly productId: typeof PLUS_PRODUCT_ID;
  readonly environment: V2EntitlementEnvironment;
  readonly status: "active" | "revoked";
  readonly stateChangedAt: number;
  readonly verifiedAt: number;
}

const DERIVED_ENTITLEMENT_ID = /^[A-Za-z0-9_-]{32,128}$/u;
export function validateV2VerifiedEntitlementClaim(value: V2VerifiedEntitlementClaim): V2VerifiedEntitlementClaim {
  if (
    !DERIVED_ENTITLEMENT_ID.test(value.entitlementId) ||
    value.productId !== PLUS_PRODUCT_ID ||
    !V2_ENTITLEMENT_ENVIRONMENTS.includes(value.environment) ||
    (value.status !== "active" && value.status !== "revoked") ||
    !Number.isSafeInteger(value.stateChangedAt) || value.stateChangedAt < 0 ||
    !Number.isSafeInteger(value.verifiedAt) || value.verifiedAt < value.stateChangedAt
  ) throw new TypeError("verified entitlement claim is invalid");
  return structuredClone(value);
}

export type V2EntitlementApplyResult = "applied" | "idempotent" | "stale" | "inbox_unavailable";
export type V2EntitlementNotificationApplyResult = Exclude<V2EntitlementApplyResult, "inbox_unavailable"> | "ignored";
export type V2EntitlementReconciliationResult = Exclude<V2EntitlementApplyResult, "inbox_unavailable">;

export const V2_ENTITLEMENT_OPERATION_ACTIONS = ["suspend", "resume", "sandbox_reset"] as const;
export type V2EntitlementOperationAction = (typeof V2_ENTITLEMENT_OPERATION_ACTIONS)[number];

export interface V2EntitlementOperation {
  readonly operationId: string;
  readonly action: V2EntitlementOperationAction;
  readonly environment: V2EntitlementEnvironment;
  readonly inboxId: string;
  readonly targetFingerprint: string;
  readonly actorFingerprint: string;
  readonly reasonCode: string;
  readonly occurredAt: number;
  readonly expiresAt: number | null;
}

export type V2EntitlementOperationResult = "applied" | "idempotent" | "idempotency_conflict" | "target_unavailable" | "environment_mismatch";

const OPERATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPERATION_INBOX_ID = /^[A-Za-z0-9_-]{16,128}$/u;
const OPERATION_FINGERPRINT = /^[A-Za-z0-9_-]{16,64}$/u;
const OPERATION_REASON = /^[a-z][a-z0-9_]{2,63}$/u;
export function validateV2EntitlementOperation(value: V2EntitlementOperation): V2EntitlementOperation {
  if (
    !OPERATION_UUID.test(value.operationId) ||
    !V2_ENTITLEMENT_OPERATION_ACTIONS.includes(value.action) ||
    !V2_ENTITLEMENT_ENVIRONMENTS.includes(value.environment) ||
    !OPERATION_INBOX_ID.test(value.inboxId) ||
    !OPERATION_FINGERPRINT.test(value.targetFingerprint) ||
    !OPERATION_FINGERPRINT.test(value.actorFingerprint) ||
    !OPERATION_REASON.test(value.reasonCode) ||
    !Number.isSafeInteger(value.occurredAt) || value.occurredAt < 0 ||
    (value.expiresAt !== null && (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.occurredAt)) ||
    (value.action !== "suspend" && value.expiresAt !== null) ||
    (value.action === "sandbox_reset" && value.environment !== "sandbox")
  ) throw new TypeError("entitlement operation is invalid");
  return structuredClone(value);
}

export type V2EventPutResult =
  | { readonly kind: "inserted" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "quota_exceeded"; readonly scope: "rolling_30_days"; readonly retryAt: number };

export interface V2SourceStore {
  createInbox(inbox: V2Inbox): Promise<boolean>;
  getInbox(inboxId: string): Promise<V2Inbox | null>;
  createSession(session: V2AddSourceSession): Promise<boolean>;
  getSession(sessionId: string): Promise<V2AddSourceSession | null>;
  getSessionByCode(code: string): Promise<V2AddSourceSession | null>;
  approveSession(sessionId: string, inboxId: string, sourceId: string, now: number): Promise<boolean>;
  consumeSessionWithSource(sessionId: string, source: V2Source): Promise<boolean>;
  cancelSession(sessionId: string): Promise<boolean>;
  createTransferSession(session: V2SourceTransferSession): Promise<boolean>;
  getTransferSession(sessionId: string): Promise<V2SourceTransferSession | null>;
  getTransferSessionByCode(code: string): Promise<V2SourceTransferSession | null>;
  completeTransferWithCredential(
    sessionId: string,
    inboxId: string,
    sourceId: string,
    credentialHash: string,
    ciphertext: string,
    now: number
  ): Promise<boolean>;
  consumeTransferSession(sessionId: string): Promise<boolean>;
  cancelTransferSession(sessionId: string): Promise<boolean>;
  cleanup(now: number): Promise<void>;
  getSource(sourceId: string): Promise<V2Source | null>;
  listSources(inboxId: string): Promise<V2Source[]>;
  updateSourceName(sourceId: string, name: string, now: number): Promise<boolean>;
  updateSourceEnabled(sourceId: string, enabled: boolean, now: number): Promise<boolean>;
  replaceSourceCredential(sourceId: string, credentialHash: string, now: number): Promise<boolean>;
  deleteSource(sourceId: string): Promise<boolean>;
  deleteInbox(inboxId: string): Promise<boolean>;
  deleteEvents(inboxId: string): Promise<void>;
  putEvent(source: V2Source, envelope: ProtocolV2Envelope, acceptedAt: number, policy: V2TierPolicy): Promise<V2EventPutResult>;
  listEvents(inboxId: string, now: number, policy: V2TierPolicy): Promise<ProtocolV2Envelope[]>;
  getUsage(inboxId: string, now: number, policy: V2TierPolicy): Promise<ProtocolV2UsageSnapshot>;
  applyEntitlement(claim: V2VerifiedEntitlementClaim, inboxId: string | null): Promise<V2EntitlementApplyResult>;
  applyEntitlementNotification(notificationUUID: string, notificationType: string, receivedAt: number, claim: V2VerifiedEntitlementClaim | null): Promise<V2EntitlementNotificationApplyResult>;
  reconcileEntitlement(claim: V2VerifiedEntitlementClaim): Promise<V2EntitlementReconciliationResult>;
  getAppStoreReconciliationCheckpoint(environment: Exclude<V2EntitlementEnvironment, "xcode">): Promise<number | null>;
  advanceAppStoreReconciliationCheckpoint(environment: Exclude<V2EntitlementEnvironment, "xcode">, checkpointAt: number, updatedAt: number): Promise<void>;
  applyEntitlementOperation(operation: V2EntitlementOperation): Promise<V2EntitlementOperationResult>;
  getEntitlementTier(inboxId: string, now?: number): Promise<V2Tier>;
  incrementRateLimit(scope: string, windowStart: number): Promise<number>;
}
