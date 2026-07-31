import { constants as osConstants } from "node:os";
import {
  PROTOCOL_V2,
  V2_CATEGORIES,
  canonicalizeProtocolV2Event,
  sealProtocolV2Event,
  type ProtocolV2Event,
  type V2Category,
} from "@bbbbbapp/protocol";

import type { SourceProfile } from "./source-profile.js";

export interface V2CommandDependencies {
  readonly loadProfile: () => Promise<SourceProfile>;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly randomUUID: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly readStdin: () => Promise<string>;
  readonly relayTimeoutMs: number;
  readonly relayRetryDelaysMs: readonly number[];
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface ProcessRunResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: "inherit" },
) => Promise<ProcessRunResult>;

const SEND_FLAGS = new Set(["--category", "--label", "--work", "--message", "--details-json"]);
const RETRYABLE = new Set([408, 425, 500, 502, 503, 504]);

function parseFlags(args: readonly string[]): Map<string, string> | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length;) {
    const argument = args[index];
    const equals = argument?.indexOf("=") ?? -1;
    const inline = equals > 2;
    const flag = inline ? argument?.slice(0, equals) : argument;
    const value = inline ? argument?.slice(equals + 1) : args[index + 1];
    if (!flag || !SEND_FLAGS.has(flag) || values.has(flag) || value === undefined || value.length === 0 || (!inline && value.startsWith("--"))) return undefined;
    values.set(flag, value);
    index += inline ? 1 : 2;
  }
  return values;
}

function eventEndpoint(profile: SourceProfile): string {
  return `${profile.relay}/v2/sources/${encodeURIComponent(profile.sourceId)}/events`;
}

async function cancelResponse(response: Response): Promise<void> {
  try { await response.body?.cancel(); }
  catch { /* resource cleanup only */ }
}

async function requestWithRetry(
  input: string,
  init: RequestInit,
  dependencies: V2CommandDependencies,
): Promise<Response | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.relayTimeoutMs);
  try {
    for (let attempt = 0;; attempt += 1) {
      try {
        const response = await dependencies.fetch(input, { ...init, signal: controller.signal });
        const delay = dependencies.relayRetryDelaysMs[attempt];
        if (delay === undefined || !RETRYABLE.has(response.status)) return response;
        await cancelResponse(response);
        await dependencies.sleep(delay);
      } catch {
        const delay = dependencies.relayRetryDelaysMs[attempt];
        if (controller.signal.aborted || delay === undefined) return undefined;
        await dependencies.sleep(delay);
      }
      if (controller.signal.aborted) return undefined;
    }
  } finally { clearTimeout(timeout); }
}

async function profile(dependencies: V2CommandDependencies): Promise<SourceProfile | undefined> {
  try { return await dependencies.loadProfile(); }
  catch (error) {
    dependencies.stderr(`${error instanceof Error ? error.message : "Unable to load Source profile"}\n`);
    return undefined;
  }
}

function rejection(status: number): string {
  if (status === 401) return "Source credential was rejected. Replace this Source credential and set up the CLI again.";
  if (status === 403) return "This Source is disabled. Re-enable it in bbbbb and try again.";
  if (status === 400) return "Relay rejected an invalid encrypted event. Update the CLI and try again.";
  if (status === 413) return "Inbox event exceeds the relay size limit.";
  if (status === 429) return "Source limit reached. Wait and try again.";
  if (RETRYABLE.has(status)) return "Relay is temporarily unavailable. Try again later.";
  return `Relay rejected submission (status ${status}).`;
}

export async function checkV2Command(args: readonly string[], dependencies: V2CommandDependencies): Promise<number> {
  if (args.length !== 0) { dependencies.stderr("Invalid check arguments. See --help.\n"); return 2; }
  const loaded = await profile(dependencies);
  if (!loaded) return 1;
  const response = await requestWithRetry(eventEndpoint(loaded), { headers: { authorization: `Bearer ${loaded.writeCredential}` } }, dependencies);
  if (!response) { dependencies.stderr("Unable to reach relay. Check this environment's outbound HTTPS access and try again.\n"); return 1; }
  const status = response.status;
  await cancelResponse(response);
  if (status !== 204) { dependencies.stderr(`${rejection(status)}\n`); return 1; }
  dependencies.stdout("Ready.\n");
  return 0;
}

type SendInput = Pick<ProtocolV2Event, "category" | "label" | "work" | "message" | "details">;

