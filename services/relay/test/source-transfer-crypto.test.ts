import assert from "node:assert/strict";
import test from "node:test";

import { encryptSourceTransferURL, validateSourceTransferRecipientKey } from "../src/v2/source-transfer-crypto.js";

test("4096-bit RSA-OAEP Source transfer round-trips without relay plaintext storage", async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 4_096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
  const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64url");
  assert.equal(await validateSourceTransferRecipientKey(publicKey), true);
  assert.equal(await validateSourceTransferRecipientKey("not-a-key"), false);

  const sourceURL = `https://relay.example/v2/sources/source_primary_0001/events?key=${"A".repeat(43)}`;
  const ciphertext = await encryptSourceTransferURL(publicKey, sourceURL);
  assert.equal(ciphertext.includes(sourceURL), false);
  const plaintext = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    pair.privateKey,
    Buffer.from(ciphertext, "base64url")
  );
  assert.equal(new TextDecoder().decode(plaintext), sourceURL);
});
