import { validateProtocolV2Envelope, type ProtocolV2Envelope } from "@bbbbbapp/protocol";
import { V2_MAX_DAILY_EVENTS, V2_MAX_EVENTS, V2_RETENTION_MS, type V2AddSourceSession, type V2EventPutResult, type V2Inbox, type V2Source, type V2SourceStore, type V2SourceTransferSession } from "./source-store.js";

export class MemoryV2SourceStore implements V2SourceStore {
  readonly inboxes = new Map<string, V2Inbox>();
  readonly sources = new Map<string, V2Source>();
  readonly sessions = new Map<string, V2AddSourceSession>();
  readonly transferSessions = new Map<string, V2SourceTransferSession>();
  readonly events = new Map<string, Map<string, { envelope: ProtocolV2Envelope; acceptedAt: number }>>();
  readonly rates = new Map<string, number>();
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
    for (const [inboxId, events] of this.events) {
      for (const [eventId, event] of events) if (event.acceptedAt < now - V2_RETENTION_MS) events.delete(eventId);
      if (events.size === 0) this.events.delete(inboxId);
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
    return true;
  }
  async deleteEvents(inboxId: string): Promise<void> { this.events.delete(inboxId); }
  async putEvent(source: V2Source, value: ProtocolV2Envelope, acceptedAt: number): Promise<V2EventPutResult> {
    const envelope = validateProtocolV2Envelope(value);
    if (envelope.inboxId !== source.inboxId || envelope.sourceId !== source.sourceId) throw new TypeError("envelope authority mismatch");
    const inboxEvents = this.events.get(source.inboxId) ?? new Map();
    if (inboxEvents.has(envelope.eventId)) return "duplicate";
    const dayStart = Math.floor(acceptedAt / 86_400_000) * 86_400_000;
    if ([...inboxEvents.values()].filter((entry) => entry.envelope.sourceId === source.sourceId && entry.acceptedAt >= dayStart && entry.acceptedAt < dayStart + 86_400_000).length >= V2_MAX_DAILY_EVENTS) return "quota_exceeded";
    inboxEvents.set(envelope.eventId, { envelope: structuredClone(envelope), acceptedAt });
    const newest = [...inboxEvents.entries()].sort(([, left], [, right]) => right.acceptedAt - left.acceptedAt).slice(0, V2_MAX_EVENTS);
    this.events.set(source.inboxId, new Map(newest));
    this.sources.set(source.sourceId, { ...source, lastSuccessAt: acceptedAt, updatedAt: acceptedAt });
    return "inserted";
  }
  async listEvents(inboxId: string, now: number): Promise<ProtocolV2Envelope[]> { await this.cleanup(now); return [...(this.events.get(inboxId)?.values() ?? [])].sort((left, right) => left.acceptedAt - right.acceptedAt).map((entry) => structuredClone(entry.envelope)); }
  async incrementRateLimit(scope: string, windowStart: number): Promise<number> { const key = `${scope}:${windowStart}`; const count = (this.rates.get(key) ?? 0) + 1; this.rates.set(key, count); return count; }
}
