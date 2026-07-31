import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderToken,
  createProviderTokenCache,
  type ProviderTokenInput,
} from "../src/apns/provider-token.js";

function decodeJson(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

function toPem(bytes: ArrayBuffer): string {
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

test("creates a verifiable ES256 provider token with APNs claims", async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateKeyPem = toPem(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));

  const token = await createProviderToken(
    {
      keyId: "ABC123DEFG",
      teamId: "LW5588AX72",
      privateKeyPem,
    },
    crypto.subtle,
    1_789_000_000,
  );

  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
  assert.ok(encodedHeader);
  assert.ok(encodedClaims);
  assert.ok(encodedSignature);
  assert.deepEqual(decodeJson(encodedHeader), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(decodeJson(encodedClaims), { iss: "LW5588AX72", iat: 1_789_000_000 });
  assert.equal(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      Buffer.from(encodedSignature, "base64url"),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
    ),
    true,
  );
});

test("rejects malformed PKCS8 PEM input", async () => {
  await assert.rejects(
    createProviderToken(
      {
        keyId: "ABC123DEFG",
        teamId: "LW5588AX72",
        privateKeyPem: "not-a-key",
      },
      crypto.subtle,
      1_789_000_000,
    ),
    /PKCS8 PEM/,
  );
});

test("reuses a provider token until the refresh window expires", async () => {
  const input: ProviderTokenInput = {
    keyId: "ABC123DEFG",
    teamId: "LW5588AX72",
    privateKeyPem: "private-key",
  };
  let nowSeconds = 1_000;
  let signCount = 0;
  const cachedToken = createProviderTokenCache(
    async () => `token-${++signCount}`,
    () => nowSeconds,
  );

  assert.equal(await cachedToken(input), "token-1");
  assert.equal(await cachedToken(input), "token-1");

  nowSeconds += 3_001;
  assert.equal(await cachedToken(input), "token-2");
  assert.equal(signCount, 2);
});

test("shares one provider-token signing operation across concurrent requests", async () => {
  const input: ProviderTokenInput = {
    keyId: "ABC123DEFG",
    teamId: "LW5588AX72",
    privateKeyPem: "private-key",
  };
  let signCount = 0;
  let finishSigning: ((token: string) => void) | undefined;
  const cachedToken = createProviderTokenCache(
    async () => {
      signCount += 1;
      return new Promise<string>((resolve) => {
        finishSigning = resolve;
      });
    },
    () => 1_000,
  );

  const first = cachedToken(input);
  const second = cachedToken(input);
  assert.equal(signCount, 1);

  assert.ok(finishSigning);
  finishSigning("shared-token");
  assert.deepEqual(await Promise.all([first, second]), ["shared-token", "shared-token"]);
});
