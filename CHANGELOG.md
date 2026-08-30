# Changelog

## 1.4.0

- Made the first Source open the recommended coding-agent setup directly and clarified later Add Source choices for coding agents, apps, and automations.
- Added the agent-readable `bbbbb.app/setup` path with one temporary QR approval and six-digit fallback, automatic generic Source naming, private storage, and an accepted setup test before optional CLI expansion.
- Simplified Source approval, added consistent back and close navigation, and clarified when setup must finish on the computer.
- Recovered notification education and APNs registration after reinstall restores an existing Keychain Inbox, with visible recovery actions while notifications remain off.
- Added a user-initiated **Rate or review bbbbb** action and one best-effort standard StoreKit review request after an earned value moment.
- Kept Plus pricing, limits, purchase, restore, privacy, and retention behavior unchanged.

## 1.3.0

- Added aggregate per-Inbox rolling allowances: 1,000 accepted updates on Free and 10,000 on Plus in any 30-day period, with no daily customer quota and a shared 20-submission-per-minute safety limit.
- Added relay-owned usage snapshots, bounded multi-page Offline catch-up, and Free/Plus retention of newest 100 for seven days or newest 500 for 30 days.
- Added independently verified non-consumable Plus entitlements, accountless restore binding, and signed App Store refund and revocation handling.
- Added current requester-first Source connection and one-use encrypted movement of an existing Source's sending access.
- Added a deterministic public credential scan and tightened the export boundary around deployment identifiers, credentials, private paths, and development-only benchmark artifacts.

## 1.1.0

- Added HTTP and CLI Sources with independent write-only credentials, owner-visible names, lifecycle controls, and generic APNs wake-ups.
- Added RFC 9180 HPKE sealing across Workers, Node, and CryptoKit; retained history is ciphertext-only and bounded to the newest 100 events for at most seven days.
- Added the `bbbbb` CLI commands `setup`, `check`, `send`, and `run`, including owner-only Source profiles and standalone macOS/Linux distributions.
- Added the Add Source web flow, iPhone Source approval and management, adaptive event cards, event detail, recovery states, and notification-denied foreground recovery.
- Established protocol 2 as the wire format. Protocol-1 senders and history are rejected rather than imported, relabeled, or partially rendered.
- Set the iOS marketing version to `1.1` and the wire protocol to `2`.
