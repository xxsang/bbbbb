import { validateProtocolV2Envelope, type ProtocolV2Envelope } from "@bbbbbapp/protocol";

export type ProtocolV2PutResult = "inserted" | "duplicate";

interface StoredProtocolV2Row {
  readonly eventId: string;
  readonly acceptedAt: number;
  readonly envelopeJson: string;
}

export class ProtocolV2ProofStore {
  static readonly retentionMilliseconds = 7 * 24 * 60 * 60 * 1_000;
  static readonly maximumEvents = 100;
  readonly #rows = new Map<string, StoredProtocolV2Row[]>();

  put(inboxId: string, value: unknown, acceptedAt: number): ProtocolV2PutResult {
    const envelope = validateProtocolV2Envelope(value);
    if (envelope.inboxId !== inboxId) throw new TypeError("inbox mismatch");
    const retained = this.#retainedRows(inboxId, acceptedAt);
    if (retained.some((row) => row.eventId === envelope.eventId)) return "duplicate";
    retained.push({ eventId: envelope.eventId, acceptedAt, envelopeJson: JSON.stringify(envelope) });
    retained.sort((left, right) => left.acceptedAt - right.acceptedAt);
    this.#rows.set(inboxId, retained.slice(-ProtocolV2ProofStore.maximumEvents));
    return "inserted";
  }

  list(inboxId: string, now: number): ProtocolV2Envelope[] {
    const valid: ProtocolV2Envelope[] = [];
    const retained: StoredProtocolV2Row[] = [];
    for (const row of this.#retainedRows(inboxId, now)) {
      try {
        const envelope = validateProtocolV2Envelope(JSON.parse(row.envelopeJson));
        valid.push(envelope);
        retained.push(row);
      } catch {
        // Corrupt ciphertext rows are discarded without exposing or inventing plaintext.
      }
    }
    this.#rows.set(inboxId, retained);
    return valid;
  }

  inspectRaw(inboxId: string): readonly StoredProtocolV2Row[] {
    return structuredClone(this.#rows.get(inboxId) ?? []);
  }

  injectCorruptRowForTest(inboxId: string, row: StoredProtocolV2Row): void {
    this.#rows.set(inboxId, [...(this.#rows.get(inboxId) ?? []), structuredClone(row)]);
  }

  #retainedRows(inboxId: string, now: number): StoredProtocolV2Row[] {
    const cutoff = now - ProtocolV2ProofStore.retentionMilliseconds;
    const rows = (this.#rows.get(inboxId) ?? []).filter((row) => row.acceptedAt >= cutoff);
    this.#rows.set(inboxId, rows);
    return rows;
  }
}
