import { normalizeRelayURL } from "@bbbbbapp/protocol";
import { validateSourceProfile, writeSourceProfile, type ProfileFileSystem } from "./source-profile.js";

export interface CliSourceSetupDependencies {
  readonly profilePath: string;
  readonly fetch: typeof fetch;
  readonly renderQr: (payload: string, size: "compact" | "large") => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly fileSystem?: ProfileFileSystem;
}

const IDENTIFIER = /^[A-Za-z0-9_-]{16,128}$/u;
const MAX_RESPONSE_BYTES = 16 * 1_024;

async function request(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  return fetcher(url, { ...init, redirect: "error", signal: init.signal ?? AbortSignal.timeout(15_000) });
}

async function boundedJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new TypeError("invalid response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new TypeError("invalid response"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid response");
  return value as Record<string, unknown>;
}

function endpoint(relay: string, path: string): string { return `${relay}${path}`; }

async function cancel(relay: string, sessionId: string, setupSecret: string, fetcher: typeof fetch): Promise<void> {
  try { await request(fetcher, endpoint(relay, `/v2/add-source/sessions/${sessionId}`), { method: "DELETE", headers: { authorization: `Bearer ${setupSecret}` } }); }
  catch { /* expiry remains the cleanup boundary */ }
}

export async function cliSourceSetup(
  input: { readonly relay: string; readonly sourceName: string; readonly qrSize: "compact" | "large" },
  dependencies: CliSourceSetupDependencies,
): Promise<number> {
  let relay: string;
  const sourceName = input.sourceName.trim();
  try { relay = normalizeRelayURL(input.relay); }
  catch { dependencies.stderr("Invalid relay URL.\n"); return 2; }
  if (sourceName !== input.sourceName || sourceName.length === 0 || new TextEncoder().encode(sourceName).byteLength > 80) {
    dependencies.stderr("Invalid Source name. Use 1-80 UTF-8 bytes.\n");
    return 2;
  }

  let created: Response;
  try {
    created = await request(dependencies.fetch, endpoint(relay, "/v2/cli-sources/sessions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName }),
    });
  } catch { dependencies.stderr("Unable to reach relay. Check outbound HTTPS access and try again.\n"); return 1; }
  if (created.status !== 201) { dependencies.stderr("CLI Source setup could not start. Try again.\n"); return 1; }

  let sessionId: string;
  let setupSecret: string;
  let claimURL: string;
  let code: string;
  let expiresAt: number;
  let pollAfterMs: number;
  try {
    const value = await boundedJson(created);
    sessionId = typeof value.sessionId === "string" ? value.sessionId : "";
    setupSecret = typeof value.setupSecret === "string" ? value.setupSecret : "";
    claimURL = typeof value.claimURL === "string" ? value.claimURL : "";
    code = typeof value.code === "string" ? value.code : "";
    expiresAt = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : Number.NaN;
    pollAfterMs = typeof value.pollAfterMs === "number" ? value.pollAfterMs : Number.NaN;
    const claim = new URL(claimURL);
    if (value.version !== 2 || !IDENTIFIER.test(sessionId) || setupSecret.length < 32 || claim.protocol !== "bbbbb:" || claim.hostname !== "add-source" || !/^\d{3}-\d{3}$/u.test(code) || !Number.isFinite(expiresAt) || expiresAt <= dependencies.now() || !Number.isInteger(pollAfterMs) || pollAfterMs < 250 || pollAfterMs > 10_000) throw new TypeError("invalid response");
  } catch { dependencies.stderr("Relay returned an invalid setup response. No profile was saved.\n"); return 1; }

  let qr: string;
  try { qr = await dependencies.renderQr(claimURL, input.qrSize); }
  catch { await cancel(relay, sessionId, setupSecret, dependencies.fetch); dependencies.stderr("Unable to render the setup QR. No profile was saved.\n"); return 1; }
  dependencies.stdout(`Open bbbbb on your iPhone and scan this temporary code.\n${qr}\nUsing this phone? Enter ${code} in Add Source.\nWaiting for approval…\n`);

  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (dependencies.now() + pollAfterMs >= expiresAt) break;
    await dependencies.sleep(Math.max(250, pollAfterMs));
    if (dependencies.now() >= expiresAt) break;
    let response: Response;
    try { response = await request(dependencies.fetch, endpoint(relay, `/v2/add-source/sessions/${sessionId}`), { headers: { authorization: `Bearer ${setupSecret}` } }); }
    catch { dependencies.stderr("Setup lost relay access. No profile was saved.\n"); return 1; }
    if (response.status !== 200) { dependencies.stderr("CLI Source setup could not continue. No profile was saved.\n"); return 1; }
    try {
      const value = await boundedJson(response);
      if (value.state === "awaiting_approval" || value.state === "approved") continue;
      if (value.state !== "completed" || value.version !== 2 || typeof value.profile !== "object" || value.profile === null) throw new TypeError("invalid response");
      const profile = validateSourceProfile(value.profile);
      if (profile.relay !== relay || profile.source !== sourceName) throw new TypeError("invalid response");
      await writeSourceProfile(dependencies.profilePath, profile, dependencies.fileSystem);
      dependencies.stdout("CLI Source ready. Profile saved with owner-only permissions.\n");
      return 0;
    } catch { dependencies.stderr("Relay returned an invalid or unsafe profile. No profile was saved.\n"); return 1; }
  }
  dependencies.stderr("The setup code expired. Run bbbbb setup again.\n");
  return 1;
}
