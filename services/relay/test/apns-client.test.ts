import assert from "node:assert/strict";
import test from "node:test";

import { classifyApnsFailure, createApnsRequestId, exposeIdentifierApnsReason, fingerprintApnsReason, sendActivityAlert } from "../src/apns/client.js";

const input = {
  deviceToken: "ab".repeat(32),
  environment: "sandbox",
  topic: "com.example.bbbbb",
  providerToken: "provider-token-value",
  expiration: 0,
} as const;

test("calls the Workers crypto UUID method with its owning object", () => {
  const systemCrypto = {
    randomUUID() {
      assert.equal(this, systemCrypto);
      return "123e4567-e89b-12d3-a456-4266554400a0";
    },
  };

  assert.equal(
    createApnsRequestId({}, systemCrypto),
    "123e4567-e89b-12d3-a456-4266554400a0",
  );
});

test("reports a transport failure without handling or transforming it", async () => {
  const failure = new Error("private transport detail");
  let reported = 0;

  await assert.rejects(
    sendActivityAlert(
      {
        deviceToken: input.deviceToken,
        environment: "production",
        topic: input.topic,
        providerToken: input.providerToken,
        expiration: 1_784_000_000,
      },
      {
        fetcher: async () => {
          throw failure;
        },
        onTransportError: () => {
          reported += 1;
        },
        randomUUID: () => "123e4567-e89b-12d3-a456-4266554400a0",
      },
    ),
    (error: unknown) => error === failure,
  );
  assert.equal(reported, 1);
});

test("classifies a bounded APNs error response", async () => {
  const result = await sendActivityAlert(input, {
    fetcher: async () => new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 }),
    nowMilliseconds: (() => {
      let call = 0;
      return () => (call++ === 0 ? 1_000 : 1_037);
    })(),
    randomUUID: () => "123e4567-e89b-12d3-a456-4266554400a0",
    timeoutSignal: new AbortController().signal,
  });

  assert.deepEqual(result, {
    ok: false,
    status: 400,
    reason: "BadDeviceToken",
    apnsId: null,
    latencyMs: 37,
  });
});

test("reduces APNs failures to fixed secret-safe labels", () => {
  assert.equal(classifyApnsFailure({ status: 403, reason: "InvalidProviderToken" }), "invalid_provider_token");
  assert.equal(classifyApnsFailure({ status: 403, reason: "Forbidden" }), "forbidden");
  assert.equal(classifyApnsFailure({ status: 403, reason: "BadEnvironmentKeyInToken" }), "bad_environment_key_id_in_token");
  assert.equal(classifyApnsFailure({ status: 403, reason: "MalformedApnsResponse" }), "malformed_response");
  assert.equal(classifyApnsFailure({ status: 403, reason: "UnknownApnsError" }), "unrecognized_response");
  assert.equal(classifyApnsFailure({ status: 403, reason: null }), "missing_response_reason");
  assert.equal(classifyApnsFailure({ status: 403, reason: "TopicDisallowed" }), "topic_disallowed");
  assert.equal(classifyApnsFailure({ status: 400, reason: "BadDeviceToken" }), "bad_device_token");
  assert.equal(classifyApnsFailure({ status: 503, reason: "Shutdown" }), "shutdown");
  assert.equal(classifyApnsFailure({ status: 400, reason: "FutureAppleReason" }), "request_rejected");
  assert.equal(classifyApnsFailure({ status: 302, reason: null }), "unknown");
});

test("fingerprints only the unrecognized APNs reason without retaining its contents", async () => {
  const fingerprint = await fingerprintApnsReason("gateway-specific-reason");
  assert.match(fingerprint!, /^[a-f0-9]{16}$/u);
  assert.equal(fingerprint, await fingerprintApnsReason("gateway-specific-reason"));
  assert.notEqual(fingerprint, await fingerprintApnsReason("another-reason"));
  assert.equal(await fingerprintApnsReason(null), null);
});

test("exposes only a bounded identifier-shaped APNs reason", () => {
  assert.equal(exposeIdentifierApnsReason("PlatformSpecificReason2"), "PlatformSpecificReason2");
  assert.equal(exposeIdentifierApnsReason("contains private detail"), null);
  assert.equal(exposeIdentifierApnsReason("x".repeat(65)), null);
  assert.equal(exposeIdentifierApnsReason(null), null);
});

test("does not synthesize an error reason for a success response with an unexpected body", async () => {
  const result = await sendActivityAlert(input, {
    fetcher: async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    nowMilliseconds: () => 1_000,
    randomUUID: () => "123e4567-e89b-12d3-a456-4266554400a0",
    timeoutSignal: new AbortController().signal,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.reason, null);
});

test("reports an unknown reason for an error response with an unexpected body", async () => {
  const result = await sendActivityAlert(input, {
    fetcher: async () => new Response(JSON.stringify({ unexpected: true }), { status: 403 }),
    nowMilliseconds: () => 1_000,
    randomUUID: () => "123e4567-e89b-12d3-a456-4266554400a0",
    timeoutSignal: new AbortController().signal,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, "UnknownApnsError");
});

test("rejects an APNs response body larger than one KiB", async () => {
  await assert.rejects(
    sendActivityAlert(input, {
      fetcher: async () => new Response("x".repeat(1_025), { status: 500 }),
      nowMilliseconds: () => 1_000,
      randomUUID: () => "123e4567-e89b-12d3-a456-4266554400a0",
      timeoutSignal: new AbortController().signal,
    }),
    /response exceeded 1024 bytes/,
  );
});

test("sends a content-free activity alert to sandbox and production APNs", async () => {
  const requests: Array<{ url: string; headers: Headers; body: unknown }> = [];
  for (const environment of ["sandbox", "production"] as const) {
    const result = await sendActivityAlert(
      {
        deviceToken: input.deviceToken,
        environment,
        topic: input.topic,
        providerToken: input.providerToken,
        expiration: 1_784_000_000,
      },
      {
        randomUUID: () => "123e4567-e89b-12d3-a456-4266554400a0",
        fetcher: async (request) => {
          requests.push({
            url: request.url,
            headers: new Headers(request.headers),
            body: await request.clone().json(),
          });
          return new Response(null, { status: 200 });
        },
      },
    );
    assert.equal(result.ok, true);
  }

  assert.equal(requests[0]?.url, `https://api.sandbox.push.apple.com/3/device/${input.deviceToken}`);
  assert.equal(requests[1]?.url, `https://api.push.apple.com/3/device/${input.deviceToken}`);
  const body = requests[0]!.body;
  assert.deepEqual(body, {
    aps: {
      alert: { title: "bbbbb", body: "New activity." },
      sound: "default",
      "content-available": 1,
    },
  });
  const serialized = JSON.stringify(body);
  for (const forbidden of ["eventId", "channel", "ciphertext", "https://example.com"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(requests[0]?.headers.get("apns-expiration"), "1784000000");
});
