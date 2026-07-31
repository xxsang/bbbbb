const encoder = new TextEncoder();

export const PROTOCOL_V2 = 2 as const;

export const V2_CATEGORIES = ["attention", "activity"] as const;
export type V2Category = (typeof V2_CATEGORIES)[number];
export const V2_SOURCE_METHODS = ["http", "cli"] as const;
export type V2SourceMethod = (typeof V2_SOURCE_METHODS)[number];
export type V2DetailValue = string | number | boolean;

export interface ProtocolV2Event {
  readonly version: typeof PROTOCOL_V2;
  readonly eventId: string;
  readonly sourceId: string;
  readonly source: string;
  readonly sourceMethod?: V2SourceMethod;
  readonly category: V2Category;
  readonly label?: string;
  readonly occurredAt: string;
  readonly work?: string;
  readonly message?: string;
  readonly details?: Readonly<Record<string, V2DetailValue>>;
}

export const V2_LIMITS = Object.freeze({
  sourceIdBytes: 128,
  sourceBytes: 80,
  workBytes: 200,
  labelBytes: 80,
  messageBytes: 2_000,
  occurredAtBytes: 128,
  detailEntries: 12,
  detailKeyBytes: 64,
  detailStringBytes: 500,
  canonicalEventBytes: 16_384,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const RFC_3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} has unknown field: ${key}`);
  }
}

function boundedString(
  value: unknown,
  field: string,
  maximumBytes: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    encoder.encode(value).byteLength > maximumBytes
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return value;
}

function timestamp(value: unknown): string {
  const candidate = boundedString(value, "occurredAt", V2_LIMITS.occurredAtBytes);
  const match = RFC_3339_PATTERN.exec(candidate);
  if (!match) throw new TypeError("occurredAt must be an RFC 3339 timestamp");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    month < 1 || month > 12 || day < 1 || daysInMonth === undefined || day > daysInMonth ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
    !Number.isFinite(Date.parse(candidate))
  ) {
    throw new TypeError("occurredAt must be an RFC 3339 timestamp");
  }
  return candidate;
}

function details(value: unknown): Readonly<Record<string, V2DetailValue>> {
  const candidate = record(value, "details");
  const entries = Object.entries(candidate);
  if (entries.length > V2_LIMITS.detailEntries) throw new TypeError("details has too many entries");

  const validated: Record<string, V2DetailValue> = {};
  for (const [key, raw] of entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    boundedString(key, "details key", V2_LIMITS.detailKeyBytes);
    if (typeof raw === "string") {
      validated[key] = boundedString(raw, `details.${key}`, V2_LIMITS.detailStringBytes, true);
    } else if (typeof raw === "boolean") {
      validated[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      validated[key] = raw;
    } else {
      throw new TypeError(`details.${key} must be a scalar`);
    }
  }
  return validated;
}

export function canonicalizeProtocolV2Event(value: unknown): ProtocolV2Event {
  const candidate = record(value, "Protocol 2 event");
  only(
    candidate,
    ["version", "eventId", "sourceId", "source", "sourceMethod", "category", "label", "occurredAt", "work", "message", "details"],
    "Protocol 2 event",
  );
  if (candidate.version !== PROTOCOL_V2) throw new TypeError("version must be 2");
  if (typeof candidate.eventId !== "string" || !UUID_PATTERN.test(candidate.eventId)) {
    throw new TypeError("eventId must be a UUID");
  }
  const sourceId = boundedString(candidate.sourceId, "sourceId", V2_LIMITS.sourceIdBytes);
  if (!SOURCE_ID_PATTERN.test(sourceId)) throw new TypeError("sourceId is invalid");
  if (!V2_CATEGORIES.includes(candidate.category as V2Category)) throw new TypeError("category is invalid");

  const canonical: ProtocolV2Event = {
    version: PROTOCOL_V2,
    eventId: candidate.eventId,
    sourceId,
    source: boundedString(candidate.source, "source", V2_LIMITS.sourceBytes),
    ...(candidate.sourceMethod === undefined
      ? {}
      : V2_SOURCE_METHODS.includes(candidate.sourceMethod as V2SourceMethod)
        ? { sourceMethod: candidate.sourceMethod as V2SourceMethod }
        : (() => { throw new TypeError("sourceMethod is invalid"); })()),
    category: candidate.category as V2Category,
    ...(candidate.label === undefined ? {} : { label: boundedString(candidate.label, "label", V2_LIMITS.labelBytes) }),
    occurredAt: timestamp(candidate.occurredAt),
    ...(candidate.work === undefined
      ? {}
      : { work: boundedString(candidate.work, "work", V2_LIMITS.workBytes) }),
    ...(candidate.message === undefined
      ? {}
      : { message: boundedString(candidate.message, "message", V2_LIMITS.messageBytes, true) }),
    ...(candidate.details === undefined ? {} : { details: details(candidate.details) }),
  };

  if (canonicalProtocolV2Bytes(canonical).byteLength > V2_LIMITS.canonicalEventBytes) {
    throw new TypeError("Protocol 2 event exceeds the canonical byte limit");
  }
  return canonical;
}

export function canonicalProtocolV2Bytes(event: ProtocolV2Event): Uint8Array {
  return encoder.encode(JSON.stringify(event));
}

export interface HttpV2Input {
  readonly category?: unknown;
  readonly label?: unknown;
  readonly work?: unknown;
  readonly message?: unknown;
  readonly details?: unknown;
}

export function normalizeHttpV2Input(
  input: HttpV2Input,
  supplied: Pick<ProtocolV2Event, "eventId" | "sourceId" | "source" | "sourceMethod" | "occurredAt">,
): ProtocolV2Event {
  const candidate = record(input, "HTTP event input");
  only(candidate, ["category", "label", "work", "message", "details"], "HTTP event input");
  return canonicalizeProtocolV2Event({
    version: PROTOCOL_V2,
    ...supplied,
    category: candidate.category ?? "activity",
    label: candidate.label ?? "Update",
    ...(candidate.work === undefined ? {} : { work: candidate.work }),
    ...(candidate.message === undefined ? {} : { message: candidate.message }),
    ...(candidate.details === undefined ? {} : { details: candidate.details }),
  });
}
