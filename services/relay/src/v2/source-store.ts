import type { ProtocolV2Envelope } from "@bbbbbapp/protocol";

export const V2_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const V2_MAX_EVENTS = 100;
export const V2_MAX_DAILY_EVENTS = 100;

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

export type V2EventPutResult = "inserted" | "duplicate" | "quota_exceeded";

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
  putEvent(source: V2Source, envelope: ProtocolV2Envelope, acceptedAt: number): Promise<V2EventPutResult>;
  listEvents(inboxId: string, now: number): Promise<ProtocolV2Envelope[]>;
  incrementRateLimit(scope: string, windowStart: number): Promise<number>;
}
