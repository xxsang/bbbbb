import {
  PLUS_PRODUCT_ID,
  validateProtocolV2EntitlementStateResponse,
  validateProtocolV2EntitlementVerificationRequest,
} from "@bbbbbapp/protocol";
import { BodyTooLargeError, readBoundedBody } from "../http/bounded-body.js";
import {
  AppleTransactionVerificationError,
  type V2VerifiedAppleNotification,
  type V2VerifiedAppleTransaction,
} from "./apple-store-verifier.js";
import { applyVerifiedAppleNotification } from "./entitlement-lifecycle.js";
import {
  V2_ENTITLEMENT_ENVIRONMENTS,
  V2_ENTITLEMENT_OPERATION_ACTIONS,
  type V2EntitlementEnvironment,
  type V2Inbox,
  type V2SourceStore,
} from "./source-store.js";

const IDENTIFIER = /^[A-Za-z0-9_-]{16,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const OPERATION_REASON = /^[a-z][a-z0-9_]{2,63}$/u;
const encoder = new TextEncoder();

type EntitlementStore = Pick<
  V2SourceStore,
  "applyEntitlement" | "applyEntitlementNotification" | "applyEntitlementOperation" | "getEntitlementTier"
>;

export interface EntitlementRouteDependencies {
  readonly store: EntitlementStore;
  readonly hash: (value: string) => Promise<string>;
  readonly log: (entry: Record<string, unknown>) => void;
  readonly authorizeInbox: (request: Request, inboxId: string) => Promise<V2Inbox | null>;
  readonly authorizeOperator: ((token: string) => Promise<string | null>) | undefined;
  readonly verifyTransaction: ((signedTransaction: string, now: number) => Promise<V2VerifiedAppleTransaction>) | undefined;
  readonly verifyNotification: ((signedPayload: string, now: number) => Promise<V2VerifiedAppleNotification>) | undefined;
  readonly deriveEntitlementId: ((originalTransactionId: string, environment: V2EntitlementEnvironment) => Promise<string>) | undefined;
}

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store" },
});

const bearer = (request: Request) => {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") && value.length <= 512 ? value.slice(7) : null;
};

