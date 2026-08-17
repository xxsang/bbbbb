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
  getEntitlementTier(inboxId: string): Promise<V2Tier>;
  incrementRateLimit(scope: string, windowStart: number): Promise<number>;
}
