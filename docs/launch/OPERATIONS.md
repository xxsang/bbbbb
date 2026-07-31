# Operated-service requirements

## Release provenance

Every deployment records the exact source revision, canonical Worker bundle SHA-256, migration-set SHA-256, deployment-manifest SHA-256, D1 recovery point, and resulting Worker version. `/health` must report protocol 2 and the exact three provenance values or fail closed.

## Data and retention

Apply `0004_v2_http_sources.sql`, `0005_v2_cli_sources.sql`, and `0006_v2_source_transfers.sql` to a clean database. Protocol-1 migrations are historical and are not part of a clean V1.1 installation. Inspect aggregates and schema only; never dump full envelopes, credentials, device tokens, or submitted content into evidence.

The service retains encrypted updates for at most seven days and the newest 100 per inbox. Credential hashes, Source state, five-minute setup sessions, transient receiver public keys and Source-transfer ciphertext, device registration, and bounded abuse-control counters are the only additional durable protocol-2 state.

## Alerts and recovery

APNs secrets are installed through the platform secret store and never committed or printed. Event acceptance does not depend on APNs success. Invalid tokens disable only the matching registration; the iPhone still recovers retained updates on launch, foreground, or manual refresh.

## Incidents and rollback

Classify failures with fixed secret-safe event names. Roll back only to a reviewed protocol-2 revision. Do not enable protocol-1 routes, reinterpret ciphertext, or restore removed credentials. Cleanup of synthetic test rows must target explicit test identifiers and finish with aggregate-zero evidence.
