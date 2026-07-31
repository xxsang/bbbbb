import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";
import { decodeBase64Url, encodeBase64Url } from "./base64url.js";
import {
  PROTOCOL_V2,
  V2_LIMITS,
  canonicalProtocolV2Bytes,
  canonicalizeProtocolV2Event,
  type ProtocolV2Event,
} from "./v2-model.js";

export const PROTOCOL_V2_HPKE_SUITE = "DHKEM-P256-HKDF-SHA256/HKDF-SHA256/AES-128-GCM" as const;
export const PROTOCOL_V2_HPKE_INFO = "bbbbb/protocol-2/event" as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm(),
});

export interface ProtocolV2Envelope {
  readonly version: typeof PROTOCOL_V2;
  readonly eventId: string;
  readonly inboxId: string;
  readonly sourceId: string;
  readonly suite: typeof PROTOCOL_V2_HPKE_SUITE;
  readonly enc: string;
  readonly ciphertext: string;
}

export interface ProtocolV2KeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

function metadata(envelope: Pick<ProtocolV2Envelope, "version" | "eventId" | "inboxId" | "sourceId" | "suite">): Uint8Array {
  return encoder.encode(JSON.stringify({
    version: envelope.version,
    eventId: envelope.eventId,
    inboxId: envelope.inboxId,
    sourceId: envelope.sourceId,
    suite: envelope.suite,
  }));
}

function boundedIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function base64Url(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

export function validateProtocolV2Envelope(value: unknown): ProtocolV2Envelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Protocol 2 envelope must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const allowed = ["version", "eventId", "inboxId", "sourceId", "suite", "enc", "ciphertext"];
  for (const key of Object.keys(candidate)) {
    if (!allowed.includes(key)) throw new TypeError(`Protocol 2 envelope has unknown field: ${key}`);
  }
  if (candidate.version !== PROTOCOL_V2) throw new TypeError("version must be 2");
  if (candidate.suite !== PROTOCOL_V2_HPKE_SUITE) throw new TypeError("HPKE suite is invalid");
  if (typeof candidate.eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.eventId)) {
    throw new TypeError("eventId must be a UUID");
  }
  const enc = base64Url(candidate.enc, "enc");
  const ciphertext = base64Url(candidate.ciphertext, "ciphertext");
  if (decodeBase64Url(enc).byteLength !== 65) throw new TypeError("enc is invalid");
  const ciphertextBytes = decodeBase64Url(ciphertext);
  if (ciphertextBytes.byteLength < 16 || ciphertextBytes.byteLength > V2_LIMITS.canonicalEventBytes + 16) {
    throw new TypeError("ciphertext is invalid");
  }
  return {
    version: PROTOCOL_V2,
    eventId: candidate.eventId,
    inboxId: boundedIdentifier(candidate.inboxId, "inboxId"),
    sourceId: boundedIdentifier(candidate.sourceId, "sourceId"),
    suite: PROTOCOL_V2_HPKE_SUITE,
    enc,
    ciphertext,
  };
}

export async function generateProtocolV2KeyPair(): Promise<ProtocolV2KeyPair> {
  const pair = await suite.kem.generateKeyPair();
  return {
    publicKey: encodeBase64Url(new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey))),
    privateKey: encodeBase64Url(new Uint8Array(await suite.kem.serializePrivateKey(pair.privateKey))),
  };
}

export async function sealProtocolV2Event(
  eventValue: unknown,
  inboxId: string,
  recipientPublicKey: string,
): Promise<ProtocolV2Envelope> {
  const event = canonicalizeProtocolV2Event(eventValue);
  const base = {
    version: PROTOCOL_V2,
    eventId: event.eventId,
    inboxId: boundedIdentifier(inboxId, "inboxId"),
    sourceId: event.sourceId,
    suite: PROTOCOL_V2_HPKE_SUITE,
  } as const;
  const publicKey = await suite.kem.deserializePublicKey(decodeBase64Url(recipientPublicKey));
  const sealed = await suite.seal(
    {
      recipientPublicKey: publicKey,
      info: encoder.encode(PROTOCOL_V2_HPKE_INFO),
    },
    canonicalProtocolV2Bytes(event),
    metadata(base),
  );
  return {
    ...base,
    enc: encodeBase64Url(new Uint8Array(sealed.enc)),
    ciphertext: encodeBase64Url(new Uint8Array(sealed.ct)),
  };
}

export async function openProtocolV2Envelope(
  envelopeValue: unknown,
  recipientPrivateKey: string,
): Promise<ProtocolV2Event> {
  const envelope = validateProtocolV2Envelope(envelopeValue);
  try {
    const privateKey = await suite.kem.deserializePrivateKey(decodeBase64Url(recipientPrivateKey));
    const plaintext = await suite.open(
      {
        recipientKey: privateKey,
        enc: decodeBase64Url(envelope.enc),
        info: encoder.encode(PROTOCOL_V2_HPKE_INFO),
      },
      decodeBase64Url(envelope.ciphertext),
      metadata(envelope),
    );
    const event = canonicalizeProtocolV2Event(JSON.parse(decoder.decode(plaintext)));
    if (event.eventId !== envelope.eventId || event.sourceId !== envelope.sourceId) {
      throw new TypeError("Authenticated metadata does not match the event");
    }
    return event;
  } catch {
    throw new TypeError("Unable to decrypt Protocol 2 event");
  }
}