function structuredInput(value: unknown): SendInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid structured input");
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !["category", "label", "work", "message", "details"].includes(key))) throw new TypeError("invalid structured input");
  return candidate as SendInput;
}

async function sendInput(args: readonly string[], dependencies: V2CommandDependencies): Promise<SendInput | undefined> {
  if (args.length === 1 && args[0] === "--json") {
    try { return structuredInput(JSON.parse(await dependencies.readStdin())); }
    catch { return undefined; }
  }
  const flags = parseFlags(args);
  if (!flags) return undefined;
  const category = flags.get("--category") ?? "activity";
  if (!V2_CATEGORIES.includes(category as V2Category)) return undefined;
  let details: unknown;
  try { details = flags.has("--details-json") ? JSON.parse(flags.get("--details-json")!) : undefined; }
  catch { return undefined; }
  return {
    category: category as V2Category,
    label: flags.get("--label") ?? "Update",
    ...(flags.has("--work") ? { work: flags.get("--work")! } : {}),
    ...(flags.has("--message") ? { message: flags.get("--message")! } : {}),
    ...(details === undefined ? {} : { details: details as NonNullable<ProtocolV2Event["details"]> }),
  };
}

export async function sendV2Command(args: readonly string[], dependencies: V2CommandDependencies): Promise<number> {
  const input = await sendInput(args, dependencies);
  if (!input) { dependencies.stderr("Invalid send arguments. See --help.\n"); return 2; }
  const loaded = await profile(dependencies);
  if (!loaded) return 1;
  let envelope;
  try {
    const event = canonicalizeProtocolV2Event({
      version: PROTOCOL_V2,
      eventId: dependencies.randomUUID(),
      sourceId: loaded.sourceId,
      source: loaded.source,
      sourceMethod: "cli",
      occurredAt: dependencies.now().toISOString(),
      ...input,
    });
    envelope = await sealProtocolV2Event(event, loaded.inboxId, loaded.inboxPublicKey);
  } catch {
    dependencies.stderr("Invalid send arguments. See --help.\n");
    return 2;
  }
  const response = await requestWithRetry(eventEndpoint(loaded), {
    method: "POST",
    headers: { authorization: `Bearer ${loaded.writeCredential}`, "content-type": "application/json" },
    body: JSON.stringify(envelope),
  }, dependencies);
  if (!response) { dependencies.stderr("Unable to reach relay. Check this environment's outbound HTTPS access and try again.\n"); return 1; }
  const status = response.status;
  await cancelResponse(response);
  if (status !== 202) { dependencies.stderr(`${rejection(status)}\n`); return 1; }
  dependencies.stdout("Accepted.\n");
  return 0;
}

function signalStatus(signal: NodeJS.Signals | null): number {
  if (!signal) return 1;
  return osConstants.signals[signal] === undefined ? 1 : 128 + osConstants.signals[signal];
}

function boundedWork(command: string, args: readonly string[]): string {
  const original = [command, ...args].join(" ");
  const encoder = new TextEncoder();
  if (encoder.encode(original).byteLength <= 200) return original;
  let result = "";
  for (const character of original) {
    if (encoder.encode(`${result}${character}…`).byteLength > 200) break;
    result += character;
  }
  return `${result}…`;
}

export async function runV2Command(
  args: readonly string[],
  dependencies: V2CommandDependencies & { readonly runProcess: ProcessRunner },
): Promise<number> {
  if (args[0] !== "--" || !args[1]) { dependencies.stderr("Invalid run arguments. Expected: run -- <command>.\n"); return 2; }
  const command = args[1];
  const commandArgs = args.slice(2);
  let result: ProcessRunResult;
  try { result = await dependencies.runProcess(command, commandArgs, { stdio: "inherit" }); }
  catch { dependencies.stderr("Unable to start wrapped command.\n"); return 127; }
  const status = result.exitCode ?? signalStatus(result.signal);
  const category: V2Category = result.exitCode === null || status === 0 ? "activity" : "attention";
  const label = result.exitCode === null ? "Cancelled" : status === 0 ? "Succeeded" : "Failed";
  const message = result.exitCode === null && result.signal ? `Terminated by ${result.signal}` : `Exited with status ${status}`;
  const submitted = await sendV2Command(["--category", category, "--label", label, "--work", boundedWork(command, commandArgs), "--message", message], dependencies);
  if (submitted !== 0) dependencies.stderr("Inbox event was not sent.\n");
  return status;
}
