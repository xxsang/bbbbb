import assert from "node:assert/strict";
import test from "node:test";

import { openProtocolV2Envelope, type ProtocolV2Envelope } from "@bbbbbapp/protocol";
import { executeCli, type CliDependencies, type ProcessRunResult } from "../src/index.js";

const PUBLIC_KEY = "BOPacYsu-__TCQ9Cl1FRwYQpyAcfFJGDNtHJKAX9iy-_Mj_WFEsqP5tJKIY1CUqgbX5FcAB_zH8fmyOMoZii1eE";
const PRIVATE_KEY = "BJFWjL7RsUAhnHLEui2U9ZVoBZAS9iv2lR3JGq6_XqY";
const WRITE_CREDENTIAL = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const EVENT_ID = "018f6f18-7f2f-7d3d-a932-70a79fbe31a4";
const profile = {
  version: 2 as const,
  relay: "https://relay.example",
  inboxId: "inbox_primary_0001",
  sourceId: "source_primary_0001",
  source: "Encrypted builds",
  inboxPublicKey: PUBLIC_KEY,
  writeCredential: WRITE_CREDENTIAL,
};

function harness(input: { fetch?: typeof fetch; processResult?: ProcessRunResult } = {}) {
  const requests: Request[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runs: Array<{ command: string; args: readonly string[] }> = [];
  const dependencies: CliDependencies = {
    loadProfile: async () => profile,
    fetch: input.fetch ?? (async (url, init) => { requests.push(new Request(url, init)); return new Response(null, { status: init?.method === "POST" ? 202 : 204 }); }),
    now: () => new Date("2026-07-19T10:00:00.000Z"),
    randomUUID: () => EVENT_ID,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    relayRetryDelaysMs: [0, 0],
    relaySleep: async () => {},
    runProcess: async (command, args) => { runs.push({ command, args }); return input.processResult ?? { exitCode: 0, signal: null }; },
  };
  return { dependencies, requests, stdout, stderr, runs };
}

async function event(request: Request) {
  return openProtocolV2Envelope(await request.clone().json() as ProtocolV2Envelope, PRIVATE_KEY);
}

test("help exposes only current Source setup and commands while version stays product-facing", async () => {
  const context = harness();
  assert.equal(await executeCli(["--help"], context.dependencies), 0);
  const output = context.stdout.join("");
  assert.match(output, /setup --name/u);
  assert.match(output, /send --json/u);
  assert.match(output, /run -- <command>/u);
  assert.doesNotMatch(output, /Channel Key|bbbbb pair|bbbbb invite|--source/u);
  context.stdout.length = 0;
  assert.equal(await executeCli(["--version"], context.dependencies), 0);
  assert.equal(context.stdout.join(""), "bbbbb 1.1.1\n");
});

test("check is read-only, write-capability scoped, and secret-safe", async () => {
  const context = harness();
  assert.equal(await executeCli(["check"], context.dependencies), 0);
  assert.equal(context.requests.length, 1);
  assert.equal(context.requests[0]!.method, "GET");
  assert.equal(context.requests[0]!.url, "https://relay.example/v2/sources/source_primary_0001/events");
  assert.equal(context.requests[0]!.headers.get("authorization"), `Bearer ${WRITE_CREDENTIAL}`);
  assert.deepEqual(context.stdout, ["Ready.\n"]);

  const rejected = harness({ fetch: async () => new Response("private details", { status: 401 }) });
  assert.equal(await executeCli(["check"], rejected.dependencies), 1);
  assert.doesNotMatch(rejected.stderr.join(""), /private details|AAECA/u);
});

test("explicit, neutral, and structured sends seal one canonical protocol-2 event", async () => {
  const explicit = harness();
  assert.equal(await executeCli(["send", "--category", "attention", "--label", "Approval needed", "--work", "Approve release", "--message", "Owner review needed", "--details-json", "{\"attempt\":2,\"cached\":false}"], explicit.dependencies), 0);
  assert.equal((await explicit.requests[0]!.clone().text()).includes("Approve release"), false);
  assert.deepEqual(await event(explicit.requests[0]!), {
    version: 2, eventId: EVENT_ID, sourceId: profile.sourceId, source: profile.source, sourceMethod: "cli",
    category: "attention", label: "Approval needed", occurredAt: "2026-07-19T10:00:00.000Z", work: "Approve release", message: "Owner review needed", details: { attempt: 2, cached: false },
  });

  const neutral = harness();
  assert.equal(await executeCli(["send"], neutral.dependencies), 0);
  assert.equal((await event(neutral.requests[0]!)).category, "activity");
  assert.equal((await event(neutral.requests[0]!)).label, "Update");

  const structured = harness();
  assert.equal(await executeCli(["send", "--json"], { ...structured.dependencies, readStdin: async () => JSON.stringify({ category: "activity", label: "Started", work: "Run checks", details: { count: 12 } }) }), 0);
  assert.equal((await event(structured.requests[0]!)).work, "Run checks");
});

test("send rejects Source identity overrides, nested details, and plaintext relay bodies", async () => {
  for (const args of [
    ["send", "--source", "spoof"],
    ["send", "--category", "unknown"],
    ["send", "--details-json", "{\"nested\":{\"no\":true}}"],
  ]) {
    const context = harness();
    assert.equal(await executeCli(args, context.dependencies), 2);
    assert.equal(context.requests.length, 0);
  }
});

test("bounded retry reuses the same event identity and ciphertext", async () => {
  const requests: Request[] = [];
  let attempt = 0;
  const context = harness({ fetch: async (url, init) => {
    requests.push(new Request(url, init));
    attempt += 1;
    if (attempt === 1) throw new Error("blocked secret");
    if (attempt === 2) return new Response(null, { status: 503 });
    return new Response(null, { status: 202 });
  } });
  assert.equal(await executeCli(["send", "--category", "activity", "--label", "Started", "--work", "Build"], context.dependencies), 0);
  assert.equal(requests.length, 3);
  assert.equal(new Set(await Promise.all(requests.map((request) => request.clone().text()))).size, 1);
});

test("run maps exit and cancellation deterministically while preserving real status", async () => {
  const succeeded = harness();
  assert.equal(await executeCli(["run", "--", "tool", "--flag"], succeeded.dependencies), 0);
  assert.deepEqual(succeeded.runs, [{ command: "tool", args: ["--flag"] }]);
  assert.deepEqual([(await event(succeeded.requests[0]!)).category, (await event(succeeded.requests[0]!)).label], ["activity", "Succeeded"]);

  const failed = harness({ processResult: { exitCode: 23, signal: null } });
  assert.equal(await executeCli(["run", "--", "tool"], failed.dependencies), 23);
  assert.deepEqual([(await event(failed.requests[0]!)).category, (await event(failed.requests[0]!)).label], ["attention", "Failed"]);

  const cancelled = harness({ processResult: { exitCode: null, signal: "SIGTERM" } });
  assert.equal(await executeCli(["run", "--", "tool"], cancelled.dependencies), 143);
  assert.deepEqual([(await event(cancelled.requests[0]!)).category, (await event(cancelled.requests[0]!)).label], ["activity", "Cancelled"]);
});

test("wrapped command status survives notification failure", async () => {
  const context = harness({ processResult: { exitCode: 37, signal: null }, fetch: async () => { throw new Error("offline"); } });
  assert.equal(await executeCli(["run", "--", "tool"], context.dependencies), 37);
  assert.match(context.stderr.join(""), /Inbox event was not sent/u);
});
