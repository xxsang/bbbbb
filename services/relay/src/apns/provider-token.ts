import { base64UrlEncode, decodePkcs8Pem } from "./base64url.js";

export interface ProviderTokenInput {
  readonly keyId: string;
  readonly teamId: string;
  readonly privateKeyPem: string;
}

export type ProviderTokenSigner = (input: ProviderTokenInput) => Promise<string>;

interface ProviderTokenCacheEntry {
  readonly input: ProviderTokenInput;
  readonly token: string;
  readonly issuedAt: number;
}

interface ProviderTokenInFlight {
  readonly input: ProviderTokenInput;
  readonly token: Promise<string>;
}

const PROVIDER_TOKEN_REFRESH_SECONDS = 50 * 60;

function hasSameCredentials(left: ProviderTokenInput, right: ProviderTokenInput): boolean {
  return (
    left.keyId === right.keyId &&
    left.teamId === right.teamId &&
    left.privateKeyPem === right.privateKeyPem
  );
}

export async function createProviderToken(
  input: ProviderTokenInput,
  subtle: SubtleCrypto = crypto.subtle,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string> {
  const header = base64UrlEncode(JSON.stringify({ alg: "ES256", kid: input.keyId }));
  const claims = base64UrlEncode(JSON.stringify({ iss: input.teamId, iat: nowSeconds }));
  const signingInput = `${header}.${claims}`;
  const privateKey = await subtle.importKey(
    "pkcs8",
    decodePkcs8Pem(input.privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function createProviderTokenCache(
  signToken: ProviderTokenSigner = createProviderToken,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1_000),
): ProviderTokenSigner {
  let cached: ProviderTokenCacheEntry | undefined;
  let inFlight: ProviderTokenInFlight | undefined;

  return async (input) => {
    const now = nowSeconds();
    if (
      cached &&
      hasSameCredentials(cached.input, input) &&
      now - cached.issuedAt <= PROVIDER_TOKEN_REFRESH_SECONDS
    ) {
      return cached.token;
    }

    if (inFlight && hasSameCredentials(inFlight.input, input)) {
      return inFlight.token;
    }

    const pendingToken = signToken(input);
    inFlight = { input: { ...input }, token: pendingToken };
    try {
      const token = await pendingToken;
      if (inFlight?.token === pendingToken) {
        cached = { input: { ...input }, token, issuedAt: now };
        inFlight = undefined;
      }
      return token;
    } catch (error) {
      if (inFlight?.token === pendingToken) {
        inFlight = undefined;
      }
      throw error;
    }
  };
}
