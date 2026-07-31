const PUBLIC_KEY = /^[A-Za-z0-9_-]{600,900}$/u;
const MAX_SOURCE_URL_BYTES = 400;
const encoder = new TextEncoder();

function decodeBase64URL(value: string): ArrayBuffer {
  const decoded = Buffer.from(value, "base64url");
  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);
  return bytes.buffer;
}

async function importRecipientKey(value: string): Promise<CryptoKey> {
  if (!PUBLIC_KEY.test(value)) throw new TypeError("invalid recipient key");
  const key = await crypto.subtle.importKey(
    "spki",
    decodeBase64URL(value),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  if (
    algorithm.name !== "RSA-OAEP" ||
    algorithm.modulusLength !== 4_096 ||
    algorithm.hash.name !== "SHA-256" ||
    !algorithm.publicExponent ||
    Buffer.from(algorithm.publicExponent).toString("hex") !== "010001"
  ) throw new TypeError("invalid recipient key");
  return key;
}

export async function validateSourceTransferRecipientKey(value: string): Promise<boolean> {
  try {
    await importRecipientKey(value);
    return true;
  } catch {
    return false;
  }
}

export async function encryptSourceTransferURL(recipientPublicKey: string, sourceURL: string): Promise<string> {
  const plaintext = encoder.encode(sourceURL);
  if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_SOURCE_URL_BYTES) {
    throw new TypeError("source URL cannot be transferred");
  }
  const key = await importRecipientKey(recipientPublicKey);
  const ciphertext = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, plaintext);
  return Buffer.from(ciphertext).toString("base64url");
}
