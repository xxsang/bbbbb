import { PLUS_PRODUCT_ID } from "@bbbbbapp/protocol";
import { APPLE_ROOT_CERTIFICATES_BASE64 } from "./apple-root-certificates.js";
import type { V2EntitlementEnvironment } from "./source-store.js";

const BUNDLE_ID = "org.shenren.bbbbb";
const TRANSACTION_ID = /^\d{1,64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export interface V2VerifiedAppleTransaction {
  readonly originalTransactionId: string;
  readonly status: "active" | "revoked";
  readonly stateChangedAt: number;
  readonly environment: V2EntitlementEnvironment;
}

export interface V2VerifiedAppleNotification {
  readonly notificationUUID: string;
  readonly notificationType: string;
  readonly transaction: V2VerifiedAppleTransaction | null;
}

export class AppleTransactionVerificationError extends Error {
  constructor(readonly kind: "invalid" | "retryable") { super(`Apple transaction verification ${kind}`); }
}

interface AppleStoreVerifier {
  verify(signedTransaction: string, now: number): Promise<V2VerifiedAppleTransaction>;
  verifyNotification(signedPayload: string, now: number): Promise<V2VerifiedAppleNotification>;
}

export class AppleStoreVerifierSet implements AppleStoreVerifier {
  constructor(private readonly verifiers: readonly AppleStoreVerifier[]) {
    if (verifiers.length < 1) throw new TypeError("at least one Apple verifier is required");
  }

  verify(signedTransaction: string, now: number): Promise<V2VerifiedAppleTransaction> {
    return this.firstVerified((verifier) => verifier.verify(signedTransaction, now));
  }

  verifyNotification(signedPayload: string, now: number): Promise<V2VerifiedAppleNotification> {
    return this.firstVerified((verifier) => verifier.verifyNotification(signedPayload, now));
  }

  private async firstVerified<T>(verify: (verifier: AppleStoreVerifier) => Promise<T>): Promise<T> {
    let retryable = false;
    for (const verifier of this.verifiers) {
      try {
        return await verify(verifier);
      } catch (error) {
        if (!(error instanceof AppleTransactionVerificationError) || error.kind === "retryable") retryable = true;
      }
    }
    throw new AppleTransactionVerificationError(retryable ? "retryable" : "invalid");
  }
}

export class AppleStoreTransactionVerifier {
  constructor(readonly environment: V2EntitlementEnvironment, appAppleId?: number) {
    if (environment === "production" && (!Number.isSafeInteger(appAppleId) || (appAppleId ?? 0) <= 0)) {
      throw new TypeError("production App Apple ID is invalid");
    }
    this.appAppleId = appAppleId;
  }

  private readonly appAppleId: number | undefined;

  async verify(signedTransaction: string, now: number): Promise<V2VerifiedAppleTransaction> {
    const { Environment, SignedDataVerifier, VerificationException, VerificationStatus } = await import("@apple/app-store-server-library");
    const environment = this.environment === "xcode" ? Environment.XCODE : this.environment === "sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
    const verifier = new SignedDataVerifier(
      APPLE_ROOT_CERTIFICATES_BASE64.map((value) => Buffer.from(value, "base64")),
      false,
      environment,
      BUNDLE_ID,
      this.appAppleId,
    );
    let payload;
    try { payload = await verifier.verifyAndDecodeTransaction(signedTransaction); }
    catch (error) {
      if (error instanceof VerificationException) {
        throw new AppleTransactionVerificationError(error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE ? "retryable" : "invalid");
      }
      throw new AppleTransactionVerificationError("retryable");
    }
    const stateChangedAt = payload.revocationDate ?? payload.signedDate;
    if (
      payload.productId !== PLUS_PRODUCT_ID || payload.type !== "Non-Consumable" ||
      payload.inAppOwnershipType !== "PURCHASED" || payload.quantity !== 1 ||
      typeof payload.originalTransactionId !== "string" || !TRANSACTION_ID.test(payload.originalTransactionId) ||
      typeof payload.transactionId !== "string" || !TRANSACTION_ID.test(payload.transactionId) ||
      typeof payload.appAccountToken !== "string" || !UUID_V4.test(payload.appAccountToken) ||
      !Number.isSafeInteger(payload.signedDate) || (payload.signedDate ?? -1) < 0 ||
      !Number.isSafeInteger(stateChangedAt) || (stateChangedAt ?? -1) < 0 ||
      (stateChangedAt ?? 0) > now + MAX_CLOCK_SKEW_MS
    ) throw new AppleTransactionVerificationError("invalid");
    return {
      originalTransactionId: payload.originalTransactionId,
      status: payload.revocationDate === undefined ? "active" : "revoked",
      stateChangedAt: stateChangedAt!,
      environment: this.environment,
    };
  }

  async verifyNotification(signedPayload: string, now: number): Promise<V2VerifiedAppleNotification> {
    const { Environment, SignedDataVerifier, VerificationException, VerificationStatus } = await import("@apple/app-store-server-library");
    const environment = this.environment === "xcode" ? Environment.XCODE : this.environment === "sandbox" ? Environment.SANDBOX : Environment.PRODUCTION;
    const verifier = new SignedDataVerifier(
      APPLE_ROOT_CERTIFICATES_BASE64.map((value) => Buffer.from(value, "base64")),
      false,
      environment,
      BUNDLE_ID,
      this.appAppleId,
    );
    let payload;
    try { payload = await verifier.verifyAndDecodeNotification(signedPayload); }
    catch (error) {
      if (error instanceof VerificationException) {
        throw new AppleTransactionVerificationError(error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE ? "retryable" : "invalid");
      }
      throw new AppleTransactionVerificationError("retryable");
    }
    if (
      typeof payload.notificationUUID !== "string" || !UUID.test(payload.notificationUUID) ||
      typeof payload.notificationType !== "string" || payload.notificationType.length < 1 || payload.notificationType.length > 64 ||
      payload.version !== "2.0" || !Number.isSafeInteger(payload.signedDate) || (payload.signedDate ?? -1) < 0 ||
      (payload.signedDate ?? 0) > now + MAX_CLOCK_SKEW_MS
    ) throw new AppleTransactionVerificationError("invalid");
    if (payload.notificationType !== "REFUND" && payload.notificationType !== "REVOKE") {
      return { notificationUUID: payload.notificationUUID, notificationType: payload.notificationType, transaction: null };
    }
    if (typeof payload.data?.signedTransactionInfo !== "string") throw new AppleTransactionVerificationError("invalid");
    const transaction = await this.verify(payload.data.signedTransactionInfo, now);
    if (transaction.status !== "revoked") throw new AppleTransactionVerificationError("invalid");
    return { notificationUUID: payload.notificationUUID, notificationType: payload.notificationType, transaction };
  }
}

export async function deriveV2EntitlementId(originalTransactionId: string, environment: V2EntitlementEnvironment, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  if (secretBytes.byteLength < 32 || secretBytes.byteLength > 256 || !TRANSACTION_ID.test(originalTransactionId) || !["xcode", "sandbox", "production"].includes(environment)) {
    throw new TypeError("entitlement identity derivation input is invalid");
  }
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`v2-entitlement:${environment}:${originalTransactionId}`));
  return Buffer.from(signature).toString("base64url");
}
