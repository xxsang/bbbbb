import { classifyApnsFailure, exposeIdentifierApnsReason, fingerprintApnsReason, sendActivityAlert } from "./apns/client.js";
import { createProviderTokenCache } from "./apns/provider-token.js";
import { createHealthResponse } from "./health.js";
import { createTrustSurfaceResponse } from "./trust-surfaces.js";
import { createV2HttpSourceHandler } from "./v2/http-source-handler.js";
import { D1V2SourceStore } from "./v2/d1-source-store.js";
import { D1V2DeviceStore } from "./v2/device-store.js";
import { encryptSourceTransferURL, validateSourceTransferRecipientKey } from "./v2/source-transfer-crypto.js";
import { AppleStoreTransactionVerifier, AppleStoreVerifierSet, deriveV2EntitlementId } from "./v2/apple-store-verifier.js";
import type { V2EntitlementEnvironment } from "./v2/source-store.js";

const textEncoder = new TextEncoder();
const workerSubtle = crypto.subtle as SubtleCrypto & {
  timingSafeEqual(left: ArrayBufferView, right: ArrayBufferView): boolean;
};
const cachedProviderToken = createProviderTokenCache();
const INVALID_DEVICE_REASONS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "ExpiredToken", "Unregistered"]);

export interface RelayEnv {
  readonly M2_EVENTS: D1Database;
  readonly WEBSITE_ORIGIN?: string;
  readonly APNS_PRIVATE_KEY?: string;
  readonly APNS_KEY_ID?: string;
  readonly APNS_TEAM_ID?: string;
  readonly APNS_TOPIC?: string;
  readonly BUILD_VERSION?: string;
  readonly MIGRATION_SET_SHA256?: string;
  readonly DEPLOYMENT_MANIFEST_SHA256?: string;
  readonly APP_STORE_ENVIRONMENT?: string;
  readonly APP_STORE_ACCEPT_SANDBOX?: string;
  readonly APP_APPLE_ID?: string;
  readonly ENTITLEMENT_ID_KEY?: string;
}

