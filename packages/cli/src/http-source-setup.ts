import { normalizeRelayURL } from "@bbbbbapp/protocol";

import type { StoredHttpSource } from "./http-source-store.js";
import { boundedSetupJson, cancelAddSourceSession, setupEndpoint, setupRequest, validateCreatedSetupSession } from "./setup-session-client.js";

export interface HttpSourceSetupDependencies {
  readonly fetch: typeof fetch;
  readonly renderQr: (payload: string, size: "compact" | "large") => Promise<string>;
  readonly storeSourceURL: (sourceURL: string) => Promise<StoredHttpSource>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly now: () => number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/u;

function validateSourceURL(relay: string, value: Record<string, unknown>): string {
  if (value.version !== 2 || value.state !== "completed") throw new TypeError("invalid response");
  const sourceRecord = value.source;
  if (typeof sourceRecord !== "object" || sourceRecord === null || Array.isArray(sourceRecord)) throw new TypeError("invalid response");
  const source = sourceRecord as Record<string, unknown>;
  const candidate = typeof value.sourceURL === "string" ? new URL(value.sourceURL) : undefined;
  const match = candidate ? /^\/v2\/sources\/([A-Za-z0-9_-]{16,128})\/events$/u.exec(candidate.pathname) : null;
  const keys = candidate?.searchParams.getAll("key") ?? [];
  if (
    !candidate ||
    candidate.origin !== new URL(relay).origin ||
    candidate.username ||
    candidate.password ||
    candidate.hash ||
    !match ||
    [...candidate.searchParams.keys()].length !== 1 ||
    keys.length !== 1 ||
    !CREDENTIAL.test(keys[0] ?? "") ||
    source.sourceId !== match[1] ||
    source.method !== "http" ||
    source.enabled !== true
  ) throw new TypeError("invalid response");
  return candidate.toString();
}

export async function httpSourceSetup(
  input: { readonly relay: string; readonly sourceName: string; readonly qrSize: "compact" | "large" },
  dependencies: HttpSourceSetupDependencies,
): Promise<number> {
  let relay: string;
  const sourceName = input.sourceName.trim();
  try {
    relay = normalizeRelayURL(input.relay);
  } catch {
    dependencies.stderr("Invalid relay URL.\n");
    return 2;
  }
  if (sourceName !== input.sourceName || sourceName.length === 0 || new TextEncoder().encode(sourceName).byteLength > 80) {
    dependencies.stderr("Invalid Source name. Use 1-80 UTF-8 bytes.\n");
    return 2;
  }

  let created: Response;
  try {
    created = await setupRequest(dependencies.fetch, setupEndpoint(relay, "/v2/add-source/sessions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceName }),
    });
  } catch {
    dependencies.stderr("Unable to reach relay. Check outbound HTTPS access and try again.\n");
    return 1;
  }
  if (created.status !== 201) {
    dependencies.stderr("HTTP Source setup could not start. Try again.\n");
    return 1;
  }

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
  } catch {
    dependencies.stderr("Relay returned an invalid setup response. No credential was stored.\n");
    return 1;
  }

  let qr: string;
  try {
    qr = await dependencies.renderQr(claimURL, input.qrSize);
  } catch {
    await cancelAddSourceSession(relay, sessionId, setupSecret, dependencies.fetch);
    dependencies.stderr("Unable to render the setup QR. No credential was stored.\n");
    return 1;
  }
  dependencies.stdout(`Open bbbbb on your iPhone and scan this temporary code.\n${qr}\nUsing this phone? Enter ${code} in Add Source.\nWaiting for approval…\n`);

  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (dependencies.now() + pollAfterMs >= expiresAt) break;
    await dependencies.sleep(Math.max(250, pollAfterMs));
    if (dependencies.now() >= expiresAt) break;
    let response: Response;
    try {
      response = await setupRequest(dependencies.fetch, setupEndpoint(relay, `/v2/add-source/sessions/${sessionId}`), {
        headers: { authorization: `Bearer ${setupSecret}` },
      });
    } catch {
      dependencies.stderr("Setup lost relay access. No credential was stored.\n");
      return 1;
    }
    if (response.status !== 200) {
      dependencies.stderr("HTTP Source setup could not continue. No credential was stored.\n");
      return 1;
    }
    let sourceURL: string;
    try {
      const value = await boundedSetupJson(response);
      if (value.state === "awaiting_approval" || value.state === "approved") continue;
      sourceURL = validateSourceURL(relay, value);
    } catch {
      dependencies.stderr("Relay returned an invalid or unsafe HTTP Source. No credential was stored.\n");
      return 1;
    }

    let stored: StoredHttpSource;
    try {
      stored = await dependencies.storeSourceURL(sourceURL);
    } catch (error) {
      dependencies.stderr(`${error instanceof Error ? error.message : "Unable to store the HTTP Source credential."}\n`);
      dependencies.stderr("The Source was approved but its credential was not retained. Replace it in bbbbb before retrying.\n");
      return 1;
    }

    try {
      const test = await setupRequest(dependencies.fetch, sourceURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: "activity",
          label: "Test",
          work: "Setup test",
          message: "bbbbb can receive activity from this Source.",
        }),
      });
      if (!test.ok) throw new TypeError("test rejected");
    } catch {
      dependencies.stderr(`Credential saved to ${stored.description}, but the setup test was not accepted. Retry the test before relying on this Source.\n`);
      return 1;
    }
    dependencies.stdout(stored.kind === "manual"
      ? "HTTP Source ready. Credential shown once for storage in your chosen destination. Test accepted.\n"
      : `HTTP Source ready. Credential saved to ${stored.description}. Test accepted.\n`);
    return 0;
  }
  dependencies.stderr("The setup code expired. Run bbbbb setup-http again.\n");
  return 1;
}
