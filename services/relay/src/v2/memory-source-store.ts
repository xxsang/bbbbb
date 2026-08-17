import { validateProtocolV2Envelope, validateProtocolV2UsageSnapshot, type ProtocolV2Envelope, type ProtocolV2UsageSnapshot } from "@bbbbbapp/protocol";
import { V2_DAY_MS, V2_ROLLING_WINDOW_MS, validateV2VerifiedEntitlementClaim, type V2AddSourceSession, type V2EntitlementApplyResult, type V2EntitlementNotificationApplyResult, type V2EventPutResult, type V2Inbox, type V2Source, type V2SourceStore, type V2SourceTransferSession, type V2TierPolicy, type V2VerifiedEntitlementClaim } from "./source-store.js";

export class MemoryV2SourceStore implements V2SourceStore {
  readonly inboxes = new Map<string, V2Inbox>();
  readonly sources = new Map<string, V2Source>();
  readonly sessions = new Map<string, V2AddSourceSession>();
  readonly transferSessions = new Map<string, V2SourceTransferSession>();
  readonly events = new Map<string, Map<string, { envelope: ProtocolV2Envelope; acceptedAt: number }>>();
  readonly usage = new Map<string, Map<string, { sourceId: string; acceptedAt: number }>>();
  readonly rates = new Map<string, number>();
  readonly entitlements = new Map<string, V2VerifiedEntitlementClaim>();
  readonly entitlementBindings = new Map<string, string>();
  readonly entitlementNotifications = new Map<string, { notificationType: string; receivedAt: number; stateChangedAt: number | null }>();
  failNextCredentialReplacement = false;

