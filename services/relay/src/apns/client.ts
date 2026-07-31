export interface ApnsResult {
  readonly ok: boolean;
  readonly status: number;
  readonly reason: string | null;
  readonly apnsId: string | null;
  readonly latencyMs: number;
}

export type ApnsFailure =
  | "bad_certificate"
  | "bad_certificate_environment"
  | "bad_collapse_id"
  | "bad_device_token"
  | "bad_expiration_date"
  | "bad_environment_key_id_in_token"
  | "bad_message_id"
  | "bad_path"
  | "bad_priority"
  | "device_token_not_for_topic"
  | "expired_provider_token"
  | "expired_token"
  | "forbidden"
  | "idle_timeout"
  | "internal_server_error"
  | "invalid_provider_token"
  | "invalid_push_type"
  | "malformed_response"
  | "missing_response_reason"
  | "missing_provider_token"
  | "missing_device_token"
  | "missing_topic"
  | "duplicate_headers"
  | "method_not_allowed"
  | "payload_empty"
  | "payload_too_large"
  | "topic_disallowed"
  | "bad_topic"
  | "unregistered"
  | "unrelated_key_id_in_token"
  | "too_many_provider_token_updates"
  | "too_many_requests"
  | "shutdown"
  | "unrecognized_response"
  | "service_unavailable"
  | "request_rejected"
  | "unknown";

const SAFE_APNS_FAILURES: Readonly<Record<string, ApnsFailure>> = {
  BadCertificate: "bad_certificate",
  BadCertificateEnvironment: "bad_certificate_environment",
  BadCollapseId: "bad_collapse_id",
  BadDeviceToken: "bad_device_token",
  BadExpirationDate: "bad_expiration_date",
  BadEnvironmentKeyInToken: "bad_environment_key_id_in_token",
  BadEnvironmentKeyIdInToken: "bad_environment_key_id_in_token",
  BadMessageId: "bad_message_id",
  BadPath: "bad_path",
  BadPriority: "bad_priority",
  DeviceTokenNotForTopic: "device_token_not_for_topic",
  ExpiredProviderToken: "expired_provider_token",
  ExpiredToken: "expired_token",
  Forbidden: "forbidden",
  IdleTimeout: "idle_timeout",
  InternalServerError: "internal_server_error",
  InvalidProviderToken: "invalid_provider_token",
  InvalidPushType: "invalid_push_type",
  MalformedApnsResponse: "malformed_response",
  MissingProviderToken: "missing_provider_token",
  MissingDeviceToken: "missing_device_token",
  MissingTopic: "missing_topic",
  DuplicateHeaders: "duplicate_headers",
  MethodNotAllowed: "method_not_allowed",
  PayloadEmpty: "payload_empty",
  PayloadTooLarge: "payload_too_large",
  TopicDisallowed: "topic_disallowed",
  BadTopic: "bad_topic",
  Unregistered: "unregistered",
  UnrelatedKeyIdInToken: "unrelated_key_id_in_token",
  TooManyProviderTokenUpdates: "too_many_provider_token_updates",
  TooManyRequests: "too_many_requests",
  Shutdown: "shutdown",
  UnknownApnsError: "unrecognized_response",
  ServiceUnavailable: "service_unavailable",
};

export function classifyApnsFailure(
  result: Pick<ApnsResult, "reason" | "status">,
): ApnsFailure {
  if (result.reason !== null && result.reason in SAFE_APNS_FAILURES) {
    return SAFE_APNS_FAILURES[result.reason]!;
  }
  if (result.reason === null && result.status >= 400) return "missing_response_reason";
  if (result.status >= 500) return "service_unavailable";
  if (result.status >= 400 && result.status < 500) return "request_rejected";
  return "unknown";
}

export async function fingerprintApnsReason(reason: string | null): Promise<string | null> {
  if (reason === null) return null;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(reason)));
  return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function exposeIdentifierApnsReason(reason: string | null): string | null {
  return reason !== null && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(reason) ? reason : null;
}

export interface ApnsDependencies {
  readonly fetcher?: (request: Request) => Promise<Response>;
  readonly nowMilliseconds?: () => number;
  readonly onTransportError?: () => void;
  readonly randomUUID?: () => string;
  readonly timeoutSignal?: AbortSignal;
}

interface ApnsSystemCrypto {
  randomUUID(): string;
}

export function createApnsRequestId(
  dependencies: Pick<ApnsDependencies, "randomUUID">,
  systemCrypto: ApnsSystemCrypto = crypto,
): string {
  return dependencies.randomUUID?.() ?? systemCrypto.randomUUID();
}

export interface ActivityAlertInput {
  readonly deviceToken: string;
  readonly environment: "sandbox" | "production";
  readonly topic: string;
  readonly providerToken: string;
  readonly expiration: number;
}

const MAX_RESPONSE_BYTES = 1_024;

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel("APNs response exceeded limit");
      throw new Error(`APNs response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

// APNs returns an empty body on success and a JSON `{ "reason": ... }` object on
// failure. `ok` distinguishes success from failure so that a shape we do not
// recognize is only reported as an error reason on a non-2xx response; a 2xx with
// an unexpected body is not misclassified as `UnknownApnsError`.
function parseReason(text: string, ok: boolean): string | null {
  if (text.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "reason" in parsed &&
      typeof parsed.reason === "string"
    ) {
      return parsed.reason;
    }
  } catch {
    return ok ? null : "MalformedApnsResponse";
  }
  return ok ? null : "UnknownApnsError";
}

async function executeApnsRequest(
  request: Request,
  dependencies: ApnsDependencies,
): Promise<ApnsResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  const nowMilliseconds = dependencies.nowMilliseconds ?? Date.now;
  const startedAt = nowMilliseconds();
  let response: Response;
  try {
    response = await fetcher(request);
  } catch (error) {
    dependencies.onTransportError?.();
    throw error;
  }
  const responseText = await readBoundedText(response);
  return {
    ok: response.ok,
    status: response.status,
    reason: parseReason(responseText, response.ok),
    apnsId: response.headers.get("apns-id"),
    latencyMs: Math.max(0, nowMilliseconds() - startedAt),
  };
}

export async function sendActivityAlert(
  input: ActivityAlertInput,
  dependencies: ApnsDependencies = {},
): Promise<ApnsResult> {
  const apnsId = createApnsRequestId(dependencies);
  const host =
    input.environment === "production"
      ? "api.push.apple.com"
      : "api.sandbox.push.apple.com";
  const request = new Request(
    `https://${host}/3/device/${encodeURIComponent(input.deviceToken)}`,
    {
      method: "POST",
      headers: {
        authorization: `bearer ${input.providerToken}`,
        "apns-expiration": String(input.expiration),
        "apns-id": apnsId,
        "apns-priority": "10",
        "apns-push-type": "alert",
        "apns-topic": input.topic,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        aps: {
          alert: { title: "bbbbb", body: "New activity." },
          sound: "default",
          "content-available": 1,
        },
      }),
      signal: dependencies.timeoutSignal ?? AbortSignal.timeout(10_000),
    },
  );
  return executeApnsRequest(request, dependencies);
}
