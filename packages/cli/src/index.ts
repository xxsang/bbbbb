#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import QRCode from "qrcode";

import { cliSourceSetup } from "./cli-source-setup.js";
import { httpSourceSetup } from "./http-source-setup.js";
import {
  storeHttpSourceURL,
  type HttpSourceStoreKind,
  type StoreHttpSourceOptions,
  type StoredHttpSource,
} from "./http-source-store.js";
import {
  loadSourceProfile,
  resolveSourceProfilePath,
  type ProfileFileSystem,
  type SourceProfile,
} from "./source-profile.js";
import {
  checkV2Command,
  runV2Command,
  sendV2Command,
  type ProcessRunner,
  type ProcessRunResult,
} from "./v2-commands.js";

const HELP = `bbbbb CLI

Usage:
  bbbbb --help
  bbbbb --version
  bbbbb setup-http --name <source-name> [--store auto|file|keychain|secret-service|manual]
  bbbbb setup --name <source-name> [--relay <https-or-local-url>] [--qr-size large|compact]
  bbbbb check
  bbbbb send [--category <attention|activity>] [options]
  bbbbb send --json
  bbbbb run -- <command>

Send options: --label <text> --work <text> --message <text> --details-json <flat-json-object>
With no options, send reports a neutral Activity update.
Structured JSON is read from standard input and accepts category, label, work, message, and details only.
Use --flag=value when a send value begins with --.`;

export const CLI_VERSION = "1.3.0";
export const DEFAULT_RELAY_URL = "https://bbbbb-relay-production.xxsang.workers.dev";

export function runCli(args: readonly string[]): string {
  if (args[0] === "--help") return HELP;
  if (args[0] === "--version") return `bbbbb ${CLI_VERSION}`;
  return `Unknown argument: ${args[0] ?? "<none>"}`;
}

export interface CliDependencies {
  readonly loadProfile?: () => Promise<SourceProfile>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly randomUUID?: () => string;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  readonly readStdin?: () => Promise<string>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly homedir?: () => string;
  readonly fileSystem?: ProfileFileSystem;
  readonly runProcess?: ProcessRunner;
  readonly relayTimeoutMs?: number;
  readonly relayRetryDelaysMs?: readonly number[];
  readonly relaySleep?: (milliseconds: number) => Promise<void>;
  readonly renderQr?: (payload: string, size: "compact" | "large") => Promise<string>;
  readonly pairingSleep?: (milliseconds: number) => Promise<void>;
  readonly platform?: NodeJS.Platform;
  readonly storeHttpSourceURL?: (sourceURL: string, options: StoreHttpSourceOptions) => Promise<StoredHttpSource>;
}

export type { ProcessRunResult };

async function readStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

const runProcess: ProcessRunner = (command, args, options) => new Promise((resolve, reject) => {
  const child = spawn(command, [...args], { stdio: options.stdio });
  child.once("error", reject);
  child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
});

function parseSetup(args: readonly string[]): { relay: string; sourceName: string; qrSize: "compact" | "large" } | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !["--relay", "--name", "--qr-size"].includes(flag) || values.has(flag) || !value || value.startsWith("--")) return undefined;
    values.set(flag, value);
  }
  const relay = values.get("--relay") ?? DEFAULT_RELAY_URL;
  const sourceName = values.get("--name");
  const qrSize = values.get("--qr-size") ?? "large";
  if (!sourceName || (qrSize !== "large" && qrSize !== "compact")) return undefined;
  return { relay, sourceName, qrSize };
}

function parseHttpSetup(args: readonly string[]): {
  relay: string;
  sourceName: string;
  qrSize: "compact" | "large";
  store: HttpSourceStoreKind;
} | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag || !["--relay", "--name", "--qr-size", "--store"].includes(flag) || values.has(flag) || !value || value.startsWith("--")) return undefined;
    values.set(flag, value);
  }
  const relay = values.get("--relay") ?? DEFAULT_RELAY_URL;
  const sourceName = values.get("--name");
  const qrSize = values.get("--qr-size") ?? "large";
  const localStore = values.get("--store") ?? "auto";
  if (
    !sourceName ||
    (qrSize !== "large" && qrSize !== "compact") ||
    !["auto", "file", "keychain", "secret-service", "manual"].includes(localStore)
  ) return undefined;
  return {
    relay,
    sourceName,
    qrSize,
    store: localStore as HttpSourceStoreKind,
  };
}