  async createInbox(inbox: V2Inbox): Promise<boolean> {
    if (this.inboxes.has(inbox.inboxId)) return false;
    this.inboxes.set(inbox.inboxId, structuredClone(inbox)); return true;
  }
  async getInbox(inboxId: string): Promise<V2Inbox | null> { return structuredClone(this.inboxes.get(inboxId) ?? null); }
  async createSession(session: V2AddSourceSession): Promise<boolean> {
    if (this.sessions.has(session.sessionId) || [...this.sessions.values()].some((value) => value.code === session.code)) return false;
    this.sessions.set(session.sessionId, structuredClone(session)); return true;
  }
  async getSession(sessionId: string): Promise<V2AddSourceSession | null> { return structuredClone(this.sessions.get(sessionId) ?? null); }
  async getSessionByCode(code: string): Promise<V2AddSourceSession | null> { return structuredClone([...this.sessions.values()].find((value) => value.code === code) ?? null); }
  async approveSession(sessionId: string, inboxId: string, sourceId: string, now: number): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "awaiting_approval" || session.expiresAt <= now) return false;
    this.sessions.set(sessionId, { ...session, inboxId, sourceId, state: "approved" }); return true;
  }
  async consumeSessionWithSource(sessionId: string, source: V2Source): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "approved" || session.inboxId !== source.inboxId || session.sourceId !== source.sourceId || this.sources.has(source.sourceId)) return false;
    this.sources.set(source.sourceId, structuredClone(source));
    this.sessions.set(sessionId, { ...session, state: "consumed" }); return true;
  }
  async cancelSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !["awaiting_approval", "approved"].includes(session.state)) return false;
    this.sessions.set(sessionId, { ...session, state: "cancelled" }); return true;
  }
  async createTransferSession(session: V2SourceTransferSession): Promise<boolean> {
    if (this.transferSessions.has(session.sessionId) || [...this.transferSessions.values()].some((value) => value.code === session.code)) return false;
    this.transferSessions.set(session.sessionId, structuredClone(session)); return true;
  }
  async getTransferSession(sessionId: string): Promise<V2SourceTransferSession | null> {
    return structuredClone(this.transferSessions.get(sessionId) ?? null);
  }
  async getTransferSessionByCode(code: string): Promise<V2SourceTransferSession | null> {
    return structuredClone([...this.transferSessions.values()].find((value) => value.code === code) ?? null);
  }
  async completeTransferWithCredential(sessionId: string, inboxId: string, sourceId: string, credentialHash: string, ciphertext: string, now: number): Promise<boolean> {
    const session = this.transferSessions.get(sessionId);
    const source = this.sources.get(sourceId);
    if (!session || session.state !== "awaiting_approval" || session.expiresAt <= now || !source || source.inboxId !== inboxId || source.method !== "http" || !source.enabled) return false;
    this.sources.set(sourceId, { ...source, credentialHash, updatedAt: now });
    this.transferSessions.set(sessionId, { ...session, inboxId, sourceId, ciphertext, state: "completed" });
    return true;
  }
  async consumeTransferSession(sessionId: string): Promise<boolean> {
    const session = this.transferSessions.get(sessionId);
    if (!session || session.state !== "completed") return false;
    this.transferSessions.set(sessionId, { ...session, ciphertext: null, state: "consumed" }); return true;
  }
  async cancelTransferSession(sessionId: string): Promise<boolean> {
    const session = this.transferSessions.get(sessionId);
    if (!session || session.state !== "awaiting_approval") return false;
    this.transferSessions.set(sessionId, { ...session, state: "cancelled" }); return true;
  }
  async cleanup(now: number): Promise<void> {
    for (const [id, session] of this.sessions) if (session.expiresAt <= now || (["consumed", "cancelled"].includes(session.state) && session.createdAt < now - 3_600_000)) this.sessions.delete(id);
    for (const [id, session] of this.transferSessions) if (session.expiresAt <= now || (["consumed", "cancelled"].includes(session.state) && session.createdAt < now - 3_600_000)) this.transferSessions.delete(id);
    for (const [inboxId, usage] of this.usage) {
      for (const [eventId, event] of usage) if (event.acceptedAt <= now - V2_ROLLING_WINDOW_MS) usage.delete(eventId);
      if (usage.size === 0) this.usage.delete(inboxId);
    }
    for (const [notificationUUID, notification] of this.entitlementNotifications) {
      if (notification.receivedAt <= now - 180 * V2_DAY_MS) this.entitlementNotifications.delete(notificationUUID);
    }
  }
  async getSource(sourceId: string): Promise<V2Source | null> { return structuredClone(this.sources.get(sourceId) ?? null); }
  async listSources(inboxId: string): Promise<V2Source[]> { return [...this.sources.values()].filter((source) => source.inboxId === inboxId).sort((left, right) => left.createdAt - right.createdAt || left.sourceId.localeCompare(right.sourceId)).map((source) => structuredClone(source)); }
  async updateSourceName(sourceId: string, name: string, now: number): Promise<boolean> { const source = this.sources.get(sourceId); if (!source) return false; this.sources.set(sourceId, { ...source, name, updatedAt: now }); return true; }
  async updateSourceEnabled(sourceId: string, enabled: boolean, now: number): Promise<boolean> { const source = this.sources.get(sourceId); if (!source) return false; this.sources.set(sourceId, { ...source, enabled, updatedAt: now }); return true; }
  async replaceSourceCredential(sourceId: string, credentialHash: string, now: number): Promise<boolean> {
    if (this.failNextCredentialReplacement) { this.failNextCredentialReplacement = false; return false; }
    const source = this.sources.get(sourceId); if (!source) return false; this.sources.set(sourceId, { ...source, credentialHash, updatedAt: now }); return true;
  }
  async deleteSource(sourceId: string): Promise<boolean> {
    const source = this.sources.get(sourceId);
    if (!source) return false;
    this.sources.delete(sourceId);
    const events = this.events.get(source.inboxId);
    if (events) {
      for (const [eventId, event] of events) if (event.envelope.sourceId === sourceId) events.delete(eventId);
      if (events.size === 0) this.events.delete(source.inboxId);
    }
    return true;
  }
  async deleteInbox(inboxId: string): Promise<boolean> {
    if (!this.inboxes.delete(inboxId)) return false;
    for (const [sourceId, source] of this.sources) if (source.inboxId === inboxId) this.sources.delete(sourceId);
    for (const [sessionId, session] of this.sessions) if (session.inboxId === inboxId) this.sessions.delete(sessionId);
    for (const [sessionId, session] of this.transferSessions) if (session.inboxId === inboxId) this.transferSessions.delete(sessionId);
    this.events.delete(inboxId);
    this.usage.delete(inboxId);
    for (const [entitlementId, boundInboxId] of this.entitlementBindings) if (boundInboxId === inboxId) this.entitlementBindings.delete(entitlementId);
    return true;
  }
  async deleteEvents(inboxId: string): Promise<void> { this.events.delete(inboxId); }
  async putEvent(source: V2Source, value: ProtocolV2Envelope, acceptedAt: number, policy: V2TierPolicy): Promise<V2EventPutResult> {
    const envelope = validateProtocolV2Envelope(value);
    if (envelope.inboxId !== source.inboxId || envelope.sourceId !== source.sourceId) throw new TypeError("envelope authority mismatch");
    await this.cleanup(acceptedAt);
    const inboxUsage = this.usage.get(source.inboxId) ?? new Map();
    if (inboxUsage.has(envelope.eventId)) return { kind: "duplicate" };
    const rollingEntries = [...inboxUsage.values()].filter((entry) => entry.acceptedAt > acceptedAt - V2_ROLLING_WINDOW_MS && entry.acceptedAt <= acceptedAt);
    if (rollingEntries.length >= policy.rolling30Days) {
      const oldest = Math.min(...rollingEntries.map((entry) => entry.acceptedAt));
      return { kind: "quota_exceeded", scope: "rolling_30_days", retryAt: oldest + V2_ROLLING_WINDOW_MS };
    }
    const inboxEvents = this.events.get(source.inboxId) ?? new Map();
    inboxUsage.set(envelope.eventId, { sourceId: source.sourceId, acceptedAt });
    this.usage.set(source.inboxId, inboxUsage);
    inboxEvents.set(envelope.eventId, { envelope: structuredClone(envelope), acceptedAt });
    const retentionStart = acceptedAt - policy.recoveryMaximumAgeDays * V2_DAY_MS;
    const newest = [...inboxEvents.entries()]
      .filter(([, entry]) => entry.acceptedAt > retentionStart)
      .sort(([, left], [, right]) => right.acceptedAt - left.acceptedAt)
      .slice(0, policy.recoveryMaximumEvents);
    this.events.set(source.inboxId, new Map(newest));
    this.sources.set(source.sourceId, { ...source, lastSuccessAt: acceptedAt, updatedAt: acceptedAt });
    return { kind: "inserted" };
  }
  async listEvents(inboxId: string, now: number, policy: V2TierPolicy): Promise<ProtocolV2Envelope[]> {
    await this.cleanup(now);
    const retentionStart = now - policy.recoveryMaximumAgeDays * V2_DAY_MS;
    const retained = [...(this.events.get(inboxId)?.entries() ?? [])]
      .filter(([, entry]) => entry.acceptedAt > retentionStart)
      .sort(([, left], [, right]) => right.acceptedAt - left.acceptedAt)
      .slice(0, policy.recoveryMaximumEvents);
    this.events.set(inboxId, new Map(retained));
    return retained
      .sort(([, left], [, right]) => left.acceptedAt - right.acceptedAt)
      .map(([, entry]) => structuredClone(entry.envelope));
  }
  async getUsage(inboxId: string, now: number, policy: V2TierPolicy): Promise<ProtocolV2UsageSnapshot> {
    await this.cleanup(now);
    const entries = [...(this.usage.get(inboxId)?.values() ?? [])].filter((entry) => entry.acceptedAt > now - V2_ROLLING_WINDOW_MS && entry.acceptedAt <= now);
    return validateProtocolV2UsageSnapshot({
      version: 2,
      tier: policy.tier,
      rolling30Days: {
        accepted: entries.length,
        limit: policy.rolling30Days,
        nextReleaseAt: entries.length === 0 ? null : new Date(Math.min(...entries.map((entry) => entry.acceptedAt)) + V2_ROLLING_WINDOW_MS).toISOString(),
      },
      burst: { limit: policy.burst },
      recovery: { maximumEvents: policy.recoveryMaximumEvents, maximumAgeDays: policy.recoveryMaximumAgeDays },
    });
  }
  async applyEntitlement(claim: V2VerifiedEntitlementClaim, inboxId: string | null): Promise<V2EntitlementApplyResult> {
    claim = validateV2VerifiedEntitlementClaim(claim);
    if (claim.status === "active" && (inboxId === null || !this.inboxes.has(inboxId))) return "inbox_unavailable";
    const current = this.entitlements.get(claim.entitlementId);
    if (current && (current.productId !== claim.productId || current.environment !== claim.environment)) return "stale";
    if (current && (current.stateChangedAt > claim.stateChangedAt || (current.stateChangedAt === claim.stateChangedAt && current.status === "revoked" && claim.status === "active"))) return "stale";
    const currentInbox = this.entitlementBindings.get(claim.entitlementId) ?? null;
    const idempotent = current?.status === claim.status && current.stateChangedAt === claim.stateChangedAt && (claim.status === "revoked" || currentInbox === inboxId);
    this.entitlements.set(claim.entitlementId, structuredClone(claim));
    for (const [entitlementId, boundInboxId] of this.entitlementBindings) {
      if (entitlementId === claim.entitlementId || (inboxId !== null && boundInboxId === inboxId)) this.entitlementBindings.delete(entitlementId);
    }
    if (claim.status === "active" && inboxId !== null) this.entitlementBindings.set(claim.entitlementId, inboxId);
    return idempotent ? "idempotent" : "applied";
  }
  async applyEntitlementNotification(notificationUUID: string, notificationType: string, receivedAt: number, claim: V2VerifiedEntitlementClaim | null): Promise<V2EntitlementNotificationApplyResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(notificationUUID) || notificationType.length < 1 || notificationType.length > 64 || !Number.isSafeInteger(receivedAt) || receivedAt < 0 || (claim !== null && (claim.status !== "revoked" || (notificationType !== "REFUND" && notificationType !== "REVOKE")))) {
      throw new TypeError("verified entitlement notification is invalid");
    }
    if (this.entitlementNotifications.has(notificationUUID)) return "idempotent";
    if (claim === null) {
      this.entitlementNotifications.set(notificationUUID, { notificationType, receivedAt, stateChangedAt: null });
      return "ignored";
    }
    const result = await this.applyEntitlement(claim, null);
    if (result === "inbox_unavailable") throw new Error("revocation cannot require an Inbox");
    this.entitlementNotifications.set(notificationUUID, { notificationType, receivedAt, stateChangedAt: claim.stateChangedAt });
    return result;
  }
  async getEntitlementTier(inboxId: string): Promise<"free" | "plus"> {
    for (const [entitlementId, boundInboxId] of this.entitlementBindings) {
      if (boundInboxId === inboxId && this.entitlements.get(entitlementId)?.status === "active") return "plus";
    }
    return "free";
  }
  async incrementRateLimit(scope: string, windowStart: number): Promise<number> { const key = `${scope}:${windowStart}`; const count = (this.rates.get(key) ?? 0) + 1; this.rates.set(key, count); return count; }
}
