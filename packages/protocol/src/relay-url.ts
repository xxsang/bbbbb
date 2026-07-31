export class InvalidRelayURLError extends Error {
  constructor() {
    super("Invalid relay URL");
    this.name = "InvalidRelayURLError";
  }
}

export function normalizeRelayURL(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new InvalidRelayURLError(); }
  const localHttp = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash || url.href.length > 2_048) {
    throw new InvalidRelayURLError();
  }
  return url.href.replace(/\/$/u, "");
}
