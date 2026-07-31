import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveHttpSourceFilePath, storeHttpSourceURL } from "../src/http-source-store.js";

const SOURCE_URL = `https://relay.example/v2/sources/source_primary_0001/events?key=${"A".repeat(43)}`;

test("owner-only file storage and the HTTP helper share XDG path selection", () => {
  assert.equal(
    resolveHttpSourceFilePath({ XDG_CONFIG_HOME: "/owner/xdg" }, () => "/owner/home"),
    "/owner/xdg/bbbbb/http-source-url",
  );
  assert.equal(
    resolveHttpSourceFilePath({ BBBBB_HTTP_SOURCE_FILE: "/chosen/source" }, () => "/owner/home"),
    "/chosen/source",
  );
});

test("auto storage uses macOS Keychain without putting the Source URL in arguments", async () => {
  const commands: Array<{ command: string; args: readonly string[]; input: string }> = [];
  const stored = await storeHttpSourceURL(SOURCE_URL, {
    kind: "auto",
    platform: "darwin",
    environment: { USER: "owner" },
    runCommand: async (command, args, input) => {
      commands.push({ command, args, input });
      return { exitCode: 0 };
    },
  });
  assert.deepEqual(stored, { kind: "keychain", description: "macOS Keychain" });
  assert.equal(commands[0]?.command, "/usr/bin/security");
  assert.deepEqual(commands[0]?.args, ["add-generic-password", "-U", "-a", "owner", "-s", "bbbbb-http-source", "-w"]);
  assert.equal(commands[0]?.args.includes(SOURCE_URL), false);
  assert.equal(commands[0]?.input, `${SOURCE_URL}\n`);
});

test("auto storage falls back to a regular owner-only file", async () => {
  const root = await mkdtemp(join(tmpdir(), "bbbbb-http-source-store-"));
  const path = join(root, "config", "http-source-url");
  const stored = await storeHttpSourceURL(SOURCE_URL, {
    kind: "auto",
    platform: "linux",
    environment: { BBBBB_HTTP_SOURCE_FILE: path },
    runCommand: async () => ({ exitCode: 1 }),
  });
  assert.deepEqual(stored, { kind: "file", description: "an owner-only local file" });
  assert.equal(await readFile(path, "utf8"), `${SOURCE_URL}\n`);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, "config"))).mode & 0o777, 0o700);
});
