export class BodyTooLargeError extends Error {}

export async function readBoundedBody(request: Request, maximumBytes: number): Promise<string> {
  // The Content-Length header is only an early-exit optimization; a client can
  // omit or lie about it. The streaming loop below is the real enforcement and
  // rejects any body that exceeds the limit regardless of the header. A
  // non-numeric header yields NaN here, which fails the comparison and safely
  // falls through to the stream guard.
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > maximumBytes) {
    throw new BodyTooLargeError(`Request body exceeded ${maximumBytes} bytes`);
  }
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("Request body exceeded limit");
      throw new BodyTooLargeError(`Request body exceeded ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}
