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
import { spawn } from "node:child_process";

export type HttpSourceStoreKind = "auto" | "file" | "keychain" | "secret-service" | "manual";

export interface SecretStoreFileSystem {
  readonly chmod: typeof nodeChmod;
  readonly lstat: typeof nodeLstat;
  readonly mkdir: typeof nodeMkdir;
  readonly open: typeof nodeOpen;
  readonly rename: typeof nodeRename;
  readonly rm: typeof nodeRm;
}

export interface SecretCommandResult {
  readonly exitCode: number | null;
}

export type SecretCommandRunner = (
  command: string,
  args: readonly string[],
  input: string,
) => Promise<SecretCommandResult>;

export interface StoreHttpSourceOptions {
  readonly kind: HttpSourceStoreKind;
  readonly platform?: NodeJS.Platform;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly getHomeDirectory?: () => string;
  readonly runCommand?: SecretCommandRunner;
  readonly fileSystem?: SecretStoreFileSystem;
}

export interface StoredHttpSource {
  readonly kind: Exclude<HttpSourceStoreKind, "auto">;
  readonly description: string;
}

const nodeFileSystem: SecretStoreFileSystem = {
  chmod: nodeChmod,
  lstat: nodeLstat,
  mkdir: nodeMkdir,
  open: nodeOpen,
  rename: nodeRename,
  rm: nodeRm,
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function closeAfterWrite(handle: FileHandle, body: string): Promise<void> {
  try {
    await handle.chmod(0o600);
    await handle.writeFile(body, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function resolveHttpSourceFilePath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  getHomeDirectory: () => string = homedir,
): string {
  const configRoot = environment.XDG_CONFIG_HOME ?? join(getHomeDirectory(), ".config");
  return environment.BBBBB_HTTP_SOURCE_FILE ?? join(configRoot, "bbbbb", "http-source-url");
}

export async function writeOwnerOnlyHttpSourceURL(
  path: string,
  sourceURL: string,
  fileSystem: SecretStoreFileSystem = nodeFileSystem,
): Promise<void> {
  const parent = dirname(path);
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await fileSystem.mkdir(parent, { recursive: true, mode: 0o700 });
    const parentBefore = await fileSystem.lstat(parent);
    if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory()) throw new Error("invalid parent");
    await fileSystem.chmod(parent, 0o700);
    const parentAfter = await fileSystem.lstat(parent);
    if (!parentAfter.isDirectory() || (parentAfter.mode & 0o777) !== 0o700) throw new Error("invalid parent permissions");
    try {
      const existing = await fileSystem.lstat(path);
      if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("invalid destination");
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    try {
      const handle = await fileSystem.open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      await closeAfterWrite(handle, `${sourceURL}\n`);
      await fileSystem.rename(temporaryPath, path);
    } catch (error) {
      await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  } catch {
    throw new Error("Unable to store the HTTP Source credential in an owner-only file.");
  }
}

const runSecretCommand: SecretCommandRunner = (command, args, input) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { stdio: ["pipe", "ignore", "ignore"] });
  child.once("error", reject);
  child.once("close", (exitCode) => resolve({ exitCode }));
  child.stdin.end(input);
});

async function tryCommand(
  command: string,
  args: readonly string[],
  sourceURL: string,
  runner: SecretCommandRunner,
): Promise<boolean> {
  try {
    return (await runner(command, args, `${sourceURL}\n`)).exitCode === 0;
  } catch {
    return false;
  }
}

export async function storeHttpSourceURL(
  sourceURL: string,
  options: StoreHttpSourceOptions,
): Promise<StoredHttpSource> {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const runner = options.runCommand ?? runSecretCommand;
  const requested = options.kind;

  if (requested === "manual") {
    throw new Error("Manual HTTP Source handoff must be handled by the interactive setup command.");
  }

  if (requested === "keychain" || (requested === "auto" && platform === "darwin")) {
    const account = environment.USER ?? "bbbbb";
    if (await tryCommand(
      "/usr/bin/security",
      ["add-generic-password", "-U", "-a", account, "-s", "bbbbb-http-source", "-w"],
      sourceURL,
      runner,
    )) {
      return { kind: "keychain", description: "macOS Keychain" };
    }
    if (requested === "keychain") throw new Error("Unable to save the HTTP Source credential in macOS Keychain.");
  }

  if (requested === "secret-service" || (requested === "auto" && platform === "linux")) {
    if (await tryCommand(
      "secret-tool",
      ["store", "--label=bbbbb HTTP Source", "application", "bbbbb", "source", "http"],
      sourceURL,
      runner,
    )) {
      return { kind: "secret-service", description: "Secret Service" };
    }
    if (requested === "secret-service") throw new Error("Unable to save the HTTP Source credential in Secret Service.");
  }

  const path = resolveHttpSourceFilePath(environment, options.getHomeDirectory ?? homedir);
  await writeOwnerOnlyHttpSourceURL(path, sourceURL, options.fileSystem ?? nodeFileSystem);
  return { kind: "file", description: "an owner-only local file" };
}