export function entitlementConfiguration(env: RelayEnv): { environments: readonly V2EntitlementEnvironment[]; appAppleId?: number; secret: string } | null {
  if (!env.ENTITLEMENT_ID_KEY || new TextEncoder().encode(env.ENTITLEMENT_ID_KEY).byteLength < 32) return null;
  if (env.APP_STORE_ENVIRONMENT !== "xcode" && env.APP_STORE_ENVIRONMENT !== "sandbox" && env.APP_STORE_ENVIRONMENT !== "production") return null;
  if (env.APP_STORE_ENVIRONMENT === "production") {
    const appAppleId = Number(env.APP_APPLE_ID);
    if (!Number.isSafeInteger(appAppleId) || appAppleId <= 0) return null;
    if (env.APP_STORE_ACCEPT_SANDBOX !== undefined && env.APP_STORE_ACCEPT_SANDBOX !== "true") return null;
    return {
      environments: env.APP_STORE_ACCEPT_SANDBOX === "true" ? ["production", "sandbox"] : ["production"],
      appAppleId,
      secret: env.ENTITLEMENT_ID_KEY,
    };
  }
  if (env.APP_STORE_ACCEPT_SANDBOX !== undefined) return null;
  return { environments: [env.APP_STORE_ENVIRONMENT], secret: env.ENTITLEMENT_ID_KEY };
}
const worker = {
  async fetch(request: Request, env?: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const trustSurfaceResponse = createTrustSurfaceResponse(request);
    if (trustSurfaceResponse !== null) return trustSurfaceResponse;

    if (request.method === "GET" && url.pathname === "/health") {
      return createHealthResponse(env as RelayEnv | undefined);
    }

    if (url.pathname.startsWith("/v2/") && env && "M2_EVENTS" in env) {
      const v2Env = env as RelayEnv;
      const requestOrigin = request.headers.get("origin");
      const permitsWebsite = requestOrigin !== null && requestOrigin === v2Env.WEBSITE_ORIGIN;
      if (request.method === "OPTIONS") {
        return permitsWebsite
          ? new Response(null, {
              status: 204,
              headers: {
                "access-control-allow-headers": "authorization, content-type, idempotency-key",
                "access-control-allow-methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT",
                "access-control-allow-origin": requestOrigin,
                "access-control-max-age": "600",
                vary: "Origin",
              },
            })
          : new Response(null, { status: 403 });
      }
      const v2DeviceStore = new D1V2DeviceStore(v2Env.M2_EVENTS);
      const v2SourceStore = new D1V2SourceStore(v2Env.M2_EVENTS);
      const entitlement = entitlementConfiguration(v2Env);
      const appleVerifier = entitlement ? new AppleStoreVerifierSet(entitlement.environments.map((environment) =>
        new AppleStoreTransactionVerifier(environment, environment === "production" ? entitlement.appAppleId : undefined),
      )) : null;
      const response = await createV2HttpSourceHandler({
        store: v2SourceStore,
        now: () => Date.now(),
        randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
        randomUUID: () => crypto.randomUUID(),
        hash: async (value) => {
          const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
          return Buffer.from(digest).toString("base64url");
        },
        equal: (left, right) => {
          const leftBytes = Buffer.from(left);
          const rightBytes = Buffer.from(right);
          return leftBytes.byteLength === rightBytes.byteLength && workerSubtle.timingSafeEqual(leftBytes, rightBytes);
        },
        validateTransferRecipientKey: validateSourceTransferRecipientKey,
        encryptTransferURL: encryptSourceTransferURL,
        devices: v2DeviceStore,
        notify: async (inboxId) => {
          const device = await v2DeviceStore.get(inboxId);
          if (!device) return;
          if (!v2Env.APNS_PRIVATE_KEY || !v2Env.APNS_KEY_ID || !v2Env.APNS_TEAM_ID || !v2Env.APNS_TOPIC) {
            console.log(JSON.stringify({ event: "v2_apns_not_configured" }));
            return;
          }
          let providerToken: string;
          try {
            providerToken = await cachedProviderToken({ keyId: v2Env.APNS_KEY_ID, teamId: v2Env.APNS_TEAM_ID, privateKeyPem: v2Env.APNS_PRIVATE_KEY });
          } catch (error) {
            console.log(JSON.stringify({ event: "v2_apns_provider_token_failed" }));
            throw error;
          }
          const result = await sendActivityAlert({ deviceToken: device.token, environment: device.environment, topic: v2Env.APNS_TOPIC, providerToken, expiration: Math.floor(Date.now() / 1_000) + 3_600 }, { onTransportError: () => console.log(JSON.stringify({ event: "v2_apns_transport_failed" })) });
          if (!result.ok) {
            const failure = classifyApnsFailure(result);
            const rejection: Record<string, string | number> = {
              event: "v2_apns_rejected",
              failure,
              status: result.status,
            };
            if (failure === "request_rejected") {
              const reasonFingerprint = await fingerprintApnsReason(result.reason);
              if (reasonFingerprint !== null) rejection.reasonFingerprint = reasonFingerprint;
              const unrecognizedReason = exposeIdentifierApnsReason(result.reason);
              if (unrecognizedReason !== null) rejection.unrecognizedReason = unrecognizedReason;
            }
            console.log(JSON.stringify(rejection));
            if (result.reason !== null && INVALID_DEVICE_REASONS.has(result.reason)) {
              await v2DeviceStore.disable(inboxId, device.token);
              return;
            }
            throw new Error("APNs rejected generic alert");
          }
        },
        defer: (promise) => ctx ? ctx.waitUntil(promise) : void promise,
        log: (entry) => console.log(JSON.stringify(entry)),
        resolveTier: (inboxId) => v2SourceStore.getEntitlementTier(inboxId),
        ...(entitlement && appleVerifier ? {
          verifyEntitlementTransaction: (signedTransaction: string, now: number) => appleVerifier.verify(signedTransaction, now),
          verifyEntitlementNotification: (signedPayload: string, now: number) => appleVerifier.verifyNotification(signedPayload, now),
          deriveEntitlementId: (originalTransactionId: string, environment: V2EntitlementEnvironment) => deriveV2EntitlementId(originalTransactionId, environment, entitlement.secret),
        } : {}),
      })(request);
      if (!permitsWebsite) return response;
      const headers = new Headers(response.headers);
      headers.set("access-control-allow-origin", requestOrigin);
      headers.set("vary", "Origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export default worker;
