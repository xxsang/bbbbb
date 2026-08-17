import { validateProtocolV2Envelope, validateProtocolV2UsageSnapshot, type ProtocolV2Envelope, type ProtocolV2UsageSnapshot } from "@bbbbbapp/protocol";
import { V2_DAY_MS, V2_ROLLING_WINDOW_MS, validateV2VerifiedEntitlementClaim, type V2AddSourceSession, type V2EntitlementApplyResult, type V2EntitlementNotificationApplyResult, type V2EventPutResult, type V2Inbox, type V2Source, type V2SourceStore, type V2SourceTransferSession, type V2TierPolicy, type V2VerifiedEntitlementClaim } from "./source-store.js";

interface InboxRow { inbox_id: string; public_key: string; read_credential_hash: string; created_at: number }
interface SourceRow { source_id: string; inbox_id: string; name: string; method: "http" | "cli"; credential_hash: string; enabled: number; created_at: number; updated_at: number; last_success_at: number | null }
interface SessionRow { session_id: string; code: string; claim_secret_hash: string; setup_secret_hash: string; source_name: string; method: "http" | "cli"; inbox_id: string | null; source_id: string | null; state: V2AddSourceSession["state"]; created_at: number; expires_at: number }
interface TransferSessionRow { session_id: string; code: string; claim_secret_hash: string; receiver_secret_hash: string; recipient_public_key: string; receiver_label: string; inbox_id: string | null; source_id: string | null; ciphertext: string | null; state: V2SourceTransferSession["state"]; created_at: number; expires_at: number }
interface EventRow { event_id: string; envelope_json: string }
interface UsageRow { rolling_count: number; oldest_accepted_at: number | null }

export interface V2D1QueryMetrics {
  readonly label: string;
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export type V2D1MetricsObserver = (metrics: V2D1QueryMetrics) => void;

export const V2_EVENT_ADMISSION_SQL = `INSERT OR IGNORE INTO v2_event_usage (inbox_id, event_id, source_id, accepted_at, envelope_json)
  SELECT ?, ?, ?, ?, ?
  WHERE COALESCE((SELECT rolling_count FROM v2_usage_totals WHERE inbox_id = ?), 0) < ?
  RETURNING event_id`;

export const V2_ENTITLEMENT_UPSERT_SQL = `INSERT INTO v2_entitlements (entitlement_id, product_id, environment, status, state_changed_at, verified_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(entitlement_id) DO UPDATE SET status = excluded.status, state_changed_at = excluded.state_changed_at, verified_at = MAX(v2_entitlements.verified_at, excluded.verified_at)
  WHERE v2_entitlements.product_id = excluded.product_id AND v2_entitlements.environment = excluded.environment
    AND (excluded.state_changed_at > v2_entitlements.state_changed_at
      OR (excluded.state_changed_at = v2_entitlements.state_changed_at AND NOT (v2_entitlements.status = 'revoked' AND excluded.status = 'active')))`;
export const V2_ENTITLEMENT_DELETE_BINDINGS_SQL = `DELETE FROM v2_entitlement_bindings
  WHERE (entitlement_id = ? OR inbox_id = ?)
    AND EXISTS (SELECT 1 FROM v2_entitlements WHERE entitlement_id = ? AND product_id = ? AND environment = ? AND status = ? AND state_changed_at = ?)`;
export const V2_ENTITLEMENT_INSERT_BINDING_SQL = `INSERT INTO v2_entitlement_bindings (entitlement_id, inbox_id, bound_at)
  SELECT ?, ?, ? WHERE EXISTS (
    SELECT 1 FROM v2_entitlements WHERE entitlement_id = ? AND product_id = ? AND environment = ? AND status = 'active' AND state_changed_at = ?
  )`;

const inboxFromRow = (row: InboxRow): V2Inbox => ({ inboxId: row.inbox_id, publicKey: row.public_key, readCredentialHash: row.read_credential_hash, createdAt: row.created_at });
const sourceFromRow = (row: SourceRow): V2Source => ({ sourceId: row.source_id, inboxId: row.inbox_id, name: row.name, method: row.method, credentialHash: row.credential_hash, enabled: row.enabled === 1, createdAt: row.created_at, updatedAt: row.updated_at, lastSuccessAt: row.last_success_at });
const sessionFromRow = (row: SessionRow): V2AddSourceSession => ({ sessionId: row.session_id, code: row.code, claimSecretHash: row.claim_secret_hash, setupSecretHash: row.setup_secret_hash, sourceName: row.source_name, method: row.method, inboxId: row.inbox_id, sourceId: row.source_id, state: row.state, createdAt: row.created_at, expiresAt: row.expires_at });
const transferSessionFromRow = (row: TransferSessionRow): V2SourceTransferSession => ({
  sessionId: row.session_id,
  code: row.code,
  claimSecretHash: row.claim_secret_hash,
  receiverSecretHash: row.receiver_secret_hash,
  recipientPublicKey: row.recipient_public_key,
  receiverLabel: row.receiver_label,
  inboxId: row.inbox_id,
  sourceId: row.source_id,
  ciphertext: row.ciphertext,
  state: row.state,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
});

export class D1V2SourceStore implements V2SourceStore {
  constructor(private readonly database: D1Database, private readonly observeMetrics?: V2D1MetricsObserver) {}

