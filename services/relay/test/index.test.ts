import assert from "node:assert/strict";
import test from "node:test";

import worker, { entitlementConfiguration } from "../src/index.js";

test("configures exact Apple environments and fails closed on ambiguous production input", () => {
  const secret = "S".repeat(32);
  assert.deepEqual(entitlementConfiguration({
    ENTITLEMENT_ID_KEY: secret,
    APP_STORE_ENVIRONMENT: "production",
    APP_STORE_ACCEPT_SANDBOX: "true",
    APP_APPLE_ID: "6791204016",
  } as unknown as Parameters<typeof entitlementConfiguration>[0]), {
    environments: ["production", "sandbox"],
    appAppleId: 6791204016,
    secret,
  });
  assert.deepEqual(entitlementConfiguration({
    ENTITLEMENT_ID_KEY: secret,
    APP_STORE_ENVIRONMENT: "sandbox",
  } as unknown as Parameters<typeof entitlementConfiguration>[0]), {
    environments: ["sandbox"],
    secret,
  });
  for (const configuration of [
    { ENTITLEMENT_ID_KEY: secret, APP_STORE_ENVIRONMENT: "production", APP_STORE_ACCEPT_SANDBOX: "true" },
    { ENTITLEMENT_ID_KEY: secret, APP_STORE_ENVIRONMENT: "production", APP_STORE_ACCEPT_SANDBOX: "false", APP_APPLE_ID: "6791204016" },
    { ENTITLEMENT_ID_KEY: secret, APP_STORE_ENVIRONMENT: "sandbox", APP_STORE_ACCEPT_SANDBOX: "true" },
  ]) assert.equal(entitlementConfiguration(configuration as unknown as Parameters<typeof entitlementConfiguration>[0]), null);
});

test("reports relay health and protocol compatibility", async () => {
  const response = await worker.fetch(new Request("https://relay.test/health"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), {
    service: "bbbbb-relay",
    status: "ok",
    protocolVersion: 2,
    deploymentVersion: "development",
    migrationSetSha256: "development",
    deploymentManifestSha256: "development",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("maps deployed health to source, migrations, and manifest or fails closed", async () => {
  const sourceRevision = "1".repeat(40);
  const migrationSetSha256 = "2".repeat(64);
  const deploymentManifestSha256 = "3".repeat(64);
  const configured = await worker.fetch(new Request("https://relay.test/health"), {
    BUILD_VERSION: sourceRevision,
    MIGRATION_SET_SHA256: migrationSetSha256,
    DEPLOYMENT_MANIFEST_SHA256: deploymentManifestSha256,
  } as unknown as Env);
  assert.equal(configured.status, 200);
  assert.deepEqual(await configured.json(), {
    service: "bbbbb-relay",
    status: "ok",
    protocolVersion: 2,
    deploymentVersion: sourceRevision,
    migrationSetSha256,
    deploymentManifestSha256,
  });

  const partial = await worker.fetch(new Request("https://relay.test/health"), {
    BUILD_VERSION: sourceRevision,
  } as unknown as Env);
  assert.equal(partial.status, 503);
  assert.deepEqual(await partial.json(), {
    service: "bbbbb-relay",
    status: "misconfigured",
    protocolVersion: 2,
    deploymentVersion: "invalid",
    migrationSetSha256: "invalid",
    deploymentManifestSha256: "invalid",
  });
});

test("rejects every protocol-1 and retired trigger route", async () => {
  const environment = { M2_EVENTS: {} as D1Database } as Env;
  // Paths from retired earlier revisions. They must stay listed here so a
  // reintroduced handler fails this test rather than silently serving them.
  for (const path of [
    "/v1/events",
    "/v1/channels/MhIlSJK7FuhnaxL-p7_VFA/events",
    "/v1/channels/MhIlSJK7FuhnaxL-p7_VFA/device",
    "/v1/pairing/sessions",
    "/m1/apns/send",
  ]) {
    const response = await worker.fetch(new Request(`https://relay.test${path}`), environment);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), "Not Found", path);
  }
});

test("serves complete public trust surfaces with privacy-safe headers", async () => {
  const expectations = [
    ["/support", ["bbbbb Support", "shen@shenren.org", "newest 100 encrypted updates", "Check now"]],
    ["/privacy", ["bbbbb Privacy Policy", "Cloudflare D1", "Apple processes", "Source transfer metadata", "no advertising"]],
    ["/deletion", ["Delete bbbbb Data", "credential-transfer records", "Delete hosted encrypted history", "Delete local history"]],
    ["/status", ["bbbbb Service Status", "endpoint is reachable", "/health"]],
    ["/security", ["bbbbb Security Reporting", "shen@shenren.org", "Do not include Source URLs"]],
  ] as const;

  for (const [path, content] of expectations) {
    const response = await worker.fetch(new Request(`https://relay.test${path}`));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8", path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(response.headers.get("x-frame-options"), "DENY", path);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/u, path);
    const body = await response.text();
    for (const expected of content) assert.match(body, new RegExp(expected, "u"), `${path}: ${expected}`);
    assert.doesNotMatch(body, /xxsang@gmail\.com|Source URL[^<]*(?:[A-Za-z0-9_-]{40,})/u, path);
  }
});

test("trust surfaces support HEAD and reject mutations", async () => {
  const head = await worker.fetch(new Request("https://relay.test/privacy", { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const post = await worker.fetch(new Request("https://relay.test/privacy", { method: "POST" }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  assert.equal(post.headers.get("cache-control"), "no-store");
});

test("permits v2 browser requests only from the configured website origin", async () => {
  const environment = {
    M2_EVENTS: {} as D1Database,
    WEBSITE_ORIGIN: "https://bbbbb.app",
  } as unknown as Env;
  const headers = {
    origin: "https://bbbbb.app",
    "access-control-request-method": "POST",
    "access-control-request-headers": "content-type",
  };

  const allowed = await worker.fetch(new Request("https://relay.test/v2/add-source/sessions", {
    method: "OPTIONS",
    headers,
  }), environment);
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://bbbbb.app");
  assert.match(allowed.headers.get("access-control-allow-methods") ?? "", /POST/u);
  assert.match(allowed.headers.get("access-control-allow-headers") ?? "", /content-type/u);
  assert.equal(allowed.headers.get("vary"), "Origin");

  const disallowed = await worker.fetch(new Request("https://relay.test/v2/add-source/sessions", {
    method: "OPTIONS",
    headers: { ...headers, origin: "https://example.test" },
  }), environment);
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed.headers.get("access-control-allow-origin"), null);
});
