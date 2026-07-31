import { constants } from "node:fs";
import {
  chmod as nodeChmod,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  rename as nodeRename,
  rm as nodeRm,
  type FileHandle,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { decodeBase64Url, normalizeRelayURL } from "@bbbbbapp/protocol";

export interface SourceProfile {
  readonly version: 2;
  readonly relay: string;
  readonly inboxId: string;
  readonly sourceId: string;
  readonly source: string;
  readonly inboxPublicKey: string;
  readonly writeCredential: string;
}

export interface ProfileFileSystem {
  readonly chmod: typeof nodeChmod;
  readonly lstat: typeof nodeLstat;
  readonly mkdir: typeof nodeMkdir;
  readonly open: typeof nodeOpen;
  readonly rename: typeof nodeRename;
  readonly rm: typeof nodeRm;
}

const nodeFileSystem: ProfileFileSystem = {
  chmod: nodeChmod,
  lstat: nodeLstat,
  mkdir: nodeMkdir,
  open: nodeOpen,
  rename: nodeRename,
  rm: nodeRm,
};
const IDENTIFIER = /^[A-Za-z0-9_-]{16,128}$/u;

export class SourceProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceProfileError";
  }
}

export function resolveSourceProfilePath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  getHomeDirectory: () => string = homedir,
): string {
  return environment.BBBBB_SOURCE_PROFILE ?? join(getHomeDirectory(), ".config", "bbbbb", "source.json");
}

function boundedBase64Url(value: unknown, bytes: number, label: string): string {
  if (typeof value !== "string" || value.length > bytes * 2) throw new SourceProfileError(`Invalid ${label}`);
  let decoded: Uint8Array;
  try { decoded = decodeBase64Url(value); }
  catch { throw new SourceProfileError(`Invalid ${label}`); }
  if (decoded.byteLength !== bytes || Buffer.from(decoded).toString("base64url") !== value) {
    throw new SourceProfileError(`Invalid ${label}`);
  }
  return value;
}

export function validateSourceProfile(value: unknown): SourceProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new SourceProfileError("Invalid Source profile");
  const candidate = value as Record<string, unknown>;
  const keys = ["version", "relay", "inboxId", "sourceId", "source", "inboxPublicKey", "writeCredential"];
  if (Object.keys(candidate).length !== keys.length || keys.some((key) => !(key in candidate))) throw new SourceProfileError("Invalid Source profile");
  if (candidate.version !== 2 || typeof candidate.relay !== "string" || typeof candidate.inboxId !== "string" || !IDENTIFIER.test(candidate.inboxId) || typeof candidate.sourceId !== "string" || !IDENTIFIER.test(candidate.sourceId) || typeof candidate.source !== "string" || candidate.source.length === 0 || new TextEncoder().encode(candidate.source).byteLength > 80) throw new SourceProfileError("Invalid Source profile");
  let relay: string;
  try { relay = normalizeRelayURL(candidate.relay); }
  catch { throw new SourceProfileError("Invalid Source profile"); }
  return {
    version: 2,
    relay,
    inboxId: candidate.inboxId,
    sourceId: candidate.sourceId,
    source: candidate.source,
    inboxPublicKey: boundedBase64Url(candidate.inboxPublicKey, 65, "inbox public key"),
    writeCredential: boundedBase64Url(candidate.writeCredential, 32, "write credential"),
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function closeAfterWrite(handle: FileHandle, body: string): Promise<void> {
  try { await handle.chmod(0o600); await handle.writeFile(body, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}

async function enforceParent(path: string, fileSystem: ProfileFileSystem): Promise<void> {
  const parent = dirname(path);
  await fileSystem.mkdir(parent, { recursive: true, mode: 0o700 });
  const before = await fileSystem.lstat(parent);
  if (before.isSymbolicLink() || !before.isDirectory()) throw new SourceProfileError("Source profile parent must be a directory");
  await fileSystem.chmod(parent, 0o700);
  const after = await fileSystem.lstat(parent);
  if (!after.isDirectory() || (after.mode & 0o777) !== 0o700) throw new SourceProfileError("Source profile parent must have mode 0700");
}

async function rejectExistingSymlink(path: string, fileSystem: ProfileFileSystem): Promise<void> {
  try {
    const metadata = await fileSystem.lstat(path);
    if (metadata.isSymbolicLink()) throw new SourceProfileError("Refusing symbolic link Source profile");
    if (!metadata.isFile()) throw new SourceProfileError("Source profile path must be a regular file");
  } catch (error) {
    if (error instanceof SourceProfileError || errorCode(error) !== "ENOENT") throw error;
  }
}

export async function writeSourceProfile(path: string, value: unknown, fileSystem: ProfileFileSystem = nodeFileSystem): Promise<void> {
  const profile = validateSourceProfile(value);
  try {
    await enforceParent(path, fileSystem);
    await rejectExistingSymlink(path, fileSystem);
    const temporaryPath = `${path}.tmp-${process.pid}`;
    try {
      const handle = await fileSystem.open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      await closeAfterWrite(handle, `${JSON.stringify(profile, undefined, 2)}\n`);
      await fileSystem.rename(temporaryPath, path);
    } catch (error) {
      await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error instanceof SourceProfileError) throw error;
    throw new SourceProfileError("Unable to write Source profile");
  }
}

export async function loadSourceProfile(path: string, fileSystem: ProfileFileSystem = nodeFileSystem): Promise<SourceProfile> {
  try {
    const handle = await fileSystem.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new SourceProfileError("Source profile path must be a regular file");
      if ((metadata.mode & 0o777) !== 0o600) throw new SourceProfileError("Source profile must have mode 0600");
      return validateSourceProfile(JSON.parse(await handle.readFile("utf8")));
    } finally { await handle.close(); }
  } catch (error) {
    if (error instanceof SourceProfileError) throw error;
    if (errorCode(error) === "ENOENT") throw new SourceProfileError("Source profile not found; run bbbbb setup");
    if (errorCode(error) === "ELOOP") throw new SourceProfileError("Refusing symbolic link Source profile");
    throw new SourceProfileError("Unable to read Source profile");
  }
}
