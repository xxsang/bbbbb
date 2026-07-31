import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadSourceProfile, resolveSourceProfilePath, SourceProfileError, writeSourceProfile } from "../src/source-profile.js";

const profile = {
  version: 2 as const,
  relay: "https://relay.example/",
  inboxId: "inbox_primary_0001",
  sourceId: "source_primary_0001",
  source: "Encrypted builds",
  inboxPublicKey: "BOPacYsu-__TCQ9Cl1FRwYQpyAcfFJGDNtHJKAX9iy-_Mj_WFEsqP5tJKIY1CUqgbX5FcAB_zH8fmyOMoZii1eE",
  writeCredential: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
};

test("writes and loads only the protocol-2 write capability with owner-only permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "bbbbb-source-profile-"));
  const path = join(root, "nested", "source.json");
  await writeSourceProfile(path, profile);
  assert.equal((await stat(join(root, "nested"))).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await loadSourceProfile(path), { ...profile, relay: "https://relay.example" });
  const raw = JSON.parse(await readFile(path, "utf8"));
  assert.equal("readCredential" in raw, false);
  assert.equal("privateKey" in raw, false);
});

test("uses BBBBB_SOURCE_PROFILE and rejects loose files and symlinks", async () => {
  assert.equal(resolveSourceProfilePath({ BBBBB_SOURCE_PROFILE: "/safe/source.json" }, () => "/home/person"), "/safe/source.json");
  const root = await mkdtemp(join(tmpdir(), "bbbbb-source-profile-guard-"));
  const path = join(root, "source.json");
  await writeSourceProfile(path, profile);
  await chmod(path, 0o644);
  await assert.rejects(loadSourceProfile(path), (error: unknown) => error instanceof SourceProfileError && /0600/u.test(error.message));
  const target = join(root, "target.json");
  await writeSourceProfile(target, profile);
  const link = join(root, "link.json");
  await symlink(target, link);
  await assert.rejects(loadSourceProfile(link), (error: unknown) => error instanceof SourceProfileError && /symbolic link/u.test(error.message));
  assert.equal((await lstat(link)).isSymbolicLink(), true);
});