  private recordMetrics(label: string, meta: D1Meta): void {
    this.observeMetrics?.({
      label,
      rowsRead: Number(meta.rows_read ?? 0),
      rowsWritten: Number(meta.rows_written ?? 0),
    });
  }

  private async measuredRun(label: string, statement: D1PreparedStatement): Promise<void> {
    const result = await statement.run();
    this.recordMetrics(label, result.meta);
  }

  private async measuredAll<T>(label: string, statement: D1PreparedStatement): Promise<D1Result<T>> {
    const result = await statement.all<T>();
    this.recordMetrics(label, result.meta);
    return result;
  }

  async createInbox(inbox: V2Inbox): Promise<boolean> {
    const result = await this.database.prepare("INSERT OR IGNORE INTO v2_inboxes (inbox_id, public_key, read_credential_hash, created_at) VALUES (?, ?, ?, ?)").bind(inbox.inboxId, inbox.publicKey, inbox.readCredentialHash, inbox.createdAt).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async getInbox(inboxId: string): Promise<V2Inbox | null> {
    const row = await this.database.prepare("SELECT inbox_id, public_key, read_credential_hash, created_at FROM v2_inboxes WHERE inbox_id = ? LIMIT 1").bind(inboxId).first<InboxRow>();
    return row ? inboxFromRow(row) : null;
  }
  async createSession(session: V2AddSourceSession): Promise<boolean> {
    const result = await this.database.prepare("INSERT OR IGNORE INTO v2_add_source_sessions (session_id, code, claim_secret_hash, setup_secret_hash, source_name, method, inbox_id, source_id, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'awaiting_approval', ?, ?)").bind(session.sessionId, session.code, session.claimSecretHash, session.setupSecretHash, session.sourceName, session.method, session.createdAt, session.expiresAt).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async getSession(sessionId: string): Promise<V2AddSourceSession | null> {
    const row = await this.database.prepare("SELECT * FROM v2_add_source_sessions WHERE session_id = ? LIMIT 1").bind(sessionId).first<SessionRow>();
    return row ? sessionFromRow(row) : null;
  }
  async getSessionByCode(code: string): Promise<V2AddSourceSession | null> {
    const row = await this.database.prepare("SELECT * FROM v2_add_source_sessions WHERE code = ? LIMIT 1").bind(code).first<SessionRow>();
    return row ? sessionFromRow(row) : null;
  }
  async approveSession(sessionId: string, inboxId: string, sourceId: string, now: number): Promise<boolean> {
    const result = await this.database.prepare("UPDATE v2_add_source_sessions SET inbox_id = ?, source_id = ?, state = 'approved' WHERE session_id = ? AND state = 'awaiting_approval' AND expires_at > ?").bind(inboxId, sourceId, sessionId, now).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async consumeSessionWithSource(sessionId: string, source: V2Source): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare("INSERT INTO v2_sources (source_id, inbox_id, name, method, credential_hash, enabled, created_at, updated_at, last_success_at) SELECT ?, ?, ?, ?, ?, 1, ?, ?, NULL WHERE EXISTS (SELECT 1 FROM v2_add_source_sessions WHERE session_id = ? AND state = 'approved' AND inbox_id = ? AND source_id = ?)").bind(source.sourceId, source.inboxId, source.name, source.method, source.credentialHash, source.createdAt, source.updatedAt, sessionId, source.inboxId, source.sourceId),
      this.database.prepare("UPDATE v2_add_source_sessions SET state = 'consumed' WHERE session_id = ? AND state = 'approved'").bind(sessionId),
    ]);
    return results.every((result) => result.success) && Number(results[0]?.meta.changes ?? 0) === 1 && Number(results[1]?.meta.changes ?? 0) === 1;
  }
  async cancelSession(sessionId: string): Promise<boolean> {
    const result = await this.database.prepare("UPDATE v2_add_source_sessions SET state = 'cancelled' WHERE session_id = ? AND state IN ('awaiting_approval', 'approved')").bind(sessionId).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async createTransferSession(session: V2SourceTransferSession): Promise<boolean> {
    const result = await this.database.prepare("INSERT OR IGNORE INTO v2_source_transfer_sessions (session_id, code, claim_secret_hash, receiver_secret_hash, recipient_public_key, receiver_label, inbox_id, source_id, ciphertext, state, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'awaiting_approval', ?, ?)").bind(session.sessionId, session.code, session.claimSecretHash, session.receiverSecretHash, session.recipientPublicKey, session.receiverLabel, session.createdAt, session.expiresAt).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async getTransferSession(sessionId: string): Promise<V2SourceTransferSession | null> {
    const row = await this.database.prepare("SELECT * FROM v2_source_transfer_sessions WHERE session_id = ? LIMIT 1").bind(sessionId).first<TransferSessionRow>();
    return row ? transferSessionFromRow(row) : null;
  }
  async getTransferSessionByCode(code: string): Promise<V2SourceTransferSession | null> {
    const row = await this.database.prepare("SELECT * FROM v2_source_transfer_sessions WHERE code = ? LIMIT 1").bind(code).first<TransferSessionRow>();
    return row ? transferSessionFromRow(row) : null;
  }
  async completeTransferWithCredential(sessionId: string, inboxId: string, sourceId: string, credentialHash: string, ciphertext: string, now: number): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare(`UPDATE v2_sources SET credential_hash = ?, updated_at = ?
        WHERE source_id = ? AND inbox_id = ? AND method = 'http' AND enabled = 1
        AND EXISTS (SELECT 1 FROM v2_source_transfer_sessions WHERE session_id = ? AND state = 'awaiting_approval' AND expires_at > ?)`)
        .bind(credentialHash, now, sourceId, inboxId, sessionId, now),
      this.database.prepare(`UPDATE v2_source_transfer_sessions SET inbox_id = ?, source_id = ?, ciphertext = ?, state = 'completed'
        WHERE session_id = ? AND state = 'awaiting_approval' AND expires_at > ?
        AND EXISTS (SELECT 1 FROM v2_sources WHERE source_id = ? AND inbox_id = ? AND method = 'http' AND enabled = 1)`)
        .bind(inboxId, sourceId, ciphertext, sessionId, now, sourceId, inboxId),
    ]);
    return results.every((result) => result.success) &&
      Number(results[0]?.meta.changes ?? 0) === 1 &&
      Number(results[1]?.meta.changes ?? 0) === 1;
  }
  async consumeTransferSession(sessionId: string): Promise<boolean> {
    const result = await this.database.prepare("UPDATE v2_source_transfer_sessions SET ciphertext = NULL, state = 'consumed' WHERE session_id = ? AND state = 'completed'").bind(sessionId).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async cancelTransferSession(sessionId: string): Promise<boolean> {
    const result = await this.database.prepare("UPDATE v2_source_transfer_sessions SET state = 'cancelled' WHERE session_id = ? AND state = 'awaiting_approval'").bind(sessionId).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async cleanup(now: number): Promise<void> {
    await this.measuredRun("cleanup.add_source_sessions", this.database.prepare("DELETE FROM v2_add_source_sessions WHERE expires_at <= ? OR (state IN ('consumed', 'cancelled') AND created_at < ?)").bind(now, now - 60 * 60 * 1_000));
    await this.measuredRun("cleanup.source_transfer_sessions", this.database.prepare("DELETE FROM v2_source_transfer_sessions WHERE expires_at <= ? OR (state IN ('consumed', 'cancelled') AND created_at < ?)").bind(now, now - 60 * 60 * 1_000));
    await this.measuredRun("cleanup.event_usage", this.database.prepare("DELETE FROM v2_event_usage WHERE accepted_at <= ?").bind(now - V2_ROLLING_WINDOW_MS));
    await this.measuredRun("cleanup.rate_limits", this.database.prepare("DELETE FROM v2_rate_limits WHERE window_start < ?").bind(now - 24 * 60 * 60 * 1_000));
    await this.measuredRun("cleanup.app_store_notifications_age", this.database.prepare("DELETE FROM v2_app_store_notifications WHERE received_at <= ?").bind(now - 180 * V2_DAY_MS));
    await this.measuredRun("cleanup.app_store_notifications_cap", this.database.prepare(`DELETE FROM v2_app_store_notifications WHERE notification_uuid IN (
      SELECT notification_uuid FROM v2_app_store_notifications ORDER BY received_at DESC, notification_uuid DESC LIMIT -1 OFFSET 10000
    )`));
  }
  async getSource(sourceId: string): Promise<V2Source | null> {
    const row = await this.database.prepare("SELECT * FROM v2_sources WHERE source_id = ? LIMIT 1").bind(sourceId).first<SourceRow>();
    return row ? sourceFromRow(row) : null;
  }
  async listSources(inboxId: string): Promise<V2Source[]> {
    const rows = await this.database.prepare("SELECT * FROM v2_sources WHERE inbox_id = ? ORDER BY created_at ASC, source_id ASC").bind(inboxId).all<SourceRow>();
    return rows.results.map(sourceFromRow);
  }
  async updateSourceName(sourceId: string, name: string, now: number): Promise<boolean> {
    const result = await this.database.prepare("UPDATE v2_sources SET name = ?, updated_at = ? WHERE source_id = ?").bind(name, now, sourceId).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async updateSourceEnabled(sourceId: string, enabled: boolean, now: number): Promise<boolean> {
    const result = await this.database.prepare("UPDATE v2_sources SET enabled = ?, updated_at = ? WHERE source_id = ?").bind(enabled ? 1 : 0, now, sourceId).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async replaceSourceCredential(sourceId: string, credentialHash: string, now: number): Promise<boolean> {
    const result = await this.database.prepare("UPDATE v2_sources SET credential_hash = ?, updated_at = ? WHERE source_id = ?").bind(credentialHash, now, sourceId).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  async deleteSource(sourceId: string): Promise<boolean> {
    const results = await this.database.batch([
      this.database.prepare("UPDATE v2_event_usage SET envelope_json = NULL WHERE source_id = ?").bind(sourceId),
      this.database.prepare("DELETE FROM v2_sources WHERE source_id = ?").bind(sourceId),
    ]);
    return results.every((result) => result.success) && Number(results[1]?.meta.changes ?? 0) > 0;
  }
  async deleteInbox(inboxId: string): Promise<boolean> {
    const result = await this.database.prepare("DELETE FROM v2_inboxes WHERE inbox_id = ?").bind(inboxId).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
  async deleteEvents(inboxId: string): Promise<void> {
    await this.database.prepare("UPDATE v2_event_usage SET envelope_json = NULL WHERE inbox_id = ?").bind(inboxId).run();
  }
  async putEvent(source: V2Source, envelopeValue: ProtocolV2Envelope, acceptedAt: number, policy: V2TierPolicy): Promise<V2EventPutResult> {
    const envelope = validateProtocolV2Envelope(envelopeValue);
    if (envelope.inboxId !== source.inboxId || envelope.sourceId !== source.sourceId) throw new TypeError("envelope authority mismatch");
    await this.measuredRun("admission.expire_rolling_usage", this.database.prepare("DELETE FROM v2_event_usage WHERE accepted_at <= ?").bind(acceptedAt - V2_ROLLING_WINDOW_MS));
    const admission = await this.measuredAll<{ event_id: string }>("admission.insert_and_count", this.database.prepare(V2_EVENT_ADMISSION_SQL)
      .bind(
        source.inboxId, envelope.eventId, source.sourceId, acceptedAt, JSON.stringify(envelope),
        source.inboxId, policy.rolling30Days,
      ));
    const inserted = admission.results[0];
    if (inserted?.event_id === envelope.eventId) {
      await this.measuredRun("admission.update_source", this.database.prepare("UPDATE v2_sources SET last_success_at = ?, updated_at = ? WHERE source_id = ?").bind(acceptedAt, acceptedAt, source.sourceId));
      await this.trimRetained(source.inboxId, acceptedAt, policy);
      return { kind: "inserted" };
    }
    const duplicate = await this.database.prepare("SELECT event_id FROM v2_event_usage WHERE inbox_id = ? AND event_id = ? LIMIT 1").bind(source.inboxId, envelope.eventId).first();
    if (duplicate) return { kind: "duplicate" };
    const usage = await this.usageRow(source.inboxId);
    if (usage.rolling_count >= policy.rolling30Days && usage.oldest_accepted_at !== null) {
      return { kind: "quota_exceeded", scope: "rolling_30_days", retryAt: usage.oldest_accepted_at + V2_ROLLING_WINDOW_MS };
    }
    throw new Error("event admission failed without a duplicate or rolling quota result");
  }
  async listEvents(inboxId: string, now: number, policy: V2TierPolicy): Promise<ProtocolV2Envelope[]> {
    await this.cleanup(now);
    await this.trimRetained(inboxId, now, policy);
    const rows = await this.measuredAll<EventRow>("recovery.list_retained", this.database.prepare("SELECT event_id, envelope_json FROM v2_event_usage WHERE inbox_id = ? AND envelope_json IS NOT NULL ORDER BY accepted_at DESC, event_id DESC LIMIT ?").bind(inboxId, policy.recoveryMaximumEvents));
    const events: ProtocolV2Envelope[] = [];
    for (const row of rows.results.reverse()) {
      try { events.push(validateProtocolV2Envelope(JSON.parse(row.envelope_json))); }
      catch { await this.database.prepare("UPDATE v2_event_usage SET envelope_json = NULL WHERE inbox_id = ? AND event_id = ?").bind(inboxId, row.event_id).run(); }
    }
    return events;
  }
  async getUsage(inboxId: string, now: number, policy: V2TierPolicy): Promise<ProtocolV2UsageSnapshot> {
    await this.cleanup(now);
    const usage = await this.usageRow(inboxId);
    return validateProtocolV2UsageSnapshot({
      version: 2,
      tier: policy.tier,
      rolling30Days: {
        accepted: usage.rolling_count,
        limit: policy.rolling30Days,
        nextReleaseAt: usage.oldest_accepted_at === null ? null : new Date(usage.oldest_accepted_at + V2_ROLLING_WINDOW_MS).toISOString(),
      },
      burst: { limit: policy.burst },
      recovery: { maximumEvents: policy.recoveryMaximumEvents, maximumAgeDays: policy.recoveryMaximumAgeDays },
    });
  }
  private async usageRow(inboxId: string): Promise<UsageRow> {
    const result = await this.measuredAll<UsageRow>("usage.snapshot", this.database.prepare(`SELECT
      COALESCE((SELECT rolling_count FROM v2_usage_totals WHERE inbox_id = ?), 0) AS rolling_count,
      (SELECT accepted_at FROM v2_event_usage WHERE inbox_id = ? ORDER BY accepted_at ASC, event_id ASC LIMIT 1) AS oldest_accepted_at`)
      .bind(inboxId, inboxId));
    return result.results[0] ?? { rolling_count: 0, oldest_accepted_at: null };
  }
  private async trimRetained(inboxId: string, now: number, policy: V2TierPolicy): Promise<void> {
    const retentionStart = now - policy.recoveryMaximumAgeDays * V2_DAY_MS;
    await this.measuredRun("retention.expire_envelopes", this.database.prepare("UPDATE v2_event_usage SET envelope_json = NULL WHERE inbox_id = ? AND envelope_json IS NOT NULL AND accepted_at <= ?")
      .bind(inboxId, retentionStart));
    await this.measuredRun("retention.cap_envelopes", this.database.prepare(`UPDATE v2_event_usage SET envelope_json = NULL WHERE inbox_id = ? AND event_id IN (
      SELECT event_id FROM v2_event_usage WHERE inbox_id = ? AND envelope_json IS NOT NULL
      ORDER BY accepted_at DESC, event_id DESC LIMIT -1 OFFSET ?
    )`).bind(inboxId, inboxId, policy.recoveryMaximumEvents));
  }
  async applyEntitlement(claim: V2VerifiedEntitlementClaim, inboxId: string | null): Promise<V2EntitlementApplyResult> {
    claim = validateV2VerifiedEntitlementClaim(claim);
    if (claim.status === "active") {
      if (inboxId === null || !await this.getInbox(inboxId)) return "inbox_unavailable";
    }
    const previous = await this.database.prepare("SELECT status, state_changed_at, product_id, environment FROM v2_entitlements WHERE entitlement_id = ? LIMIT 1")
      .bind(claim.entitlementId).first<{ status: string; state_changed_at: number; product_id: string; environment: string }>();
    if (previous && (previous.product_id !== claim.productId || previous.environment !== claim.environment)) return "stale";
    if (previous && (previous.state_changed_at > claim.stateChangedAt || (previous.state_changed_at === claim.stateChangedAt && previous.status === "revoked" && claim.status === "active"))) return "stale";
    const currentBinding = await this.database.prepare("SELECT inbox_id FROM v2_entitlement_bindings WHERE entitlement_id = ? LIMIT 1")
      .bind(claim.entitlementId).first<{ inbox_id: string }>();
    const idempotent = previous?.status === claim.status && previous.state_changed_at === claim.stateChangedAt && (claim.status === "revoked" || currentBinding?.inbox_id === inboxId);
    const statements = [
      this.database.prepare(V2_ENTITLEMENT_UPSERT_SQL)
        .bind(claim.entitlementId, claim.productId, claim.environment, claim.status, claim.stateChangedAt, claim.verifiedAt),
      this.database.prepare(V2_ENTITLEMENT_DELETE_BINDINGS_SQL)
        .bind(claim.entitlementId, inboxId ?? "", claim.entitlementId, claim.productId, claim.environment, claim.status, claim.stateChangedAt),
    ];
    if (claim.status === "active" && inboxId !== null) {
      statements.push(this.database.prepare(V2_ENTITLEMENT_INSERT_BINDING_SQL)
        .bind(claim.entitlementId, inboxId, claim.verifiedAt, claim.entitlementId, claim.productId, claim.environment, claim.stateChangedAt));
    }
    const results = await this.database.batch(statements);
    if (!results.every((result) => result.success)) throw new Error("entitlement persistence failed");
    if (claim.status === "active" && Number(results.at(-1)?.meta.changes ?? 0) !== 1) {
      return await this.getInbox(inboxId!) ? "stale" : "inbox_unavailable";
    }
    return idempotent ? "idempotent" : "applied";
  }
  async applyEntitlementNotification(notificationUUID: string, notificationType: string, receivedAt: number, claim: V2VerifiedEntitlementClaim | null): Promise<V2EntitlementNotificationApplyResult> {
    if (claim !== null) claim = validateV2VerifiedEntitlementClaim(claim);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(notificationUUID) || notificationType.length < 1 || notificationType.length > 64 || !Number.isSafeInteger(receivedAt) || receivedAt < 0 || (claim !== null && (claim.status !== "revoked" || (notificationType !== "REFUND" && notificationType !== "REVOKE")))) {
      throw new TypeError("verified entitlement notification is invalid");
    }
    const duplicate = await this.database.prepare("SELECT 1 FROM v2_app_store_notifications WHERE notification_uuid = ? LIMIT 1").bind(notificationUUID).first();
    if (duplicate) return "idempotent";
    if (claim === null) {
      const result = await this.database.prepare("INSERT OR IGNORE INTO v2_app_store_notifications (notification_uuid, notification_type, received_at, state_changed_at) VALUES (?, ?, ?, NULL)")
        .bind(notificationUUID, notificationType, receivedAt).run();
      if (!result.success) throw new Error("entitlement notification persistence failed");
      return Number(result.meta.changes ?? 0) === 1 ? "ignored" : "idempotent";
    }
    const previous = await this.database.prepare("SELECT status, state_changed_at, product_id, environment FROM v2_entitlements WHERE entitlement_id = ? LIMIT 1")
      .bind(claim.entitlementId).first<{ status: string; state_changed_at: number; product_id: string; environment: string }>();
    const stale = previous !== null && previous !== undefined && (
      previous.product_id !== claim.productId || previous.environment !== claim.environment ||
      previous.state_changed_at > claim.stateChangedAt
    );
    const idempotent = previous?.product_id === claim.productId && previous.environment === claim.environment &&
      previous.status === "revoked" && previous.state_changed_at === claim.stateChangedAt;
    const results = await this.database.batch([
      this.database.prepare("INSERT OR IGNORE INTO v2_app_store_notifications (notification_uuid, notification_type, received_at, state_changed_at) VALUES (?, ?, ?, ?)")
        .bind(notificationUUID, notificationType, receivedAt, claim.stateChangedAt),
      this.database.prepare(V2_ENTITLEMENT_UPSERT_SQL)
        .bind(claim.entitlementId, claim.productId, claim.environment, claim.status, claim.stateChangedAt, claim.verifiedAt),
      this.database.prepare(V2_ENTITLEMENT_DELETE_BINDINGS_SQL)
        .bind(claim.entitlementId, "", claim.entitlementId, claim.productId, claim.environment, claim.status, claim.stateChangedAt),
    ]);
    if (!results.every((result) => result.success)) throw new Error("entitlement notification persistence failed");
    if (Number(results[0]?.meta.changes ?? 0) !== 1) return "idempotent";
    return stale ? "stale" : idempotent ? "idempotent" : "applied";
  }
  async getEntitlementTier(inboxId: string): Promise<"free" | "plus"> {
    const active = await this.database.prepare(`SELECT 1 FROM v2_entitlement_bindings AS binding
      INNER JOIN v2_entitlements AS entitlement ON entitlement.entitlement_id = binding.entitlement_id
      WHERE binding.inbox_id = ? AND entitlement.status = 'active' LIMIT 1`).bind(inboxId).first();
    return active ? "plus" : "free";
  }
  async incrementRateLimit(scope: string, windowStart: number): Promise<number> {
    await this.database.prepare("INSERT INTO v2_rate_limits (scope, window_start, count) VALUES (?, ?, 1) ON CONFLICT(scope, window_start) DO UPDATE SET count = count + 1").bind(scope, windowStart).run();
    const row = await this.database.prepare("SELECT count FROM v2_rate_limits WHERE scope = ? AND window_start = ?").bind(scope, windowStart).first<{ count: number }>();
    return row?.count ?? 1;
  }
}
