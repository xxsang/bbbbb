import { PLUS_PRODUCT_ID } from "@bbbbbapp/protocol";
import { classifyApnsFailure, exposeIdentifierApnsReason, fingerprintApnsReason, sendActivityAlert } from "./apns/client.js";
import { createProviderTokenCache } from "./apns/provider-token.js";
import { createHealthResponse } from "./health.js";
import { createTrustSurfaceResponse } from "./trust-surfaces.js";
import { createV2HttpSourceHandler } from "./v2/http-source-handler.js";
import { D1V2SourceStore } from "./v2/d1-source-store.js";
import { D1V2DeviceStore } from "./v2/device-store.js";
import { encryptSourceTransferURL, validateSourceTransferRecipientKey } from "./v2/source-transfer-crypto.js";
import { AppleStoreTransactionVerifier, AppleStoreVerifierSet, deriveV2EntitlementId } from "./v2/apple-store-verifier.js";
import { reconcileAppStoreNotificationHistory } from "./v2/app-store-reconciliation.js";
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
  readonly ENTITLEMENT_OPERATIONS_KEY?: string;
  readonly APP_STORE_API_PRIVATE_KEY?: string;
  readonly APP_STORE_API_KEY_ID?: string;
  readonly APP_STORE_API_ISSUER_ID?: string;
  readonly APP_STORE_RECONCILIATION_LOOKBACK_HOURS?: string;
}

const sha256 = async (value: string): Promise<string> => Buffer.from(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))).toString("base64url");
const equalDigest = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.byteLength === rightBytes.byteLength && workerSubtle.timingSafeEqual(leftBytes, rightBytes);
};

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

export function appStoreAPIConfiguration(env: RelayEnv): { privateKey: string; keyId: string; issuerId: string; lookbackHours: number } | null {
  const values = [env.APP_STORE_API_PRIVATE_KEY, env.APP_STORE_API_KEY_ID, env.APP_STORE_API_ISSUER_ID];
  if (values.every((value) => value === undefined)) return null;
  const lookbackHours = env.APP_STORE_RECONCILIATION_LOOKBACK_HOURS === undefined ? 4_320 : Number(env.APP_STORE_RECONCILIATION_LOOKBACK_HOURS);
  if (
    !env.APP_STORE_API_PRIVATE_KEY?.includes("BEGIN PRIVATE KEY") || env.APP_STORE_API_PRIVATE_KEY.length > 16 * 1_024 ||
    !/^[A-Z0-9]{10}$/u.test(env.APP_STORE_API_KEY_ID ?? "") ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(env.APP_STORE_API_ISSUER_ID ?? "") ||
    !Number.isSafeInteger(lookbackHours) || lookbackHours < 1 || lookbackHours > 4_320
  ) return null;
  return { privateKey: env.APP_STORE_API_PRIVATE_KEY, keyId: env.APP_STORE_API_KEY_ID!, issuerId: env.APP_STORE_API_ISSUER_ID!, lookbackHours };
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
        hash: sha256,
        equal: equalDigest,
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
        resolveTier: (inboxId, now) => v2SourceStore.getEntitlementTier(inboxId, now),
        ...(v2Env.ENTITLEMENT_OPERATIONS_KEY && textEncoder.encode(v2Env.ENTITLEMENT_OPERATIONS_KEY).byteLength >= 32 && textEncoder.encode(v2Env.ENTITLEMENT_OPERATIONS_KEY).byteLength <= 256 ? {
          authorizeEntitlementOperator: async (presented: string) => {
            if (presented.length < 32 || presented.length > 256) return null;
            const [presentedDigest, configuredDigest] = await Promise.all([sha256(presented), sha256(v2Env.ENTITLEMENT_OPERATIONS_KEY!)]);
            return equalDigest(presentedDigest, configuredDigest) ? (await sha256(`entitlement-operator:${v2Env.ENTITLEMENT_OPERATIONS_KEY!}`)).slice(0, 32) : null;
          },
        } : {}),
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
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const v2Env = env as RelayEnv;
    const entitlement = entitlementConfiguration(v2Env);
    const api = appStoreAPIConfiguration(v2Env);
    if (!entitlement || !api || !v2Env.M2_EVENTS) {
      console.log(JSON.stringify({ event: "v2_app_store_reconciliation_not_configured" }));
      return;
    }
    const accepted = entitlement.environments.filter((environment): environment is "sandbox" | "production" => environment !== "xcode");
    if (accepted.length < 1) {
      console.log(JSON.stringify({ event: "v2_app_store_reconciliation_not_configured" }));
      return;
    }
    try {
      const { WorkersAppStoreServerAPIClient, Environment, GetTransactionHistoryVersion, Order, ProductType } = await import("./v2/workers-app-store-api-client.js");
      const store = new D1V2SourceStore(v2Env.M2_EVENTS);
      const result = await reconcileAppStoreNotificationHistory({
        store,
        now: Date.now(),
        deriveEntitlementId: (originalTransactionId, environment) => deriveV2EntitlementId(originalTransactionId, environment, entitlement.secret),
        sources: accepted.map((environment) => {
          const verifier = new AppleStoreTransactionVerifier(environment, environment === "production" ? entitlement.appAppleId : undefined);
          const client = new WorkersAppStoreServerAPIClient(api.privateKey, api.keyId, api.issuerId, "org.shenren.bbbbb", environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX);
          return {
            environment,
            historyLimitHours: Math.min(api.lookbackHours, environment === "production" ? 4_320 : 720),
            client: {
              getNotificationHistory: (paginationToken: string | null, request: { startDate: number; endDate: number; onlyFailures: boolean }) => client.getNotificationHistory(paginationToken, request),
              getTransactionHistory: (originalTransactionId: string, revision: string | null) => client.getTransactionHistory(originalTransactionId, revision, { productIds: [PLUS_PRODUCT_ID], productTypes: [ProductType.NON_CONSUMABLE], sort: Order.ASCENDING }, GetTransactionHistoryVersion.V2),
            },
            verifyNotification: (signedPayload: string, now: number) => verifier.verifyNotification(signedPayload, now),
            verifyTransaction: (signedTransaction: string, now: number) => verifier.verify(signedTransaction, now),
          };
        }),
      });
      if (result.failedEnvironments > 0) console.log(JSON.stringify({ event: "v2_app_store_reconciliation_failed", failedEnvironments: result.failedEnvironments }));
      if (result.checkpoints < 1) throw new Error("App Store reconciliation failed in every environment");
      console.log(JSON.stringify({ event: "v2_app_store_reconciliation_complete", ...result }));
    } catch {
      console.log(JSON.stringify({ event: "v2_app_store_reconciliation_failed" }));
      throw new Error("App Store reconciliation failed");
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
