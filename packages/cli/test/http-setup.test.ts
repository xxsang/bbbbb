import assert from "node:assert/strict";
import test from "node:test";

import { executeCli } from "../src/index.js";
import type { StoreHttpSourceOptions } from "../src/http-source-store.js";

const SOURCE_URL = `https://relay.example/v2/sources/source_primary_0001/events?key=${"A".repeat(43)}`;
const session = {
  version: 2,
  sessionId: "session_primary_0001",
  code: "123-456",
  setupSecret: "temporary_setup_secret_that_is_long_enough",
  claimURL: "bbbbb://add-source?session=session_primary_0001&secret=temporary_claim_secret",
  expiresAt: "2026-07-24T10:05:00.000Z",
  pollAfterMs: 250,
};
const completed = {
  version: 2,
  state: "completed",
  sourceURL: SOURCE_URL,
  source: {
    sourceId: "source_primary_0001",
    name: "Agent updates",
    method: "http",
    enabled: true,
  },
};

function setupFetcher(requests: Request[]): typeof fetch {
  let polls = 0;
  return async (url, init) => {
    const request = new Request(url, init);
    requests.push(request);
    if (request.method === "POST" && request.url === "https://relay.example/v2/add-source/sessions") {
      return Response.json(session, { status: 201 });
    }
    if (request.method === "GET" && request.url === "https://relay.example/v2/add-source/sessions/session_primary_0001") {
      polls += 1;
      return Response.json(polls === 1 ? { version: 2, state: "awaiting_approval" } : completed);
    }
    if (request.method === "POST" && request.url === SOURCE_URL) {
      return Response.json({ version: 2, accepted: true }, { status: 202 });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  };
}

test("setup-http stores privately, sends a test, and never prints the Source URL", async () => {
  const requests: Request[] = [];
  const stdout: string[] = [];
  const stores: Array<{ sourceURL: string; options: StoreHttpSourceOptions }> = [];
  let now = Date.parse("2026-07-24T10:00:00Z");
  assert.equal(await executeCli([
    "setup-http", "--relay", "https://relay.example", "--name", "Agent updates", "--store", "file",
  ], {
    fetch: setupFetcher(requests),
    now: () => new Date(now),
    pairingSleep: async (milliseconds) => { now += milliseconds; },
    renderQr: async () => "[temporary QR]",
    storeHttpSourceURL: async (sourceURL, options) => {
      stores.push({ sourceURL, options });
      return { kind: "file", description: "an owner-only local file" };
    },
    stdout: (value) => stdout.push(value),
    stderr: () => {},
  }), 0);
  assert.equal(requests[0]?.url, "https://relay.example/v2/add-source/sessions");
  assert.deepEqual(await requests[0]?.json(), { sourceName: "Agent updates" });
  assert.equal(stores[0]?.sourceURL, SOURCE_URL);
  assert.equal(stores[0]?.options.kind, "file");
  assert.equal(stdout.join("").includes(SOURCE_URL), false);
  assert.equal(stdout.join("").match(/Step 2 · Approve its code/gu)?.length, 1);
  assert.match(stdout.join(""), /temporary QR[\s\S]*123-456/u);
  assert.match(stdout.join(""), /HTTP Source ready/u);
  assert.equal(requests.some((request) => request.method === "POST" && request.url === SOURCE_URL), true);
});

test("setup-http can omit the Step 2 heading for a composing bootstrap", async () => {
  const requests: Request[] = [];
  const stdout: string[] = [];
  let now = Date.parse("2026-07-24T10:00:00Z");
  assert.equal(await executeCli([
    "setup-http", "--relay", "https://relay.example", "--name", "Agent updates", "--store", "file",
  ], {
    environment: { BBBBB_SETUP_HTTP_SUPPRESS_STEP_HEADING: "1" },
    fetch: setupFetcher(requests),
    now: () => new Date(now),
    pairingSleep: async (milliseconds) => { now += milliseconds; },
    renderQr: async () => "[temporary QR]",
    storeHttpSourceURL: async () => ({ kind: "file", description: "an owner-only local file" }),
    stdout: (value) => stdout.push(value),
    stderr: () => {},
  }), 0);
  assert.equal(stdout.join("").includes("Step 2 · Approve its code"), false);
  assert.match(stdout.join(""), /temporary QR[\s\S]*123-456/u);
});

test("setup-http manual mode reveals the Source URL only after explicit selection", async () => {
  const requests: Request[] = [];
  const stdout: string[] = [];
  let now = Date.parse("2026-07-24T10:00:00Z");
  assert.equal(await executeCli([
    "setup-http", "--relay", "https://relay.example", "--name", "Manual webhook", "--store", "manual",
  ], {
    fetch: setupFetcher(requests),
    now: () => new Date(now),
    pairingSleep: async (milliseconds) => { now += milliseconds; },
    renderQr: async () => "[temporary QR]",
    stdout: (value) => stdout.push(value),
    stderr: () => {},
  }), 0);
  assert.equal(stdout.join("").includes(SOURCE_URL), true);
  assert.match(stdout.join(""), /shown once/u);
});

test("setup-http cancellation stores no credential and gives one restart action", async () => {
  const requests: Request[] = [];
  const stderr: string[] = [];
  let stores = 0;
  let now = Date.parse("2026-07-24T10:00:00Z");
  const fetcher: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    requests.push(request);
    if (request.method === "POST") return Response.json(session, { status: 201 });
    return Response.json({ error: "session_unavailable" }, { status: 404 });
  };
  assert.equal(await executeCli([
    "setup-http", "--relay", "https://relay.example", "--name", "Cancelled setup", "--store", "file",
  ], {
    fetch: fetcher,
    now: () => new Date(now),
    pairingSleep: async (milliseconds) => { now += milliseconds; },
    renderQr: async () => "[temporary QR]",
    storeHttpSourceURL: async () => { stores += 1; return { kind: "file", description: "an owner-only local file" }; },
    stdout: () => {},
    stderr: (value) => stderr.push(value),
  }), 1);
  assert.equal(stores, 0);
  assert.equal(stderr.join(""), "Setup was cancelled or expired. Run bbbbb setup-http again. No credential was stored.\n");
  assert.equal(stderr.join("").includes(SOURCE_URL), false);
});