export async function executeCli(args: readonly string[], dependencies: CliDependencies = {}): Promise<number> {
  const stdout = dependencies.stdout ?? ((text) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text) => process.stderr.write(text));
  const profilePath = resolveSourceProfilePath(dependencies.environment ?? process.env, dependencies.homedir ?? homedir);
  const loadProfile = dependencies.loadProfile ?? (() => loadSourceProfile(profilePath, dependencies.fileSystem));
  const sleep = dependencies.relaySleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const commandDependencies = {
    loadProfile,
    fetch: dependencies.fetch ?? globalThis.fetch,
    now: dependencies.now ?? (() => new Date()),
    randomUUID: dependencies.randomUUID ?? randomUUID,
    stdout,
    stderr,
    readStdin: dependencies.readStdin ?? readStdin,
    relayTimeoutMs: dependencies.relayTimeoutMs ?? 15_000,
    relayRetryDelaysMs: dependencies.relayRetryDelaysMs ?? [250, 1_000],
    sleep,
  };

  if (args[0] === "setup") {
    const input = parseSetup(args.slice(1));
    if (!input) { stderr("Invalid setup arguments. See --help.\n"); return 2; }
    return cliSourceSetup(input, {
      profilePath,
      fetch: dependencies.fetch ?? globalThis.fetch,
      renderQr: dependencies.renderQr ?? ((payload, size) => QRCode.toString(payload, { type: "terminal", small: size === "compact", errorCorrectionLevel: "M" })),
      stdout,
      stderr,
      now: () => (dependencies.now?.() ?? new Date()).getTime(),
      sleep: dependencies.pairingSleep ?? sleep,
      ...(dependencies.fileSystem ? { fileSystem: dependencies.fileSystem } : {}),
    });
  }
  if (args[0] === "setup-http") {
    const input = parseHttpSetup(args.slice(1));
    if (!input) { stderr("Invalid setup-http arguments. See --help.\n"); return 2; }
    const persist = dependencies.storeHttpSourceURL ?? storeHttpSourceURL;
    return httpSourceSetup(input, {
      fetch: dependencies.fetch ?? globalThis.fetch,
      renderQr: dependencies.renderQr ?? ((payload, size) => QRCode.toString(payload, { type: "terminal", small: size === "compact", errorCorrectionLevel: "M" })),
      storeSourceURL: (sourceURL) => {
        if (input.store === "manual") {
          stdout("HTTP Source URL — shown once. Anyone who has it can send to this Source.\n");
          stdout(`${sourceURL}\n`);
          stdout("Store it wherever you choose. Replace the Source if the URL is shared more widely than intended.\n");
          return Promise.resolve({ kind: "manual", description: "manual handoff" });
        }
        return persist(sourceURL, {
          kind: input.store,
          platform: dependencies.platform ?? process.platform,
          environment: dependencies.environment ?? process.env,
          getHomeDirectory: dependencies.homedir ?? homedir,
        });
      },
      stdout,
      stderr,
      now: () => (dependencies.now?.() ?? new Date()).getTime(),
      sleep: dependencies.pairingSleep ?? sleep,
    });
  }
  if (args[0] === "check") return checkV2Command(args.slice(1), commandDependencies);
  if (args[0] === "send") return sendV2Command(args.slice(1), commandDependencies);
  if (args[0] === "run") return runV2Command(args.slice(1), { ...commandDependencies, runProcess: dependencies.runProcess ?? runProcess });
  if (args[0] === "--help" || args[0] === "--version") { stdout(`${runCli(args)}\n`); return 0; }
  stderr(`${runCli(args)}\n`);
  return 2;
}

const executablePath = process.argv[1];
if (executablePath && (import.meta.url === pathToFileURL(executablePath).href || import.meta.url === pathToFileURL(realpathSync(executablePath)).href)) {
  process.exitCode = await executeCli(process.argv.slice(2));
}
