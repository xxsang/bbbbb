import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { Environment, WorkersAppStoreServerAPIClient } from "../src/v2/workers-app-store-api-client.js";

test("App Store Server API requests use the Workers native fetch implementation", async () => {
  const signingKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const originalFetch = globalThis.fetch;
  let requestURL = "";
  let requestAuthorization = "";
  let requestMethod = "";
  let requestBody = "";
  globalThis.fetch = (async (input, init) => {
    requestURL = String(input);
    requestAuthorization = new Headers(init?.headers).get("authorization") ?? "";
    requestMethod = init?.method ?? "";
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ notificationHistory: [], hasMore: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const client = new WorkersAppStoreServerAPIClient(signingKey, "ABCDEFGHIJ", "123e4567-e89b-42d3-a456-426614174000", "org.shenren.bbbbb", Environment.SANDBOX);
    assert.deepEqual(await client.getNotificationHistory(null, { startDate: 100, endDate: 200, onlyFailures: false }), {
      notificationHistory: [],
      hasMore: false,
    });
    assert.match(requestURL, /^https:\/\/api\.storekit-sandbox\.apple\.com\/inApps\/v1\/notifications\/history\?/u);
    assert.equal(requestMethod, "POST");
    assert.deepEqual(JSON.parse(requestBody), { startDate: 100, endDate: 200, onlyFailures: false });
    assert.match(requestAuthorization, /^Bearer [A-Za-z0-9._-]+$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