test("setup-http expiry stores no credential and gives one restart action", async () => {
  const stderr: string[] = [];
  let stores = 0;
  let now = Date.parse("2026-07-24T10:00:00Z");
  const expiringSession = { ...session, expiresAt: "2026-07-24T10:00:00.500Z" };
  const fetcher: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    if (request.method === "POST") return Response.json(expiringSession, { status: 201 });
    return Response.json({ version: 2, state: "awaiting_approval" });
  };
  assert.equal(await executeCli([
    "setup-http", "--relay", "https://relay.example", "--name", "Expired setup", "--store", "file",
  ], {
    fetch: fetcher,
    now: () => new Date(now),
    pairingSleep: async (milliseconds) => { now += milliseconds; },
    renderQr: async () => "[temporary QR]",
    storeHttpSourceURL: async () => { stores += 1; return { kind: "file", description: "an owner-only local file" }; },
    stdout: () => {},
    stderr: (value) => stderr.push(value),
  }), 1);
  assert.equal(stores, 0);
  assert.match(stderr.join(""), /setup code expired\. Run bbbbb setup-http again/u);
  assert.equal(stderr.join("").includes(SOURCE_URL), false);
});

test("setup-http storage failure does not test-send and requires Source replacement", async () => {
  const requests: Request[] = [];
  const stderr: string[] = [];
  let now = Date.parse("2026-07-24T10:00:00Z");
  assert.equal(await executeCli([
    "setup-http", "--relay", "https://relay.example", "--name", "Storage failure", "--store", "file",
  ], {
    fetch: setupFetcher(requests),
    now: () => new Date(now),
    pairingSleep: async (milliseconds) => { now += milliseconds; },
    renderQr: async () => "[temporary QR]",
    storeHttpSourceURL: async () => { throw new Error("Unable to store the HTTP Source credential in an owner-only file."); },
    stdout: () => {},
    stderr: (value) => stderr.push(value),
  }), 1);
  assert.equal(requests.some((request) => request.method === "POST" && request.url === SOURCE_URL), false);
  assert.match(stderr.join(""), /Replace it in bbbbb before retrying/u);
  assert.equal(stderr.join("").includes(SOURCE_URL), false);
});
