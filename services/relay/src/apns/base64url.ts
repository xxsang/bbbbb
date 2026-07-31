export function base64UrlEncode(input: string | ArrayBuffer | Uint8Array): string {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodePkcs8Pem(pem: string): ArrayBuffer {
  const match = /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PRIVATE KEY-----$/u.exec(
    pem.trim(),
  );
  if (!match?.[1]) {
    throw new Error("APNs private key must be PKCS8 PEM");
  }

  const binary = atob(match[1].replaceAll(/\s/gu, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}
