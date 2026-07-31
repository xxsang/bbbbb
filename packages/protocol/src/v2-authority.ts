export interface ProtocolV2SourceWriteCapability {
  readonly kind: "source-write";
  readonly inboxId: string;
  readonly sourceId: string;
  readonly source: string;
  readonly inboxPublicKey: string;
  readonly writeCredential: string;
}

export interface ProtocolV2InboxReadCapability {
  readonly kind: "inbox-read";
  readonly inboxId: string;
  readonly readCredential: string;
}

export function allowsProtocolV2HistoryRead(value: unknown): value is ProtocolV2InboxReadCapability {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "inbox-read" &&
    typeof candidate.inboxId === "string" && candidate.inboxId.length > 0 &&
    typeof candidate.readCredential === "string" && candidate.readCredential.length > 0 &&
    Object.keys(candidate).every((key) => ["kind", "inboxId", "readCredential"].includes(key));
}
