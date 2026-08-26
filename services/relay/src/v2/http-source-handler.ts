import {
  normalizeHttpV2Input,
  sealProtocolV2Event,
  validateProtocolV2Envelope,
  type HttpV2Input,
  type ProtocolV2Event,
  type ProtocolV2Envelope,
  type V2QuotaScope,
  type V2Tier,
} from "@bbbbbapp/protocol";
import { BodyTooLargeError, readBoundedBody } from "../http/bounded-body.js";
import type { V2VerifiedAppleNotification, V2VerifiedAppleTransaction } from "./apple-store-verifier.js";
import { createEntitlementRouteHandler } from "./http-entitlement-routes.js";
import { v2TierPolicy, type V2AddSourceSession, type V2EntitlementEnvironment, type V2EventPutResult, type V2Inbox, type V2Source, type V2SourceStore, type V2SourceTransferSession } from "./source-store.js";
import type { DeviceStore } from "./device-store.js";

const SESSION_TTL_MS = 5 * 60 * 1_000;
const MAX_BODY_BYTES = 16 * 1_024;
const MAX_SOURCE_NAME_BYTES = 80;
const MAX_RECEIVER_LABEL_BYTES = 48;
const EVENT_PAGE_SIZE = 50;
const IDENTIFIER = /^[A-Za-z0-9_-]{16,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const encoder = new TextEncoder();

class InvalidHttpEventInputError extends Error {}

export interface V2HttpSourceHandlerDependencies {
  readonly store: V2SourceStore;
  readonly now: () => number;
  readonly randomBytes: (length: number) => Uint8Array;
  readonly randomUUID: () => string;
  readonly hash: (value: string) => Promise<string>;
  readonly equal: (left: string, right: string) => boolean;
  readonly validateTransferRecipientKey: (value: string) => Promise<boolean>;
  readonly encryptTransferURL: (recipientPublicKey: string, sourceURL: string) => Promise<string>;
  readonly notify: (inboxId: string) => Promise<void>;
  readonly devices?: DeviceStore;
  readonly defer: (promise: Promise<void>) => void;
  readonly log: (entry: Record<string, unknown>) => void;
  readonly resolveTier?: (inboxId: string, now: number) => Promise<V2Tier>;
  readonly verifyEntitlementTransaction?: (signedTransaction: string, now: number) => Promise<V2VerifiedAppleTransaction>;
  readonly verifyEntitlementNotification?: (signedPayload: string, now: number) => Promise<V2VerifiedAppleNotification>;
  readonly deriveEntitlementId?: (originalTransactionId: string, environment: V2EntitlementEnvironment) => Promise<string>;
  readonly authorizeEntitlementOperator?: (token: string) => Promise<string | null>;
}

const json = (body: unknown, status = 200, extra: HeadersInit = {}) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store", ...extra },
});
const secret = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const eventCursor = (eventId: string) => Buffer.from(eventId, "utf8").toString("base64url");
const eventIDFromCursor = (value: string): string | null => {
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(value)) return null;
  try {
    const eventId = Buffer.from(value, "base64url").toString("utf8");
    return Buffer.from(eventId, "utf8").toString("base64url") === value && UUID.test(eventId)
      ? eventId
      : null;
  } catch { return null; }
};
const bearer = (request: Request) => {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") && value.length <= 512 ? value.slice(7) : null;
};
const sourceURL = (request: Request, sourceId: string, credential: string) => {
  const url = new URL(request.url);
  url.pathname = `/v2/sources/${sourceId}/events`;
  url.search = `?key=${encodeURIComponent(credential)}`;
  return url.toString();
};
const publicSource = (source: V2Source) => ({
  sourceId: source.sourceId,
  name: source.name,
  method: source.method,
  enabled: source.enabled,
  createdAt: new Date(source.createdAt).toISOString(),
  updatedAt: new Date(source.updatedAt).toISOString(),
  ...(source.lastSuccessAt === null ? {} : { lastSuccessAt: new Date(source.lastSuccessAt).toISOString() }),
});

const quotaResponse = (scope: V2QuotaScope, retryAt: number, now: number) => json({
  error: "inbox_quota_exceeded",
  scope,
  retryAt: new Date(retryAt).toISOString(),
}, 429, { "retry-after": String(Math.max(1, Math.ceil((retryAt - now) / 1_000))) });

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && encoder.encode(name).byteLength <= MAX_SOURCE_NAME_BYTES ? name : null;
}

function cleanReceiverLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  return label.length > 0 && encoder.encode(label).byteLength <= MAX_RECEIVER_LABEL_BYTES ? label : null;
}

async function inputBody(request: Request): Promise<HttpV2Input> {
  const raw = await readBoundedBody(request, MAX_BODY_BYTES);
  if (raw.length === 0) return {};
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === "application/json") return JSON.parse(raw) as HttpV2Input;
  if (type === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams(raw);
    const allowed = new Set(["category", "label", "work", "message", "details"]);
    for (const key of form.keys()) if (!allowed.has(key)) throw new TypeError("unknown form field");
    const detailsValue = form.get("details");
    return {
      ...(form.has("category") ? { category: form.get("category") } : {}),
      ...(form.has("label") ? { label: form.get("label") } : {}),
      ...(form.has("work") ? { work: form.get("work") } : {}),
      ...(form.has("message") ? { message: form.get("message") } : {}),
      ...(detailsValue === null ? {} : { details: JSON.parse(detailsValue) }),
    };
  }
  throw new TypeError("unsupported content type");
}

export function createV2HttpSourceHandler(deps: V2HttpSourceHandlerDependencies) {
  const policyFor = async (inboxId: string) => v2TierPolicy(await (deps.resolveTier?.(inboxId, deps.now()) ?? Promise.resolve("free")));
  const authorizedInbox = async (request: Request, inboxId: string): Promise<V2Inbox | null> => {
    const presented = bearer(request);
    if (!presented) return null;
    const inbox = await deps.store.getInbox(inboxId);
    return inbox && deps.equal(await deps.hash(presented), inbox.readCredentialHash) ? inbox : null;
  };

  const acceptEvent = async (source: V2Source, input: HttpV2Input, eventId: string): Promise<Response> => {
    const inbox = await deps.store.getInbox(source.inboxId);
    if (!inbox) return json({ error: "source_unavailable" }, 404);
    const acceptedAt = deps.now();
    let event: ProtocolV2Event;
    try {
      event = normalizeHttpV2Input(input, {
        eventId,
        sourceId: source.sourceId,
        source: source.name,
        sourceMethod: source.method,
        occurredAt: new Date(acceptedAt).toISOString(),
      });
    } catch {
      deps.log({ event: "v2_event_rejected", kind: "validation" });
      throw new InvalidHttpEventInputError();
    }
    let envelope: ProtocolV2Envelope;
    try {
      envelope = await sealProtocolV2Event(event, source.inboxId, inbox.publicKey);
    } catch {
      deps.log({ event: "v2_event_failed", kind: "sealing" });
      throw new Error("event sealing failed");
    }
    let result: V2EventPutResult;
    try {
      result = await deps.store.putEvent(source, envelope, acceptedAt, await policyFor(source.inboxId));
    } catch {
      deps.log({ event: "v2_event_failed", kind: "storage" });
      throw new Error("event storage failed");
    }
    if (result.kind === "quota_exceeded") return quotaResponse(result.scope, result.retryAt, acceptedAt);
    if (result.kind === "inserted") deps.defer(deps.notify(source.inboxId).catch(() => deps.log({ event: "v2_apns_failed" })));
    deps.log({ event: "v2_event_accepted", duplicate: result.kind === "duplicate" });
    return json({ accepted: true, duplicate: result.kind === "duplicate", eventId }, 202);
  };

  const acceptEnvelope = async (source: V2Source, value: unknown): Promise<Response> => {
    const envelope = validateProtocolV2Envelope(value);
    if (envelope.inboxId !== source.inboxId || envelope.sourceId !== source.sourceId) {
      return json({ error: "invalid_input" }, 400);
    }
    const acceptedAt = deps.now();
    const result = await deps.store.putEvent(source, envelope, acceptedAt, await policyFor(source.inboxId));
    if (result.kind === "quota_exceeded") return quotaResponse(result.scope, result.retryAt, acceptedAt);
    if (result.kind === "inserted") deps.defer(deps.notify(source.inboxId).catch(() => deps.log({ event: "v2_apns_failed" })));
    deps.log({ event: "v2_event_accepted", duplicate: result.kind === "duplicate", sealedAtSource: true });
    return json({ accepted: true, duplicate: result.kind === "duplicate", eventId: envelope.eventId }, 202);
  };

  const entitlementRoute = createEntitlementRouteHandler({
    store: deps.store,
    hash: deps.hash,
    log: deps.log,
    authorizeInbox: authorizedInbox,
    authorizeOperator: deps.authorizeEntitlementOperator,
    verifyTransaction: deps.verifyEntitlementTransaction,
    verifyNotification: deps.verifyEntitlementNotification,
    deriveEntitlementId: deps.deriveEntitlementId,
  });

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const now = deps.now();
    try {
      const entitlementResponse = await entitlementRoute(request, url, now);
      if (entitlementResponse) return entitlementResponse;
      if (request.method === "POST" && url.pathname === "/v2/inboxes") {
        const ipScope = await deps.hash(request.headers.get("cf-connecting-ip") ?? "unknown");
        const windowStart = Math.floor(now / 60_000) * 60_000;
        if (await deps.store.incrementRateLimit(`inbox:${ipScope}`, windowStart) > 4) return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
        const value = JSON.parse(await readBoundedBody(request, 4_096)) as Record<string, unknown>;
        if (Object.keys(value).some((key) => !["inboxId", "publicKey", "readCredential"].includes(key)) || !IDENTIFIER.test(String(value.inboxId ?? "")) || typeof value.publicKey !== "string" || value.publicKey.length > 512 || typeof value.readCredential !== "string" || value.readCredential.length < 32 || value.readCredential.length > 256) return json({ error: "invalid_request" }, 400);
        const inbox: V2Inbox = { inboxId: String(value.inboxId), publicKey: value.publicKey, readCredentialHash: await deps.hash(value.readCredential), createdAt: now };
        return (await deps.store.createInbox(inbox)) ? json({ created: true, inboxId: inbox.inboxId }, 201) : json({ error: "inbox_exists" }, 409);
      }

      const inbox = /^\/v2\/inboxes\/([A-Za-z0-9_-]{16,128})$/u.exec(url.pathname);
      if (inbox && request.method === "DELETE") {
        if (!await authorizedInbox(request, inbox[1]!)) return json({ error: "unauthorized" }, 401);
        if (deps.devices) await deps.devices.remove(inbox[1]!);
        if (!await deps.store.deleteInbox(inbox[1]!)) return json({ error: "inbox_unavailable" }, 404);
        deps.log({ event: "v2_inbox_deleted" });
        return new Response(null, { status: 204 });
      }

      if (request.method === "POST" && (url.pathname === "/v2/add-source/sessions" || url.pathname === "/v2/cli-sources/sessions")) {
        const value = JSON.parse(await readBoundedBody(request, 4_096)) as Record<string, unknown>;
        const sourceName = cleanName(value.sourceName);
        if (!sourceName || Object.keys(value).some((key) => key !== "sourceName")) return json({ error: "invalid_request" }, 400);
        const method = url.pathname === "/v2/cli-sources/sessions" ? "cli" : "http";
        const ipScope = await deps.hash(request.headers.get("cf-connecting-ip") ?? "unknown");
        const windowStart = Math.floor(now / 60_000) * 60_000;
        if (await deps.store.incrementRateLimit(`session:${ipScope}`, windowStart) > 8) return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
        await deps.store.cleanup(now);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const bytes = deps.randomBytes(52);
          if (bytes.byteLength !== 52) break;
          const digits = String(new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) % 1_000_000).padStart(6, "0");
          const setupSecret = secret(bytes.slice(4, 28));
          const claimSecret = secret(bytes.slice(28, 52));
          const session: V2AddSourceSession = {
            sessionId: secret(deps.randomBytes(18)), code: `${digits.slice(0, 3)}-${digits.slice(3)}`,
            claimSecretHash: await deps.hash(claimSecret), setupSecretHash: await deps.hash(setupSecret),
            sourceName, method, inboxId: null, sourceId: null, state: "awaiting_approval", createdAt: now, expiresAt: now + SESSION_TTL_MS,
          };
          if (await deps.store.createSession(session)) {
            deps.log({ event: "v2_add_source_session_created" });
            return json({ version: 2, sessionId: session.sessionId, code: session.code, setupSecret, claimURL: `bbbbb://add-source?session=${session.sessionId}&secret=${claimSecret}`, expiresAt: new Date(session.expiresAt).toISOString(), pollAfterMs: 1_000 }, 201);
          }
        }
        return json({ error: "temporarily_unavailable" }, 503);
      }

      if (request.method === "POST" && url.pathname === "/v2/source-transfers/sessions") {
        const value = JSON.parse(await readBoundedBody(request, 4_096)) as Record<string, unknown>;
        const recipientPublicKey = typeof value.recipientPublicKey === "string" ? value.recipientPublicKey : "";
        const receiverLabel = cleanReceiverLabel(value.receiverLabel);
        if (
          !receiverLabel ||
          Object.keys(value).some((key) => !["recipientPublicKey", "receiverLabel"].includes(key)) ||
          !await deps.validateTransferRecipientKey(recipientPublicKey)
        ) return json({ error: "invalid_request" }, 400);
        const ipScope = await deps.hash(request.headers.get("cf-connecting-ip") ?? "unknown");
        const windowStart = Math.floor(now / 60_000) * 60_000;
        if (await deps.store.incrementRateLimit(`transfer:${ipScope}`, windowStart) > 8) return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
        await deps.store.cleanup(now);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const bytes = deps.randomBytes(52);
          if (bytes.byteLength !== 52) break;
          const digits = String(new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0) % 1_000_000).padStart(6, "0");
          const receiverSecret = secret(bytes.slice(4, 28));
          const claimSecret = secret(bytes.slice(28, 52));
          const session: V2SourceTransferSession = {
            sessionId: secret(deps.randomBytes(18)),
            code: `${digits.slice(0, 3)}-${digits.slice(3)}`,
            claimSecretHash: await deps.hash(claimSecret),
            receiverSecretHash: await deps.hash(receiverSecret),
            recipientPublicKey,
            receiverLabel,
            inboxId: null,
            sourceId: null,
            ciphertext: null,
            state: "awaiting_approval",
            createdAt: now,
            expiresAt: now + SESSION_TTL_MS,
          };
          if (await deps.store.createTransferSession(session)) {
            const claimURL = `bbbbb://source-transfer?session=${session.sessionId}&secret=${claimSecret}`;
            deps.log({ event: "v2_source_transfer_session_created" });
            return json({
              version: 2,
              sessionId: session.sessionId,
              code: session.code,
              receiverSecret,
              claimURL,
              expiresAt: new Date(session.expiresAt).toISOString(),
              pollAfterMs: 1_000,
            }, 201, {
              "x-bbbbb-session": session.sessionId,
              "x-bbbbb-code": session.code,
              "x-bbbbb-receiver-secret": receiverSecret,
            });
          }
        }
        return json({ error: "temporarily_unavailable" }, 503);
      }

      const transferMatch = /^\/v2\/source-transfers\/sessions\/([A-Za-z0-9_-]{16,128})(?:\/(claim|complete))?$/u.exec(url.pathname);
      if (transferMatch) {
        const session = await deps.store.getTransferSession(transferMatch[1]!);
        if (!session || session.expiresAt <= now || ["consumed", "cancelled"].includes(session.state)) {
          return json({ error: "session_unavailable" }, 404);
        }
        if (!transferMatch[2] && request.method === "GET") {
          const presented = bearer(request);
          if (!presented || !deps.equal(await deps.hash(presented), session.receiverSecretHash)) return json({ error: "unauthorized" }, 401);
          const wantsCiphertext = url.searchParams.get("format") === "ciphertext";
          if (session.state !== "completed") {
            return wantsCiphertext
              ? new Response(null, { status: 202, headers: { "cache-control": "no-store", "retry-after": "1" } })
              : json({ version: 2, state: session.state, expiresAt: new Date(session.expiresAt).toISOString() }, 200, { "retry-after": "1" });
          }
          if (!session.ciphertext || !await deps.store.consumeTransferSession(session.sessionId)) return json({ error: "invalid_state" }, 409);
          deps.log({ event: "v2_source_transfer_consumed" });
          if (wantsCiphertext) {
            return new Response(Buffer.from(session.ciphertext, "base64url"), {
              status: 200,
              headers: {
                "cache-control": "no-store",
                "content-type": "application/octet-stream",
                "content-disposition": "attachment; filename=bbbbb-source-transfer.bin",
              },
            });
          }
          return json({ version: 2, state: "completed", ciphertext: session.ciphertext });
        }
        if (!transferMatch[2] && request.method === "DELETE") {
          const presented = bearer(request);
          if (!presented || !deps.equal(await deps.hash(presented), session.receiverSecretHash)) return json({ error: "unauthorized" }, 401);
          return (await deps.store.cancelTransferSession(session.sessionId)) ? new Response(null, { status: 204 }) : json({ error: "invalid_state" }, 409);
        }
        if (transferMatch[2] === "claim" && request.method === "POST") {
          const value = JSON.parse(await readBoundedBody(request, 2_048)) as Record<string, unknown>;
          if (
            Object.keys(value).some((key) => key !== "claimSecret") ||
            typeof value.claimSecret !== "string" ||
            !deps.equal(await deps.hash(value.claimSecret), session.claimSecretHash)
          ) return json({ error: "session_unavailable" }, 404);
          return json({ version: 2, sessionId: session.sessionId, receiverLabel: session.receiverLabel, expiresAt: new Date(session.expiresAt).toISOString() });
        }
        if (transferMatch[2] === "complete" && request.method === "POST") {
          const value = JSON.parse(await readBoundedBody(request, 2_048)) as Record<string, unknown>;
          if (Object.keys(value).some((key) => !["inboxId", "sourceId", "code", "claimSecret"].includes(key))) return json({ error: "invalid_request" }, 400);
          const inboxId = typeof value.inboxId === "string" ? value.inboxId : "";
          const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
          const code = typeof value.code === "string" ? value.code.replace(/\D/gu, "") : "";
          const claimMatches = typeof value.claimSecret === "string" && deps.equal(await deps.hash(value.claimSecret), session.claimSecretHash);
          const codeMatches = code.length === 6 && `${code.slice(0, 3)}-${code.slice(3)}` === session.code;
          if (!await authorizedInbox(request, inboxId) || (!claimMatches && !codeMatches) || !IDENTIFIER.test(sourceId)) return json({ error: "unauthorized" }, 401);
          const source = await deps.store.getSource(sourceId);
          if (!source || source.inboxId !== inboxId || source.method !== "http" || !source.enabled) return json({ error: "source_unavailable" }, 404);
          const credential = secret(deps.randomBytes(32));
          const nextSourceURL = sourceURL(request, source.sourceId, credential);
          const ciphertext = await deps.encryptTransferURL(session.recipientPublicKey, nextSourceURL);
          if (!await deps.store.completeTransferWithCredential(
            session.sessionId,
            inboxId,
            source.sourceId,
            await deps.hash(credential),
            ciphertext,
            now
          )) return json({ error: "invalid_state" }, 409);
          deps.log({ event: "v2_source_transfer_completed" });
          return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      if (request.method === "POST" && url.pathname === "/v2/source-transfers/claims") {
        const value = JSON.parse(await readBoundedBody(request, 2_048)) as Record<string, unknown>;
        if (Object.keys(value).some((key) => !["inboxId", "code"].includes(key))) return json({ error: "invalid_request" }, 400);
        const code = typeof value.code === "string" ? value.code.replace(/\D/gu, "") : "";
        if (code.length !== 6) return json({ error: "invalid_request" }, 400);
        const ipScope = await deps.hash(request.headers.get("cf-connecting-ip") ?? "unknown");
        const windowStart = Math.floor(now / 60_000) * 60_000;
        if (await deps.store.incrementRateLimit(`transfer-claim:${ipScope}`, windowStart) > 12) return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
        const session = await deps.store.getTransferSessionByCode(`${code.slice(0, 3)}-${code.slice(3)}`);
        if (!session || session.expiresAt <= now || session.state !== "awaiting_approval") return json({ error: "session_unavailable" }, 404);
        const inboxId = typeof value.inboxId === "string" ? value.inboxId : "";
        if (!await authorizedInbox(request, inboxId)) return json({ error: "unauthorized" }, 401);
        return json({ version: 2, sessionId: session.sessionId, receiverLabel: session.receiverLabel, expiresAt: new Date(session.expiresAt).toISOString() });
      }

      const sessionMatch = /^\/v2\/add-source\/sessions\/([A-Za-z0-9_-]{16,128})(?:\/(claim|approve))?$/u.exec(url.pathname);
      if (sessionMatch) {
        const session = await deps.store.getSession(sessionMatch[1]!);
        if (!session || session.expiresAt <= now || session.state === "cancelled") return json({ error: "session_unavailable" }, 404);
        if (!sessionMatch[2] && request.method === "GET") {
          const presented = bearer(request);
          if (!presented || !deps.equal(await deps.hash(presented), session.setupSecretHash)) return json({ error: "unauthorized" }, 401);
          if (session.state !== "approved") return json({ version: 2, state: session.state, expiresAt: new Date(session.expiresAt).toISOString() }, 200, { "retry-after": "1" });
          if (!session.inboxId || !session.sourceId) return json({ error: "invalid_state" }, 409);
          const credential = secret(deps.randomBytes(32));
          const source: V2Source = { sourceId: session.sourceId, inboxId: session.inboxId, name: session.sourceName, method: session.method, credentialHash: await deps.hash(credential), enabled: true, createdAt: now, updatedAt: now, lastSuccessAt: null };
          if (!await deps.store.consumeSessionWithSource(session.sessionId, source)) return json({ error: "invalid_state" }, 409);
          deps.log({ event: "v2_add_source_credential_issued" });
          if (source.method === "http") {
            return json({ version: 2, state: "completed", source: publicSource(source), sourceURL: sourceURL(request, source.sourceId, credential) });
          }
          const inbox = await deps.store.getInbox(source.inboxId);
          if (!inbox) return json({ error: "invalid_state" }, 409);
          return json({
            version: 2,
            state: "completed",
            source: publicSource(source),
            profile: {
              version: 2,
              relay: new URL(request.url).origin,
              inboxId: source.inboxId,
              sourceId: source.sourceId,
              source: source.name,
              inboxPublicKey: inbox.publicKey,
              writeCredential: credential,
            },
          });
        }
        if (!sessionMatch[2] && request.method === "DELETE") {
          const presented = bearer(request);
          if (!presented || !deps.equal(await deps.hash(presented), session.setupSecretHash)) return json({ error: "unauthorized" }, 401);
          return (await deps.store.cancelSession(session.sessionId)) ? new Response(null, { status: 204 }) : json({ error: "invalid_state" }, 409);
        }
        if (sessionMatch[2] === "claim" && request.method === "POST") {
          const value = JSON.parse(await readBoundedBody(request, 2_048)) as Record<string, unknown>;
          if (typeof value.claimSecret !== "string" || !deps.equal(await deps.hash(value.claimSecret), session.claimSecretHash)) return json({ error: "session_unavailable" }, 404);
          return json({ version: 2, sessionId: session.sessionId, sourceName: session.sourceName, method: session.method, trust: session.method === "cli" ? "This Source encrypts activity before sending it to your private inbox." : "This Source can send activity to your private inbox.", expiresAt: new Date(session.expiresAt).toISOString() });
        }
        if (sessionMatch[2] === "approve" && request.method === "POST") {
          const value = JSON.parse(await readBoundedBody(request, 2_048)) as Record<string, unknown>;
          const inboxId = typeof value.inboxId === "string" ? value.inboxId : "";
          const code = typeof value.code === "string" ? value.code.replace(/\D/gu, "") : "";
          const claimMatches = typeof value.claimSecret === "string" && deps.equal(await deps.hash(value.claimSecret), session.claimSecretHash);
          const codeMatches = code.length === 6 && `${code.slice(0, 3)}-${code.slice(3)}` === session.code;
          if (!await authorizedInbox(request, inboxId) || (!claimMatches && !codeMatches)) return json({ error: "unauthorized" }, 401);
          const sourceId = secret(deps.randomBytes(18));
          if (!await deps.store.approveSession(session.sessionId, inboxId, sourceId, now)) return json({ error: "invalid_state" }, 409);
          deps.log({ event: "v2_add_source_approved" });
          return new Response(null, {
            status: 204,
            headers: {
              "cache-control": "no-store",
              "x-bbbbb-source-id": sourceId,
            },
          });
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      if (request.method === "POST" && url.pathname === "/v2/add-source/claims") {
        const value = JSON.parse(await readBoundedBody(request, 2_048)) as Record<string, unknown>;
        const code = typeof value.code === "string" ? value.code.replace(/\D/gu, "") : "";
        if (code.length !== 6) return json({ error: "invalid_request" }, 400);
        const session = await deps.store.getSessionByCode(`${code.slice(0, 3)}-${code.slice(3)}`);
        if (!session || session.expiresAt <= now || session.state !== "awaiting_approval") return json({ error: "session_unavailable" }, 404);
        const inboxId = typeof value.inboxId === "string" ? value.inboxId : "";
        if (!await authorizedInbox(request, inboxId)) return json({ error: "unauthorized" }, 401);
        return json({ version: 2, sessionId: session.sessionId, sourceName: session.sourceName, method: session.method, trust: session.method === "cli" ? "This Source encrypts activity before sending it to your private inbox." : "This Source can send activity to your private inbox.", expiresAt: new Date(session.expiresAt).toISOString() });
      }

      const eventMatch = /^\/v2\/sources\/([A-Za-z0-9_-]{16,128})\/events$/u.exec(url.pathname);
      if (eventMatch && (request.method === "GET" || request.method === "POST")) {
        const source = await deps.store.getSource(eventMatch[1]!);
        const credential = bearer(request) ?? url.searchParams.get("key");
        if (!source || !credential || !deps.equal(await deps.hash(credential), source.credentialHash)) return json({ error: "unauthorized" }, 401);
        if (!source.enabled) return json({ error: "source_disabled" }, 403);
        if (request.method === "GET") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
        const windowStart = Math.floor(now / 60_000) * 60_000;
        const policy = await policyFor(source.inboxId);
        if (await deps.store.incrementRateLimit(`submission:${source.inboxId}`, windowStart) > policy.burst) {
          return quotaResponse("burst", windowStart + 60_000, now);
        }
        if (source.method === "cli") {
          try {
            const raw = await readBoundedBody(request, 24 * 1_024);
            if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new TypeError("invalid content type");
            return await acceptEnvelope(source, JSON.parse(raw));
          } catch (error) {
            return json({ error: error instanceof BodyTooLargeError ? "body_too_large" : "invalid_input" }, error instanceof BodyTooLargeError ? 413 : 400);
          }
        }
        let input: HttpV2Input;
        try { input = await inputBody(request); }
        catch (error) { return json({ error: error instanceof BodyTooLargeError ? "body_too_large" : "invalid_input" }, error instanceof BodyTooLargeError ? 413 : 400); }
        const requestedId = request.headers.get("idempotency-key");
        const eventId = requestedId && UUID.test(requestedId) ? requestedId : deps.randomUUID();
        try { return await acceptEvent(source, input, eventId); }
        catch (error) {
          return error instanceof InvalidHttpEventInputError
            ? json({ error: "invalid_input" }, 400)
            : json({ error: "temporarily_unavailable" }, 503);
        }
      }

      const inboxEvents = /^\/v2\/inboxes\/([A-Za-z0-9_-]{16,128})\/events$/u.exec(url.pathname);
      if (inboxEvents && request.method === "GET") {
        if (!await authorizedInbox(request, inboxEvents[1]!)) return json({ error: "unauthorized" }, 401);
        const cursorValues = url.searchParams.getAll("cursor");
        if (cursorValues.length > 1) return json({ error: "invalid_cursor" }, 400);
        const cursorEventId = cursorValues.length === 0 ? null : eventIDFromCursor(cursorValues[0]!);
        if (cursorValues.length === 1 && cursorEventId === null) return json({ error: "invalid_cursor" }, 400);
        const retained = await deps.store.listEvents(inboxEvents[1]!, now, await policyFor(inboxEvents[1]!));
        const newestFirst = [...retained].reverse();
        const cursorIndex = cursorEventId === null
          ? -1
          : newestFirst.findIndex((event) => event.eventId === cursorEventId);
        if (cursorEventId !== null && cursorIndex < 0) return json({ error: "invalid_cursor" }, 400);
        const pageNewestFirst = newestFirst.slice(cursorIndex + 1, cursorIndex + 1 + EVENT_PAGE_SIZE);
        const hasMore = cursorIndex + 1 + pageNewestFirst.length < newestFirst.length;
        const nextCursor = hasMore && pageNewestFirst.length > 0
          ? eventCursor(pageNewestFirst[pageNewestFirst.length - 1]!.eventId)
          : null;
        return json({
          version: 2,
          events: [...pageNewestFirst].reverse(),
          ...(nextCursor === null ? {} : { nextCursor }),
        });
      }

      const inboxUsage = /^\/v2\/inboxes\/([A-Za-z0-9_-]{16,128})\/usage$/u.exec(url.pathname);
      if (inboxUsage && request.method === "GET") {
        if (!await authorizedInbox(request, inboxUsage[1]!)) return json({ error: "unauthorized" }, 401);
        return json(await deps.store.getUsage(inboxUsage[1]!, now, await policyFor(inboxUsage[1]!)));
      }

      if (inboxEvents && request.method === "DELETE") {
        if (!await authorizedInbox(request, inboxEvents[1]!)) return json({ error: "unauthorized" }, 401);
        await deps.store.deleteEvents(inboxEvents[1]!);
        deps.log({ event: "v2_events_deleted" });
        return new Response(null, { status: 204 });
      }

      const inboxDevice = /^\/v2\/inboxes\/([A-Za-z0-9_-]{16,128})\/device$/u.exec(url.pathname);
      if (inboxDevice && deps.devices) {
        const inboxId = inboxDevice[1]!;
        if (!await authorizedInbox(request, inboxId)) return json({ error: "unauthorized" }, 401);
        if (request.method === "GET") return (await deps.devices.get(inboxId)) ? new Response(null, { status: 204, headers: { "cache-control": "no-store" } }) : json({ registered: false }, 404);
        if (request.method === "DELETE") { await deps.devices.remove(inboxId); deps.log({ event: "v2_device_removed" }); return new Response(null, { status: 204 }); }
        if (request.method === "PUT") {
          const value = JSON.parse(await readBoundedBody(request, 512)) as Record<string, unknown>;
          if (Object.keys(value).length !== 2 || typeof value.token !== "string" || !/^[a-f0-9]{64,200}$/u.test(value.token) || value.token.length % 2 !== 0 || (value.environment !== "sandbox" && value.environment !== "production")) return json({ error: "invalid_device" }, 400);
          await deps.devices.replace(inboxId, { token: value.token, environment: value.environment, updatedAt: now });
          deps.log({ event: "v2_device_registered", environment: value.environment });
          return new Response(null, { status: 204 });
        }
        return json({ error: "method_not_allowed" }, 405);
      }

      const sources = /^\/v2\/inboxes\/([A-Za-z0-9_-]{16,128})\/sources(?:\/([A-Za-z0-9_-]{16,128})(?:\/(test|credential))?)?$/u.exec(url.pathname);
      if (sources) {
        const inboxId = sources[1]!; const sourceId = sources[2]; const action = sources[3];
        if (!await authorizedInbox(request, inboxId)) return json({ error: "unauthorized" }, 401);
        if (!sourceId && request.method === "GET") return json({ version: 2, sources: (await deps.store.listSources(inboxId)).map(publicSource) });
        const source = sourceId ? await deps.store.getSource(sourceId) : null;
        if (!source || source.inboxId !== inboxId) return json({ error: "source_unavailable" }, 404);
        if (!action && request.method === "GET") return json({ version: 2, source: publicSource(source) });
        if (!action && request.method === "PATCH") {
          const value = JSON.parse(await readBoundedBody(request, 2_048)) as Record<string, unknown>;
          if (Object.keys(value).length !== 1) return json({ error: "invalid_request" }, 400);
          if ("name" in value) { const name = cleanName(value.name); if (!name) return json({ error: "invalid_request" }, 400); await deps.store.updateSourceName(source.sourceId, name, now); }
          else if (typeof value.enabled === "boolean") await deps.store.updateSourceEnabled(source.sourceId, value.enabled, now);
          else return json({ error: "invalid_request" }, 400);
          const updated = await deps.store.getSource(source.sourceId);
          return json({ version: 2, source: publicSource(updated!) });
        }
        if (!action && request.method === "DELETE") return (await deps.store.deleteSource(source.sourceId)) ? new Response(null, { status: 204 }) : json({ error: "source_unavailable" }, 404);
        if (action === "test" && request.method === "POST") return acceptEvent(source, { category: "activity", label: "Test", work: "Setup test", message: "bbbbb can receive activity from this Source." }, deps.randomUUID());
        if (action === "credential" && request.method === "POST") {
          const credential = secret(deps.randomBytes(32));
          if (!await deps.store.replaceSourceCredential(source.sourceId, await deps.hash(credential), now)) return json({ error: "storage_unavailable" }, 503);
          deps.log({ event: "v2_source_credential_replaced" });
          return json({ version: 2, sourceURL: sourceURL(request, source.sourceId, credential) });
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      deps.log({ event: "v2_request_failed", kind: error instanceof BodyTooLargeError ? "body_too_large" : "internal" });
      return json({ error: error instanceof BodyTooLargeError ? "body_too_large" : "temporarily_unavailable" }, error instanceof BodyTooLargeError ? 413 : 503);
    }
  };
}
