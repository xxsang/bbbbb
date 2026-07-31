import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_RELAY_URL, executeCli } from "../src/index.js";
import { loadSourceProfile } from "../src/source-profile.js";

const PROFILE = {
  version: 2,
  relay: "https://relay.example",
  inboxId: "inbox_primary_0001",
  sourceId: "source_primary_0001",
  source: "Encrypted builds",
  inboxPublicKey: "BOPacYsu-__TCQ9Cl1FRwYQpyAcfFJGDNtHJKAX9iy-_Mj_WFEsqP5tJKIY1CUqgbX5FcAB_zH8fmyOMoZii1eE",
  writeCredential: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
};

test("setup uses the separate CLI route, waits for phone approval, and saves one owner-only profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "bbbbb-cli-setup-"));
  const path = join(root, "source.json");
  const requests: Request[] = [];
  const stdout: string[] = [];
  let polls = 0;
  let now = Date.parse("2026-07-19T10:00:00Z");
  const session = {
    version: 2,
    sessionId: "session_primary_0001",
    code: "123-456",
    setupSecret: "temporary_setup_secret_that_is_long_enough",
    claimURL: "bbbbb://add-source?session=session_primary_0001&secret=temporary_claim_secret",
    expiresAt: "2026-07-19T10:05:00.000Z",
    pollAfterMs: 250,
  };
  const fetcher: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    requests.push(request);
    if (request.method === "POST") return Response.json(session, { status: 201 });
    polls += 1;
    return Response.json(polls === 1 ? { version: 2, state: "awaiting_approval" } : { version: 2, state: "completed", profile: PROFILE });
  };
  assert.equal(await executeCli(["setup", "--relay", "https://relay.example", "--name", "Encrypted builds"], {
    environment: { BBBBB_SOURCE_PROFILE: path },
    fetch: fetcher,
    now: () => new Date(now),
    pairingSleep: async (milliseconds) => { now += milliseconds; },
    renderQr: async () => "[temporary QR]",
    stdout: (value) => stdout.push(value),
    stderr: () => {},
  }), 0);
  assert.equal(requests[0]!.url, "https://relay.example/v2/cli-sources/sessions");
  assert.deepEqual(await requests[0]!.json(), { sourceName: "Encrypted builds" });
  assert.equal(requests.slice(1).every((request) => request.url === "https://relay.example/v2/add-source/sessions/session_primary_0001"), true);
  assert.equal(stdout.join("").includes(PROFILE.writeCredential), false);
  assert.match(stdout.join(""), /123-456|CLI Source ready/u);
  assert.deepEqual(await loadSourceProfile(path), PROFILE);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("setup uses the official hosted relay when relay is omitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "bbbbb-cli-setup-default-relay-"));
  const path = join(root, "source.json");
  const requests: Request[] = [];
  const hostedProfile = { ...PROFILE, relay: DEFAULT_RELAY_URL, source: "My Mac" };
  const session = {
    version: 2,
    sessionId: "session_primary_0001",
    code: "123-456",
    setupSecret: "temporary_setup_secret_that_is_long_enough",
    claimURL: "bbbbb://add-source?session=session_primary_0001&secret=temporary_claim_secret",
    expiresAt: "2026-07-19T10:05:00.000Z",
    pollAfterMs: 250,
  };
  let polls = 0;
  assert.equal(await executeCli(["setup", "--name", "My Mac"], {
    environment: { BBBBB_SOURCE_PROFILE: path },
    fetch: async (url, init) => {
      const request = new Request(url, init);
      requests.push(request);
      if (request.method === "POST") return Response.json(session, { status: 201 });
      polls += 1;
      return Response.json({ version: 2, state: "completed", profile: hostedProfile });
    },
    now: () => new Date("2026-07-19T10:00:00Z"),
    pairingSleep: async () => {},
    renderQr: async () => "[temporary QR]",
    stdout: () => {},
    stderr: () => {},
  }), 0);
  assert.equal(polls, 1);
  assert.equal(requests[0]!.url, `${DEFAULT_RELAY_URL}/v2/cli-sources/sessions`);
  assert.equal(requests[1]!.url, `${DEFAULT_RELAY_URL}/v2/add-source/sessions/session_primary_0001`);
});

test("setup does not save invalid or secret-expanding responses", async () => {
  const root = await mkdtemp(join(tmpdir(), "bbbbb-cli-setup-invalid-"));
  const path = join(root, "source.json");
  const stderr: string[] = [];
  assert.equal(await executeCli(["setup", "--relay", "https://relay.example", "--name", "Encrypted builds"], {
    environment: { BBBBB_SOURCE_PROFILE: path },
    fetch: async () => Response.json({ version: 2, sessionId: "short", setupSecret: "secret", claimURL: "https://wrong.example", code: "123-456", expiresAt: "2026-07-19T10:05:00Z", pollAfterMs: 250 }, { status: 201 }),
    now: () => new Date("2026-07-19T10:00:00Z"),
    stderr: (value) => stderr.push(value),
  }), 1);
  assert.match(stderr.join(""), /invalid setup response/u);
  await assert.rejects(stat(path), { code: "ENOENT" });
});
