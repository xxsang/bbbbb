# Changelog

## 1.1.0

- Added HTTP and CLI Sources with independent write-only credentials, owner-visible names, lifecycle controls, and generic APNs wake-ups.
- Added RFC 9180 HPKE sealing across Workers, Node, and CryptoKit; retained history is ciphertext-only and bounded to the newest 100 events for at most seven days.
- Added the `bbbbb` CLI commands `setup`, `check`, `send`, and `run`, including owner-only Source profiles and standalone macOS/Linux distributions.
- Added the Add Source web flow, iPhone Source approval and management, adaptive event cards, event detail, recovery states, and notification-denied foreground recovery.
- Established protocol 2 as the wire format. Protocol-1 senders and history are rejected rather than imported, relabeled, or partially rendered.
- Set the iOS marketing version to `1.1` and the wire protocol to `2`.
