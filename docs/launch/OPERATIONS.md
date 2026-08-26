# Operated-service requirements

## Release provenance

Every deployment records the exact source revision, canonical Worker bundle SHA-256, migration-set SHA-256, deployment-manifest SHA-256, D1 recovery point, and resulting Worker version. `/health` must report protocol 2 and the exact three provenance values or fail closed.

## Data and retention

Apply `0004_v2_http_sources.sql`, `0005_v2_cli_sources.sql`, `0006_v2_source_transfers.sql`, `0007_v13_inbox_usage.sql`, `0008_v13_entitlements.sql`, `0009_v13_app_store_notifications.sql`, `0010_v13_remove_daily_quota.sql`, `0011_v13_entitlement_operations.sql`, and `0012_v13_app_store_reconciliation_state.sql` to a clean database. Protocol-1 migrations are historical and are not part of a clean first-release installation. Inspect aggregates and schema only; never dump full envelopes, credentials, device tokens, StoreKit payloads, entitlement identifiers, notification UUIDs, Inbox identifiers, or submitted content into evidence.

The service retains encrypted updates according to the relay-owned tier policy: newest 100 for at most seven days on Free and newest 500 for at most 30 days on Plus. Credential hashes, Source state, five-minute setup sessions, transient receiver public keys and Source-transfer ciphertext, device registration, aggregate quota accounting, derived entitlement/binding/restore-target state, bounded App Store notification deduplication metadata, one timestamp-only reconciliation checkpoint per Apple environment, current service-suspension state, fingerprint-only bounded operator audit records, and bounded abuse-control counters are the only additional durable protocol-2 state.

## Plus lifecycle and operator control

Apple-signed transaction state owns purchase entitlement. `REFUND` and `REVOKE` remove hosted Plus; `REFUND_REVERSED` reinstates the last still-existing Inbox binding. Every six hours, reconciliation resumes from an independent durable Production or Sandbox checkpoint with a 12-hour overlap. The first successful run covers Apple's available history window: up to 180 days in Production and 30 days in Sandbox. It verifies each notification JWS through the same production verifier, then uses each affected transaction only in memory to request Transaction History V2 and reconcile the latest verified non-consumable state. Only after the entire environment succeeds does its checkpoint advance, and one unavailable Apple environment never blocks the other environment. The service retains neither notification-history payloads nor Apple transaction identifiers. Repeated pages and overlap are idempotent; a failure is retryable, does not advance that environment's checkpoint, emits a fixed environment-count alert, and must never infer Free from an outage.

Operator control is a separate hosted-service policy. `suspend` temporarily resolves the targeted Inbox to Free without changing the verified Apple entitlement; `resume` removes that control. `sandbox-reset` removes only a Sandbox binding and its restore target so the same test Inbox can repeat a first-purchase journey after Apple purchase history is cleared. The Worker rejects `sandbox-reset` for every non-Sandbox target, authenticates the operation with its dedicated secret, requires an idempotency key and bounded reason code, and writes a fingerprint-only audit row. Never use an operator control as a substitute for an Apple refund, and never describe a suspension as cancellation of the customer's purchase.

On the operator Mac, keep the operations key in macOS Keychain. This persists across terminals and Codex sessions; changing sessions does not require rotating or re-entering the key. Add or replace it from an interactive prompt so the value does not enter shell history:

```sh
security add-generic-password -U -a "$USER" -s bbbbb-entitlement-operations-production -w
```

The repository wrapper first honors an explicitly injected `BBBBB_ENTITLEMENT_OPERATIONS_KEY` for controlled automation. Otherwise, on macOS it reads the item above for the current account and passes the key to the reviewed Node helper only through the child-process environment. It never writes or prints the key. Do not keep this secret in the repository, including a gitignored file; the repository contains only the lookup convention.

Invoke the wrapper only with an exact private Inbox identifier. The underlying helper never prints the target or token:

```sh
npm run operate:entitlement -- <relay-origin> suspend <sandbox|production> <private-inbox-id> <reason-code> [expires-at]
npm run operate:entitlement -- <relay-origin> resume <sandbox|production> <private-inbox-id> <reason-code>
npm run operate:entitlement -- <relay-origin> sandbox-reset sandbox <private-test-inbox-id> repeat_purchase_test
```

Verify presence without exposing the value:

```sh
security find-generic-password -a "$USER" -s bbbbb-entitlement-operations-production >/dev/null
```

Rotate the Keychain item and the matching Worker secret only if the key is compromised or as part of an intentional credential-rotation procedure—not when opening another Codex session.

For a repeated first-purchase test, run the Sandbox reset, clear the Sandbox Apple Account purchase history, sign out and back in to clear Apple's device cache, force-quit the installed Sandbox app, and relaunch. For restore testing, do not clear Apple purchase history: use a new/disposable Inbox and tap **Restore Purchase**. Production reset is intentionally unavailable.

## Alerts and recovery

APNs secrets are installed through the platform secret store and never committed or printed. Event acceptance does not depend on APNs success. Invalid tokens disable only the matching registration; the iPhone still recovers retained updates on launch, foreground, or manual refresh.

## Incidents and rollback

Classify failures with fixed secret-safe event names. Roll back only to a reviewed protocol-2 revision. Entitlement rollback is forward-only: retain migrations and D1 state, disable new transaction/notification verification by withholding verifier configuration in the reviewed rollback revision, and continue resolving existing active bindings. Never down-migrate or delete entitlement rows to roll back. Restore verification only after its Worker dry-run, signed fixtures, reconciliation test, operator-control test, and synthetic state checks pass. Do not enable protocol-1 routes, reinterpret ciphertext, or restore removed credentials. Cleanup of synthetic test rows must target explicit test identifiers and finish with aggregate-zero evidence.
