import { PROTOCOL_V2 } from "./v2-model.js";

export const V2_TIERS = ["free", "plus"] as const;
export type V2Tier = (typeof V2_TIERS)[number];

export const V2_QUOTA_SCOPES = ["burst", "rolling_30_days"] as const;
export type V2QuotaScope = (typeof V2_QUOTA_SCOPES)[number];

export const V2_TIER_LIMITS = Object.freeze({
  free: Object.freeze({
    rolling30Days: 1_000,
    burst: 20,
    recoveryMaximumEvents: 100,
    recoveryMaximumAgeDays: 7,
  }),
  plus: Object.freeze({
    rolling30Days: 10_000,
    burst: 20,
    recoveryMaximumEvents: 500,
    recoveryMaximumAgeDays: 30,
  }),
} as const);

export interface ProtocolV2UsageSnapshot {
  readonly version: typeof PROTOCOL_V2;
  readonly tier: V2Tier;
  readonly rolling30Days: {
    readonly accepted: number;
    readonly limit: number;
    readonly nextReleaseAt: string | null;
  };
  readonly burst: {
    readonly limit: number;
  };
  readonly recovery: {
    readonly maximumEvents: number;
    readonly maximumAgeDays: number;
  };
}

export interface ProtocolV2QuotaExceeded {
  readonly error: "inbox_quota_exceeded";
  readonly scope: V2QuotaScope;
  readonly retryAt: string;
}

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

function nonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a nonnegative safe integer`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TypeError(`${field} must be an RFC 3339 timestamp`);
  const match = RFC_3339_PATTERN.exec(value);
  if (!match) throw new TypeError(`${field} must be an RFC 3339 timestamp`);
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
    !Number.isFinite(Date.parse(value))
  ) {
    throw new TypeError(`${field} must be an RFC 3339 timestamp`);
  }
  return value;
}

function exactLimit(value: unknown, expected: number, field: string): number {
  const limit = nonnegativeInteger(value, field);
  if (limit !== expected) throw new TypeError(`${field} is inconsistent with tier`);
  return limit;
}

export function validateProtocolV2UsageSnapshot(value: unknown): ProtocolV2UsageSnapshot {
  const candidate = record(value, "Protocol 2 usage snapshot");
  only(candidate, ["version", "tier", "rolling30Days", "burst", "recovery"], "Protocol 2 usage snapshot");
  if (candidate.version !== PROTOCOL_V2) throw new TypeError("version must be 2");
  if (!V2_TIERS.includes(candidate.tier as V2Tier)) throw new TypeError("tier is invalid");

  const tier = candidate.tier as V2Tier;
  const tierLimits = V2_TIER_LIMITS[tier];
  const rolling = record(candidate.rolling30Days, "rolling30Days");
  const burst = record(candidate.burst, "burst");
  const recovery = record(candidate.recovery, "recovery");
  only(rolling, ["accepted", "limit", "nextReleaseAt"], "rolling30Days");
  only(burst, ["limit"], "burst");
  only(recovery, ["maximumEvents", "maximumAgeDays"], "recovery");

  const rollingAccepted = nonnegativeInteger(rolling.accepted, "rolling30Days.accepted");
  const rollingLimit = exactLimit(rolling.limit, tierLimits.rolling30Days, "rolling30Days.limit");

  return {
    version: PROTOCOL_V2,
    tier,
    rolling30Days: {
      accepted: rollingAccepted,
      limit: rollingLimit,
      nextReleaseAt: rolling.nextReleaseAt === null
        ? null
        : timestamp(rolling.nextReleaseAt, "rolling30Days.nextReleaseAt"),
    },
    burst: {
      limit: exactLimit(burst.limit, tierLimits.burst, "burst.limit"),
    },
    recovery: {
      maximumEvents: exactLimit(recovery.maximumEvents, tierLimits.recoveryMaximumEvents, "recovery.maximumEvents"),
      maximumAgeDays: exactLimit(recovery.maximumAgeDays, tierLimits.recoveryMaximumAgeDays, "recovery.maximumAgeDays"),
    },
  };
}

export function validateProtocolV2QuotaExceeded(value: unknown): ProtocolV2QuotaExceeded {
  const candidate = record(value, "Protocol 2 quota error");
  only(candidate, ["error", "scope", "retryAt"], "Protocol 2 quota error");
  if (candidate.error !== "inbox_quota_exceeded") throw new TypeError("quota error is invalid");
  if (!V2_QUOTA_SCOPES.includes(candidate.scope as V2QuotaScope)) throw new TypeError("quota scope is invalid");
  return {
    error: "inbox_quota_exceeded",
    scope: candidate.scope as V2QuotaScope,
    retryAt: timestamp(candidate.retryAt, "retryAt"),
  };
}
