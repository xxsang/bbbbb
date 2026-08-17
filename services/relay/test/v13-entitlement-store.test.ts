import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { V2_ENTITLEMENT_DELETE_BINDINGS_SQL, V2_ENTITLEMENT_INSERT_BINDING_SQL, V2_ENTITLEMENT_UPSERT_SQL } from "../src/v2/d1-source-store.js";
import { MemoryV2SourceStore } from "../src/v2/memory-source-store.js";
import type { V2Inbox, V2VerifiedEntitlementClaim } from "../src/v2/source-store.js";

const productId = "org.shenren.bbbbb.plus" as const;
const inbox = (inboxId: string): V2Inbox => ({ inboxId, publicKey: "public", readCredentialHash: "hash", createdAt: 1 });
const active = (entitlementId: string, stateChangedAt = 100): V2VerifiedEntitlementClaim => ({
  entitlementId,
  productId,
  environment: "xcode",
  status: "active",
  stateChangedAt,
  verifiedAt: stateChangedAt + 10,
});

test("memory entitlement binding is idempotent, moves atomically, and survives Inbox deletion", async () => {
  const store = new MemoryV2SourceStore();
  for (const id of ["inbox_entitlement_a", "inbox_entitlement_b", "inbox_entitlement_c"]) await store.createInbox(inbox(id));
  const claim = active("derived_entitlement_AAAAAAAAAAAAA");
  assert.equal(await store.applyEntitlement(claim, "inbox_entitlement_a"), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a"), "plus");
  assert.equal(await store.applyEntitlement(claim, "inbox_entitlement_a"), "idempotent");
  assert.equal(store.entitlements.size, 1);

  assert.equal(await store.applyEntitlement({ ...claim, verifiedAt: 120 }, "inbox_entitlement_b"), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a"), "free");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_b"), "plus");

  await store.deleteInbox("inbox_entitlement_b");
  assert.equal(store.entitlements.size, 1);
  assert.equal(store.entitlementBindings.size, 0);
  assert.equal(await store.applyEntitlement({ ...claim, verifiedAt: 130 }, "inbox_entitlement_c"), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_c"), "plus");
});

test("newer revocation wins over replay and a target Inbox keeps at most one entitlement", async () => {
  const store = new MemoryV2SourceStore();
  await store.createInbox(inbox("inbox_entitlement_a"));
  const first = active("derived_entitlement_AAAAAAAAAAAAA");
  const second = active("derived_entitlement_BBBBBBBBBBBBB");
  await store.applyEntitlement(first, "inbox_entitlement_a");
  await store.applyEntitlement(second, "inbox_entitlement_a");
  assert.equal(store.entitlementBindings.size, 1);
  assert.equal(store.entitlementBindings.get(second.entitlementId), "inbox_entitlement_a");

  const revoked = { ...second, status: "revoked", stateChangedAt: 200, verifiedAt: 210 } as const;
  assert.equal(await store.applyEntitlement(revoked, null), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a"), "free");
  assert.equal(await store.applyEntitlement({ ...second, verifiedAt: 220 }, "inbox_entitlement_a"), "stale");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a"), "free");
});

function literal(value: string | number): string {
  return typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
}
function bind(sql: string, values: readonly (string | number)[]): string {
  let index = 0;
  const bound = sql.replaceAll("?", () => literal(values[index++]!));
  assert.equal(index, values.length);
  return bound;
}
function applySQL(claim: V2VerifiedEntitlementClaim, inboxId: string | null): string {
  const target = inboxId ?? "";
  const statements = [
    bind(V2_ENTITLEMENT_UPSERT_SQL, [claim.entitlementId, claim.productId, claim.environment, claim.status, claim.stateChangedAt, claim.verifiedAt]),
    bind(V2_ENTITLEMENT_DELETE_BINDINGS_SQL, [claim.entitlementId, target, claim.entitlementId, claim.productId, claim.environment, claim.status, claim.stateChangedAt]),
  ];
  if (claim.status === "active" && inboxId !== null) statements.push(bind(V2_ENTITLEMENT_INSERT_BINDING_SQL, [claim.entitlementId, inboxId, claim.verifiedAt, claim.entitlementId, claim.productId, claim.environment, claim.stateChangedAt]));
  return `BEGIN; ${statements.join("; ")}; COMMIT;`;
}

test("D1 schema and statements move one binding, reject stale replay, and retain entitlement after Inbox deletion", () => {
  const directory = mkdtempSync(join(tmpdir(), "bbbbb-v13-entitlement-"));
  const path = join(directory, "entitlement.sqlite3");
  const migration = ["0004_v2_http_sources.sql", "0008_v13_entitlements.sql", "0009_v13_app_store_notifications.sql"]
    .map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(migration, /signed_payload|signed_transaction|original_transaction|app_account_token/iu);
  const claim = active("derived_entitlement_AAAAAAAAAAAAA");
  const revoked = { ...claim, status: "revoked", stateChangedAt: 200, verifiedAt: 210 } as const;
  try {
    const output = execFileSync("sqlite3", [path], {
      encoding: "utf8",
      input: `PRAGMA foreign_keys = ON;
        ${migration}
        INSERT INTO v2_inboxes VALUES ('inbox_entitlement_a', 'public', 'hash', 1);
        INSERT INTO v2_inboxes VALUES ('inbox_entitlement_b', 'public', 'hash', 1);
        ${applySQL(claim, "inbox_entitlement_a")}
        ${applySQL({ ...claim, verifiedAt: 120 }, "inbox_entitlement_b")}
        SELECT inbox_id FROM v2_entitlement_bindings WHERE entitlement_id = '${claim.entitlementId}';
        ${applySQL(revoked, null)}
        ${applySQL({ ...claim, verifiedAt: 220 }, "inbox_entitlement_a")}
        SELECT status || ':' || state_changed_at || ':' || (SELECT COUNT(*) FROM v2_entitlement_bindings) FROM v2_entitlements WHERE entitlement_id = '${claim.entitlementId}';
        DELETE FROM v2_inboxes WHERE inbox_id = 'inbox_entitlement_b';
        SELECT COUNT(*) || ':' || (SELECT COUNT(*) FROM v2_entitlement_bindings) FROM v2_entitlements;
        INSERT OR IGNORE INTO v2_app_store_notifications VALUES ('123e4567-e89b-42d3-a456-426614174001', 'REFUND', 220, 200);
        INSERT OR IGNORE INTO v2_app_store_notifications VALUES ('123e4567-e89b-42d3-a456-426614174001', 'REFUND', 220, 200);
        SELECT COUNT(*) || ':' || MAX(notification_type) FROM v2_app_store_notifications;`,
    }).trim().split("\n");
    assert.deepEqual(output, ["inbox_entitlement_b", "revoked:200:0", "1:0", "1:REFUND"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
