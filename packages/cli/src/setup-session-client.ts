const IDENTIFIER = /^[A-Za-z0-9_-]{16,128}$/u;
const MAX_RESPONSE_BYTES = 16 * 1_024;

export interface CreatedSetupSession {
  readonly sessionId: string;
  readonly setupSecret: string;
  readonly claimURL: string;
  readonly code: string;
  readonly expiresAt: number;
  readonly pollAfterMs: number;
}

export function setupEndpoint(relay: string, path: string): string {
  return `${relay}${path}`;
}

export async function setupRequest(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  return fetcher(url, {
    ...init,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
}

export async function boundedSetupJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new TypeError("invalid response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TypeError("invalid response");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid response");
  return value as Record<string, unknown>;
}

export function validateCreatedSetupSession(value: Record<string, unknown>, now: number): CreatedSetupSession {
  const sessionId = typeof value.sessionId === "string" ? value.sessionId : "";
  const setupSecret = typeof value.setupSecret === "string" ? value.setupSecret : "";
  const claimURL = typeof value.claimURL === "string" ? value.claimURL : "";
  const code = typeof value.code === "string" ? value.code : "";
  const expiresAt = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : Number.NaN;
  const pollAfterMs = typeof value.pollAfterMs === "number" ? value.pollAfterMs : Number.NaN;
  const claim = new URL(claimURL);
  if (
    value.version !== 2 ||
    !IDENTIFIER.test(sessionId) ||
    setupSecret.length < 32 ||
    claim.protocol !== "bbbbb:" ||
    claim.hostname !== "add-source" ||
    !/^\d{3}-\d{3}$/u.test(code) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    !Number.isInteger(pollAfterMs) ||
    pollAfterMs < 250 ||
    pollAfterMs > 10_000
  ) throw new TypeError("invalid response");
  return { sessionId, setupSecret, claimURL, code, expiresAt, pollAfterMs };
}

export async function cancelAddSourceSession(
  relay: string,
  sessionId: string,
  setupSecret: string,
  fetcher: typeof fetch,
): Promise<void> {
  try {
    await setupRequest(fetcher, setupEndpoint(relay, `/v2/add-source/sessions/${sessionId}`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${setupSecret}` },
    });
  } catch {
    // Expiry remains the cleanup boundary.
  }
}
