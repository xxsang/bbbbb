# Protocol 2 API

All bodies are bounded and all successful retained events are protocol-2 HPKE envelopes. Responses use `Cache-Control: no-store`.

## Add Source

- `POST /v2/add-source/sessions` creates a five-minute HTTP Source session.
- `POST /v2/cli-sources/sessions` creates a separate five-minute CLI Source session.
- `POST /v2/add-source/claims` claims a six-digit same-phone code with inbox authority.
- `POST /v2/add-source/sessions/{id}/claim` claims a QR session.
- `POST /v2/add-source/sessions/{id}/approve` approves it from the iPhone.
- `GET /v2/add-source/sessions/{id}` lets the setup surface poll and consume its one-time HTTP URL or CLI profile.

Permanent Source credentials never appear in the QR or same-phone code. Stored credentials are hashes only.

## Source credential transfer

- `POST /v2/source-transfers/sessions` registers a receiver-generated RSA-OAEP 4096 public key and creates a five-minute transfer.
- `POST /v2/source-transfers/claims` claims its six-digit code with inbox authority.
- `POST /v2/source-transfers/sessions/{id}/claim` claims its QR link without sending inbox authority.
- `POST /v2/source-transfers/sessions/{id}/complete` authenticates the inbox, rotates the selected HTTP Source credential, and stores only the replacement URL encrypted to the receiver.
- `GET /v2/source-transfers/sessions/{id}` authenticates the receiver, consumes the ciphertext once, and then makes the session unavailable.
- `DELETE /v2/source-transfers/sessions/{id}` cancels only a transfer that has not completed.

The pairing link and code contain only short-lived session proof. They never contain the permanent Source URL. The relay stores the receiver public key, hashes of temporary secrets, and ciphertext; the receiver private key stays on the receiving device.

## HTTP Source write

`POST /v2/sources/{sourceId}/events?key={writeCredential}` accepts an empty body, form data, or bounded JSON. The Worker canonicalizes and seals it before durable storage. `Idempotency-Key` prevents duplicate cards.

Accepted sender fields are `category` (`activity` or `attention`), optional `label`, optional `work`, optional `message`, and bounded scalar `details`. The sender chooses when to create an event. Empty input becomes `Activity · Update`.

## CLI Source write

The same route accepts `Authorization: Bearer {writeCredential}`. A CLI Source must send a validated sealed protocol-2 envelope; plaintext event fields are rejected.

The write credential receives `401` from inbox-history routes and cannot decrypt retained events.

Every authenticated submission attempt shares one Inbox-level fixed-minute burst allowance. Unique accepted events also share the Inbox's rolling-30-day allowance across every Source. A rejected sender receives `429`, `Retry-After`, and only `inbox_quota_exceeded`, the bounded scope (`burst` or `rolling_30_days`), and `retryAt`; Inbox counts, tier, limits, and Source metadata are not disclosed.

## Inbox and Source management

Inbox read authority is required for:

- `GET /v2/inboxes/{inboxId}/events`
- `GET /v2/inboxes/{inboxId}/usage`
- `POST /v2/inboxes/{inboxId}/entitlement/verify`
- `GET /v2/inboxes/{inboxId}/sources`
- `PATCH /v2/inboxes/{inboxId}/sources/{sourceId}`
- `POST /v2/inboxes/{inboxId}/sources/{sourceId}/test`
- `POST /v2/inboxes/{inboxId}/sources/{sourceId}/credential`
- `DELETE /v2/inboxes/{inboxId}/sources/{sourceId}`
- `PUT` or `DELETE /v2/inboxes/{inboxId}/device`

Protocol-1 and retired trigger routes return `404`; they are not migration surfaces.

The usage response identifies `free` or `plus`, the rolling-30-day count and limit, the shared burst ceiling, and the active Offline catch-up boundaries. It is server-owned metadata, never part of an event envelope or APNs payload.

The entitlement verification route accepts only the bounded protocol-2 signed-transaction request. The relay verifies the StoreKit JWS independently, persists the resulting accountless binding, and returns only `free` or `plus`. It never accepts a client-owned paid flag or exposes Apple transaction, account-token, or derived entitlement identifiers. Responses and telemetry discard the signed payload and use `Cache-Control: no-store`.

## App Store lifecycle notifications

`POST /v2/app-store/notifications` is the public App Store Server Notifications V2 receiver. It accepts only Apple's bounded `{ "signedPayload": "..." }` body, verifies the outer notification and any relevant inner transaction before mutation, and returns an empty no-store response. Verified refund and revoke notifications remove the active binding; unrelated verified notification types are deduplicated and ignored. The relay retains only bounded notification metadata for replay control, never the signed payload or Apple transaction/account identifiers.
