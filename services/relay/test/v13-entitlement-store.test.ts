import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { V2_ENTITLEMENT_DELETE_BINDINGS_SQL, V2_ENTITLEMENT_INSERT_BINDING_SQL, V2_ENTITLEMENT_RESTORE_BINDING_SQL, V2_ENTITLEMENT_UPSERT_RESTORE_TARGET_SQL, V2_ENTITLEMENT_UPSERT_SQL } from "../src/v2/d1-source-store.js";
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

test("refund reversal restores the last Inbox and operator controls never rewrite Apple ownership", async () => {
  const store = new MemoryV2SourceStore();
  await store.createInbox(inbox("inbox_entitlement_a"));
  const claim = active("derived_entitlement_AAAAAAAAAAAAA", 100);
  await store.applyEntitlement(claim, "inbox_entitlement_a");
  assert.equal(await store.applyEntitlementNotification(
    "123e4567-e89b-42d3-a456-426614174001",
    "REFUND",
    210,
    { ...claim, status: "revoked", stateChangedAt: 200, verifiedAt: 210 },
  ), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a", 220), "free");
  assert.equal(await store.applyEntitlementNotification(
    "123e4567-e89b-42d3-a456-426614174002",
    "REFUND_REVERSED",
    310,
    { ...claim, status: "active", stateChangedAt: 300, verifiedAt: 310 },
  ), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a", 320), "plus");

  const suspend = {
    operationId: "123e4567-e89b-42d3-a456-426614174003",
    action: "suspend" as const,
    environment: "xcode" as const,
    inboxId: "inbox_entitlement_a",
    targetFingerprint: "target_fingerprint_000000000000",
    actorFingerprint: "actor_fingerprint_0000000000000",
    reasonCode: "abuse_review",
    occurredAt: 330,
    expiresAt: 430,
  };
  assert.equal(await store.applyEntitlementOperation(suspend), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a", 400), "free");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a", 431), "plus");
  assert.equal(store.entitlements.get(claim.entitlementId)?.status, "active");
  assert.equal(await store.applyEntitlementOperation(suspend), "idempotent");
  assert.equal(await store.applyEntitlementOperation({ ...suspend, reasonCode: "different_reason" }), "idempotency_conflict");

  assert.equal(await store.applyEntitlementOperation({
    ...suspend,
    operationId: "123e4567-e89b-42d3-a456-426614174006",
    occurredAt: 500,
    expiresAt: null,
  }), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a", 501), "free");
  assert.equal(await store.applyEntitlementOperation({
    ...suspend,
    operationId: "123e4567-e89b-42d3-a456-426614174007",
    action: "resume",
    reasonCode: "review_complete",
    occurredAt: 510,
    expiresAt: null,
  }), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a", 511), "plus");
  assert.equal(store.entitlementOperationAudit.size, 3);
});

test("Sandbox reset removes only the test binding and restore target", async () => {
  const store = new MemoryV2SourceStore();
  await store.createInbox(inbox("inbox_entitlement_a"));
  const claim = { ...active("derived_entitlement_AAAAAAAAAAAAA"), environment: "sandbox" as const };
  await store.applyEntitlement(claim, "inbox_entitlement_a");
  const reset = {
    operationId: "123e4567-e89b-42d3-a456-426614174004",
    action: "sandbox_reset" as const,
    environment: "sandbox" as const,
    inboxId: "inbox_entitlement_a",
    targetFingerprint: "target_fingerprint_000000000000",
    actorFingerprint: "actor_fingerprint_0000000000000",
    reasonCode: "repeat_purchase_test",
    occurredAt: 200,
    expiresAt: null,
  };
  assert.equal(await store.applyEntitlementOperation(reset), "applied");
  assert.equal(await store.getEntitlementTier("inbox_entitlement_a", 201), "free");
  assert.equal(store.entitlements.get(claim.entitlementId)?.status, "active");
  assert.equal(store.entitlementRestoreTargets.size, 0);
  await assert.rejects(store.applyEntitlementOperation({ ...reset, operationId: "123e4567-e89b-42d3-a456-426614174005", environment: "production" }));
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
  if (claim.status === "active" && inboxId !== null) statements.splice(-1, 0, bind(V2_ENTITLEMENT_UPSERT_RESTORE_TARGET_SQL, [claim.entitlementId, inboxId, claim.verifiedAt, claim.entitlementId, claim.productId, claim.environment, claim.stateChangedAt]));
  return `BEGIN; ${statements.join("; ")}; COMMIT;`;
}

test("D1 schema and statements move one binding, reject stale replay, and retain entitlement after Inbox deletion", () => {
  const directory = mkdtempSync(join(tmpdir(), "bbbbb-v13-entitlement-"));
  const path = join(directory, "entitlement.sqlite3");
  const migration = ["0004_v2_http_sources.sql", "0008_v13_entitlements.sql", "0009_v13_app_store_notifications.sql", "0011_v13_entitlement_operations.sql", "0012_v13_app_store_reconciliation_state.sql"]
    .map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(migration, /signed_payload|signed_transaction|original_transaction|app_account_token/iu);
  const claim = active("derived_entitlement_AAAAAAAAAAAAA");
  const revoked = { ...claim, status: "revoked", stateChangedAt: 200, verifiedAt: 210 } as const;
  const reversed = { ...claim, status: "active", stateChangedAt: 300, verifiedAt: 310 } as const;
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
        ${bind(V2_ENTITLEMENT_UPSERT_SQL, [reversed.entitlementId, reversed.productId, reversed.environment, reversed.status, reversed.stateChangedAt, reversed.verifiedAt])};
        ${bind(V2_ENTITLEMENT_RESTORE_BINDING_SQL, [reversed.verifiedAt, reversed.entitlementId, reversed.productId, reversed.environment, reversed.stateChangedAt])};
        SELECT status || ':' || state_changed_at || ':' || (SELECT inbox_id FROM v2_entitlement_bindings WHERE entitlement_id = '${claim.entitlementId}') FROM v2_entitlements WHERE entitlement_id = '${claim.entitlementId}';
        INSERT INTO v2_entitlement_controls VALUES ('inbox_entitlement_b', 'xcode', 'suspended', 'abuse_review', 'actor_fingerprint_0000000000000', 320, NULL);
        INSERT INTO v2_entitlement_operation_audit VALUES ('123e4567-e89b-42d3-a456-426614174006', 'suspend', 'xcode', 'target_fingerprint_000000000000', 'actor_fingerprint_0000000000000', 'abuse_review', 320, NULL);
        SELECT status || ':' || (SELECT COUNT(*) FROM v2_entitlement_operation_audit) FROM v2_entitlement_controls WHERE inbox_id = 'inbox_entitlement_b';
        DELETE FROM v2_entitlement_controls WHERE inbox_id = 'inbox_entitlement_b' AND environment = 'xcode';
        INSERT INTO v2_entitlement_operation_audit VALUES ('123e4567-e89b-42d3-a456-426614174007', 'resume', 'xcode', 'target_fingerprint_000000000000', 'actor_fingerprint_0000000000000', 'review_complete', 330, NULL);
        SELECT (SELECT COUNT(*) FROM v2_entitlement_controls) || ':' || (SELECT COUNT(*) FROM v2_entitlement_operation_audit);
        DELETE FROM v2_inboxes WHERE inbox_id = 'inbox_entitlement_b';
        SELECT COUNT(*) || ':' || (SELECT COUNT(*) FROM v2_entitlement_bindings) FROM v2_entitlements;
        INSERT OR IGNORE INTO v2_app_store_notifications VALUES ('123e4567-e89b-42d3-a456-426614174001', 'REFUND', 220, 200);
        INSERT OR IGNORE INTO v2_app_store_notifications VALUES ('123e4567-e89b-42d3-a456-426614174001', 'REFUND', 220, 200);
        SELECT COUNT(*) || ':' || MAX(notification_type) FROM v2_app_store_notifications;
        INSERT INTO v2_app_store_reconciliation_state VALUES ('sandbox', 400, 400);
        INSERT INTO v2_app_store_reconciliation_state VALUES ('sandbox', 300, 410)
          ON CONFLICT(environment) DO UPDATE SET checkpoint_at = excluded.checkpoint_at, updated_at = excluded.updated_at
          WHERE excluded.checkpoint_at > v2_app_store_reconciliation_state.checkpoint_at;
        INSERT INTO v2_app_store_reconciliation_state VALUES ('sandbox', 500, 500)
          ON CONFLICT(environment) DO UPDATE SET checkpoint_at = excluded.checkpoint_at, updated_at = excluded.updated_at
          WHERE excluded.checkpoint_at > v2_app_store_reconciliation_state.checkpoint_at;
        SELECT environment || ':' || checkpoint_at || ':' || updated_at FROM v2_app_store_reconciliation_state;`,
    }).trim().split("\n");
    assert.deepEqual(output, ["inbox_entitlement_b", "revoked:200:0", "active:300:inbox_entitlement_b", "suspended:1", "0:2", "1:0", "1:REFUND", "sandbox:500:500"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