export function createEntitlementRouteHandler(deps: EntitlementRouteDependencies) {
  return async (request: Request, url: URL, now: number): Promise<Response | null> => {
    if (request.method === "POST" && url.pathname === "/v2/operator/entitlements") {
      if (!deps.authorizeOperator) return new Response("Not Found", { status: 404 });
      const presented = bearer(request);
      const actorFingerprint = presented ? await deps.authorizeOperator(presented) : null;
      if (!actorFingerprint) return json({ error: "unauthorized" }, 401);
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "invalid_request" }, 400);
      const operationId = request.headers.get("idempotency-key") ?? "";
      if (!UUID.test(operationId)) return json({ error: "invalid_request" }, 400);
      let value: Record<string, unknown>;
      try { value = JSON.parse(await readBoundedBody(request, 4_096)) as Record<string, unknown>; }
      catch (error) {
        if (error instanceof BodyTooLargeError) throw error;
        return json({ error: "invalid_request" }, 400);
      }
      if (Object.keys(value).some((key) => !["version", "action", "environment", "inboxId", "reason", "expiresAt"].includes(key)) ||
        value.version !== 1 || typeof value.action !== "string" || !V2_ENTITLEMENT_OPERATION_ACTIONS.includes(value.action as never) ||
        typeof value.environment !== "string" || !V2_ENTITLEMENT_ENVIRONMENTS.includes(value.environment as never) ||
        typeof value.inboxId !== "string" || !IDENTIFIER.test(value.inboxId) || typeof value.reason !== "string" || !OPERATION_REASON.test(value.reason)) {
        return json({ error: "invalid_request" }, 400);
      }
      if (value.action === "sandbox_reset" && value.environment !== "sandbox") return json({ error: "invalid_request" }, 400);
      const expiresAt = value.expiresAt === undefined || value.expiresAt === null ? null :
        typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : Number.NaN;
      if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 30 * 24 * 60 * 60 * 1_000 || value.action !== "suspend")) return json({ error: "invalid_request" }, 400);
      const environment = value.environment as V2EntitlementEnvironment;
      const result = await deps.store.applyEntitlementOperation({
        operationId,
        action: value.action as (typeof V2_ENTITLEMENT_OPERATION_ACTIONS)[number],
        environment,
        inboxId: value.inboxId,
        targetFingerprint: (await deps.hash(`entitlement-operation:${environment}:${value.inboxId}`)).slice(0, 32),
        actorFingerprint,
        reasonCode: value.reason,
        occurredAt: now,
        expiresAt,
      });
      deps.log({ event: "v2_entitlement_operation", action: value.action, environment, result });
      if (result === "target_unavailable") return json({ error: "target_unavailable" }, 404);
      if (result === "environment_mismatch" || result === "idempotency_conflict") return json({ error: result }, 409);
      return json({ version: 1, result });
    }

    if (request.method === "POST" && url.pathname === "/v2/app-store/notifications") {
      if (!deps.verifyNotification || !deps.deriveEntitlementId) return json({ error: "verification_unavailable" }, 503);
      let notification: V2VerifiedAppleNotification;
      try {
        if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") return json({ error: "invalid_notification" }, 400);
        const value = JSON.parse(await readBoundedBody(request, 72 * 1_024)) as Record<string, unknown>;
        if (Object.keys(value).length !== 1 || typeof value.signedPayload !== "string" || encoder.encode(value.signedPayload).byteLength < 16 || encoder.encode(value.signedPayload).byteLength > 64 * 1_024 || !COMPACT_JWS.test(value.signedPayload)) {
          return json({ error: "invalid_notification" }, 400);
        }
        notification = await deps.verifyNotification(value.signedPayload, now);
      } catch (error) {
        if (error instanceof BodyTooLargeError) throw error;
        if (error instanceof AppleTransactionVerificationError && error.kind === "retryable") {
          deps.log({ event: "v2_app_store_notification_failed", kind: "provider" });
          return json({ error: "verification_unavailable" }, 503);
        }
        deps.log({ event: "v2_app_store_notification_failed", kind: "invalid" });
        return json({ error: "invalid_notification" }, 400);
      }
      try {
        const result = await applyVerifiedAppleNotification(deps.store, notification, now, deps.deriveEntitlementId);
        if (result === "ignored") deps.log({ event: "v2_app_store_notification_ignored" });
        else deps.log({ event: "v2_app_store_notification_applied", result });
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      } catch {
        deps.log({ event: "v2_app_store_notification_failed", kind: "storage" });
        return json({ error: "verification_unavailable" }, 503);
      }
    }

    const inboxEntitlement = /^\/v2\/inboxes\/([A-Za-z0-9_-]{16,128})\/entitlement\/verify$/u.exec(url.pathname);
    if (!inboxEntitlement || request.method !== "POST") return null;
    const authorized = await deps.authorizeInbox(request, inboxEntitlement[1]!);
    if (!authorized) return json({ error: "unauthorized" }, 401);
    if (!deps.verifyTransaction || !deps.deriveEntitlementId) return json({ error: "verification_unavailable" }, 503);
    let transaction: V2VerifiedAppleTransaction;
    try {
      const input = validateProtocolV2EntitlementVerificationRequest(JSON.parse(await readBoundedBody(request, 36 * 1_024)));
      transaction = await deps.verifyTransaction(input.signedTransaction, now);
    } catch (error) {
      if (error instanceof BodyTooLargeError) throw error;
      if (error instanceof AppleTransactionVerificationError && error.kind === "retryable") {
        deps.log({ event: "v2_entitlement_verification_failed", kind: "provider" });
        return json({ error: "verification_unavailable" }, 503);
      }
      deps.log({ event: "v2_entitlement_verification_failed", kind: "invalid" });
      return json({ error: "invalid_transaction" }, 400);
    }
    let result;
    try {
      const entitlementId = await deps.deriveEntitlementId(transaction.originalTransactionId, transaction.environment);
      result = await deps.store.applyEntitlement({
        entitlementId,
        productId: PLUS_PRODUCT_ID,
        environment: transaction.environment,
        status: transaction.status,
        stateChangedAt: transaction.stateChangedAt,
        verifiedAt: Math.max(now, transaction.stateChangedAt),
      }, transaction.status === "active" ? authorized.inboxId : null);
    } catch {
      deps.log({ event: "v2_entitlement_verification_failed", kind: "storage" });
      return json({ error: "verification_unavailable" }, 503);
    }
    if (result === "inbox_unavailable") return json({ error: "inbox_unavailable" }, 404);
    const state = await deps.store.getEntitlementTier(authorized.inboxId, now);
    deps.log({ event: "v2_entitlement_verified", state });
    return json(validateProtocolV2EntitlementStateResponse({ version: 2, state }));
  };
}
