import { validateProtocolV2Envelope, type ProtocolV2Envelope } from "@bbbbbapp/protocol";
import { V2_MAX_DAILY_EVENTS, V2_MAX_EVENTS, V2_RETENTION_MS, type V2AddSourceSession, type V2EventPutResult, type V2Inbox, type V2Source, type V2SourceStore, type V2SourceTransferSession } from "./source-store.js";

interface InboxRow { inbox_id: string; public_key: string; read_credential_hash: string; created_at: number }
interface SourceRow { source_id: string; inbox_id: string; name: string; method: "http" | "cli"; credential_hash: string; enabled: number; created_at: number; updated_at: number; last_success_at: number | null }
interface SessionRow { session_id: string; code: string; claim_secret_hash: string; setup_secret_hash: string; source_name: string; method: "http" | "cli"; inbox_id: string | null; source_id: string | null; state: V2AddSourceSession["state"]; created_at: number; expires_at: number }
interface TransferSessionRow { session_id: string; code: string; claim_secret_hash: string; receiver_secret_hash: string; recipient_public_key: string; receiver_label: string; inbox_id: string | null; source_id: string | null; ciphertext: string | null; state: V2SourceTransferSession["state"]; created_at: number; expires_at: number }
interface EventRow { event_id: string; envelope_json: string }

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
  constructor(private readonly database: D1Database) {}

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
    await this.database.prepare("DELETE FROM v2_add_source_sessions WHERE expires_at <= ? OR (state IN ('consumed', 'cancelled') AND created_at < ?)").bind(now, now - 60 * 60 * 1_000).run();
    await this.database.prepare("DELETE FROM v2_source_transfer_sessions WHERE expires_at <= ? OR (state IN ('consumed', 'cancelled') AND created_at < ?)").bind(now, now - 60 * 60 * 1_000).run();
    await this.database.prepare("DELETE FROM v2_events WHERE accepted_at < ?").bind(now - V2_RETENTION_MS).run();
    await this.database.prepare("DELETE FROM v2_rate_limits WHERE window_start < ?").bind(now - 24 * 60 * 60 * 1_000).run();
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
    const result = await this.database.prepare("DELETE FROM v2_sources WHERE source_id = ?").bind(sourceId).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
  async deleteInbox(inboxId: string): Promise<boolean> {
    const result = await this.database.prepare("DELETE FROM v2_inboxes WHERE inbox_id = ?").bind(inboxId).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
  async deleteEvents(inboxId: string): Promise<void> {
    await this.database.prepare("DELETE FROM v2_events WHERE inbox_id = ?").bind(inboxId).run();
  }
  async putEvent(source: V2Source, envelopeValue: ProtocolV2Envelope, acceptedAt: number): Promise<V2EventPutResult> {
    const envelope = validateProtocolV2Envelope(envelopeValue);
    if (envelope.inboxId !== source.inboxId || envelope.sourceId !== source.sourceId) throw new TypeError("envelope authority mismatch");
    const dayStart = Math.floor(acceptedAt / 86_400_000) * 86_400_000;
    const result = await this.database.prepare(`INSERT OR IGNORE INTO v2_events (inbox_id, event_id, source_id, envelope_json, accepted_at)
      SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM v2_events WHERE source_id = ? AND accepted_at >= ? AND accepted_at < ?) < ?`).bind(source.inboxId, envelope.eventId, source.sourceId, JSON.stringify(envelope), acceptedAt, source.sourceId, dayStart, dayStart + 86_400_000, V2_MAX_DAILY_EVENTS).run();
    if (Number(result.meta.changes ?? 0) === 1) {
      await this.database.prepare("UPDATE v2_sources SET last_success_at = ?, updated_at = ? WHERE source_id = ?").bind(acceptedAt, acceptedAt, source.sourceId).run();
      await this.database.prepare(`DELETE FROM v2_events WHERE inbox_id = ? AND event_id IN (SELECT event_id FROM v2_events WHERE inbox_id = ? ORDER BY accepted_at DESC, event_id DESC LIMIT -1 OFFSET ?)`).bind(source.inboxId, source.inboxId, V2_MAX_EVENTS).run();
      return "inserted";
    }
    const duplicate = await this.database.prepare("SELECT event_id FROM v2_events WHERE inbox_id = ? AND event_id = ? LIMIT 1").bind(source.inboxId, envelope.eventId).first();
    return duplicate ? "duplicate" : "quota_exceeded";
  }
  async listEvents(inboxId: string, now: number): Promise<ProtocolV2Envelope[]> {
    await this.cleanup(now);
    const rows = await this.database.prepare("SELECT event_id, envelope_json FROM v2_events WHERE inbox_id = ? ORDER BY accepted_at DESC, event_id DESC LIMIT ?").bind(inboxId, V2_MAX_EVENTS).all<EventRow>();
    const events: ProtocolV2Envelope[] = [];
    for (const row of rows.results.reverse()) {
      try { events.push(validateProtocolV2Envelope(JSON.parse(row.envelope_json))); }
      catch { await this.database.prepare("DELETE FROM v2_events WHERE inbox_id = ? AND event_id = ?").bind(inboxId, row.event_id).run(); }
    }
    return events;
  }
  async incrementRateLimit(scope: string, windowStart: number): Promise<number> {
    await this.database.prepare("INSERT INTO v2_rate_limits (scope, window_start, count) VALUES (?, ?, 1) ON CONFLICT(scope, window_start) DO UPDATE SET count = count + 1").bind(scope, windowStart).run();
    const row = await this.database.prepare("SELECT count FROM v2_rate_limits WHERE scope = ? AND window_start = ?").bind(scope, windowStart).first<{ count: number }>();
    return row?.count ?? 1;
  }
}
