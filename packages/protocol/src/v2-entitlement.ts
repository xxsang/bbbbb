import { PROTOCOL_V2 } from "./v2-model.js";

export const PLUS_PRODUCT_ID = "org.shenren.bbbbb.plus" as const;
export const V2_ENTITLEMENT_STATES = ["free", "plus"] as const;
export type V2EntitlementState = (typeof V2_ENTITLEMENT_STATES)[number];

export interface ProtocolV2EntitlementVerificationRequest {
  readonly version: typeof PROTOCOL_V2;
  readonly signedTransaction: string;
}

export interface ProtocolV2EntitlementStateResponse {
  readonly version: typeof PROTOCOL_V2;
  readonly state: V2EntitlementState;
}

const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const MAX_SIGNED_TRANSACTION_BYTES = 32 * 1_024;
const encoder = new TextEncoder();

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some((key) => !expected.includes(key))) {
    throw new TypeError(`${label} fields are invalid`);
  }
}

export function validateProtocolV2EntitlementVerificationRequest(value: unknown): ProtocolV2EntitlementVerificationRequest {
  const candidate = record(value, "Protocol 2 entitlement verification request");
  exactFields(candidate, ["version", "signedTransaction"], "Protocol 2 entitlement verification request");
  if (candidate.version !== PROTOCOL_V2) throw new TypeError("version must be 2");
  if (
    typeof candidate.signedTransaction !== "string" ||
    !JWS.test(candidate.signedTransaction) ||
    encoder.encode(candidate.signedTransaction).byteLength > MAX_SIGNED_TRANSACTION_BYTES
  ) throw new TypeError("signedTransaction must be a bounded compact JWS");
  return { version: PROTOCOL_V2, signedTransaction: candidate.signedTransaction };
}

export function validateProtocolV2EntitlementStateResponse(value: unknown): ProtocolV2EntitlementStateResponse {
  const candidate = record(value, "Protocol 2 entitlement state response");
  exactFields(candidate, ["version", "state"], "Protocol 2 entitlement state response");
  if (candidate.version !== PROTOCOL_V2) throw new TypeError("version must be 2");
  if (!V2_ENTITLEMENT_STATES.includes(candidate.state as V2EntitlementState)) throw new TypeError("entitlement state is invalid");
  return { version: PROTOCOL_V2, state: candidate.state as V2EntitlementState };
}
