import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { V2_EVENT_ADMISSION_SQL } from "../src/v2/d1-source-store.js";

const migration = ["0004_v2_http_sources.sql", "0007_v13_inbox_usage.sql", "0010_v13_remove_daily_quota.sql"]
  .map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"))
  .join("\n");

function literal(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function bind(sql: string, values: readonly (string | number | null)[]): string {
  let index = 0;
  const bound = sql.replaceAll("?", () => literal(values[index++]!));
  assert.equal(index, values.length);
  return bound;
}

test("the D1 migration and single-statement admission enforce one aggregate Inbox allowance", () => {
  const directory = mkdtempSync(join(tmpdir(), "bbbbb-v13-d1-"));
  const path = join(directory, "quota.sqlite3");
  const now = Date.parse("2026-08-13T12:00:00Z");
  const inboxId = "inbox_d1_quota_0001";
  const base = `${migration}
    INSERT INTO v2_inboxes VALUES ('${inboxId}', 'public', 'hash', ${now});
    INSERT INTO v2_sources VALUES ('source_d1_alpha_01', '${inboxId}', 'Alpha', 'cli', 'hash', 1, ${now}, ${now}, NULL);
    INSERT INTO v2_sources VALUES ('source_d1_beta_001', '${inboxId}', 'Beta', 'cli', 'hash', 1, ${now}, ${now}, NULL);`;
  const admission = (eventId: string, sourceId: string) => bind(V2_EVENT_ADMISSION_SQL, [
    inboxId, eventId, sourceId, now, "{}",
    inboxId, 1,
  ]);
  try {
    const output = execFileSync("sqlite3", [path], {
      encoding: "utf8",
      input: `PRAGMA foreign_keys = ON;
        ${base}
        ${admission("event-one", "source_d1_alpha_01")};
        ${admission("event-two", "source_d1_beta_001")};
        SELECT COUNT(*) || ':' || (SELECT rolling_count FROM v2_usage_totals WHERE inbox_id = '${inboxId}') FROM v2_event_usage WHERE inbox_id = '${inboxId}';`,
    }).trim();
    assert.equal(output, "event-one\n1:1");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the forward migration removes daily counters while preserving rolling trigger accounting", () => {
  const directory = mkdtempSync(join(tmpdir(), "bbbbb-v13-d1-no-daily-"));
  const path = join(directory, "quota.sqlite3");
  try {
    const output = execFileSync("sqlite3", [path], {
      encoding: "utf8",
      input: `PRAGMA foreign_keys = ON;
        ${migration}
        SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'v2_usage_days';
        SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'v2_event_usage_insert_counts';`,
    }).trim().split("\n");
    assert.equal(output[0], "0");
    assert.doesNotMatch(output.slice(1).join("\n"), /v2_usage_days|day_start|accepted_count/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("D1 usage rows survive retained-event and Source deletion but cascade with the Inbox", () => {
  const directory = mkdtempSync(join(tmpdir(), "bbbbb-v13-d1-delete-"));
  const path = join(directory, "quota.sqlite3");
  try {
    const output = execFileSync("sqlite3", [path], {
      encoding: "utf8",
      input: `PRAGMA foreign_keys = ON;
        ${migration}
        INSERT INTO v2_inboxes VALUES ('inbox_delete_0001', 'public', 'hash', 1);
        INSERT INTO v2_sources VALUES ('source_delete_001', 'inbox_delete_0001', 'Delete', 'cli', 'hash', 1, 1, 1, NULL);
        INSERT INTO v2_event_usage VALUES ('inbox_delete_0001', 'event-one', 'source_delete_001', 1, '{}');
        UPDATE v2_event_usage SET envelope_json = NULL WHERE source_id = 'source_delete_001';
        DELETE FROM v2_sources WHERE source_id = 'source_delete_001';
        SELECT COUNT(*) || ':' || SUM(envelope_json IS NULL) FROM v2_event_usage;
        DELETE FROM v2_inboxes WHERE inbox_id = 'inbox_delete_0001';
        SELECT COUNT(*) FROM v2_event_usage;`,
    }).trim().split("\n");
    assert.deepEqual(output, ["1:1", "0"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
