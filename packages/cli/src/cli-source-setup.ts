import { normalizeRelayURL } from "@bbbbbapp/protocol";
import { validateSourceProfile, writeSourceProfile, type ProfileFileSystem } from "./source-profile.js";
import { boundedSetupJson, cancelAddSourceSession, setupEndpoint, setupRequest, validateCreatedSetupSession } from "./setup-session-client.js";

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
    created = await setupRequest(dependencies.fetch, setupEndpoint(relay, "/v2/cli-sources/sessions"), {
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
    ({ sessionId, setupSecret, claimURL, code, expiresAt, pollAfterMs } = validateCreatedSetupSession(
      await boundedSetupJson(created),
      dependencies.now(),
    ));
  } catch { dependencies.stderr("Relay returned an invalid setup response. No profile was saved.\n"); return 1; }

  let qr: string;
  try { qr = await dependencies.renderQr(claimURL, input.qrSize); }
  catch { await cancelAddSourceSession(relay, sessionId, setupSecret, dependencies.fetch); dependencies.stderr("Unable to render the setup QR. No profile was saved.\n"); return 1; }
  dependencies.stdout(`Open bbbbb on your iPhone and scan this temporary code.\n${qr}\nUsing this phone? Enter ${code} in Add Source.\nWaiting for approval…\n`);

  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (dependencies.now() + pollAfterMs >= expiresAt) break;
    await dependencies.sleep(Math.max(250, pollAfterMs));
    if (dependencies.now() >= expiresAt) break;
    let response: Response;
    try { response = await setupRequest(dependencies.fetch, setupEndpoint(relay, `/v2/add-source/sessions/${sessionId}`), { headers: { authorization: `Bearer ${setupSecret}` } }); }
    catch { dependencies.stderr("Setup lost relay access. No profile was saved.\n"); return 1; }
    if (response.status !== 200) { dependencies.stderr("CLI Source setup could not continue. No profile was saved.\n"); return 1; }
    try {
      const value = await boundedSetupJson(response);
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
