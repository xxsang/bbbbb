# Trust and privacy model

## Authorities

- The iPhone holds inbox read authority and the private HPKE key.
- An HTTP Source URL has write authority for exactly one Source.
- A CLI profile has the inbox public key and independent write authority for exactly one Source.
- No Source can read, decrypt, delete, or manage inbox history.

## Content boundary

CLI content is encrypted before transmission. HTTP content exists only inside the request-handling Worker until it is normalized and sealed; it is never stored or logged in plaintext. D1 retains only encrypted protocol-2 envelopes within the active tier's recovery window: the newest 100 for up to seven days on Free, or the newest 500 for up to 30 days on Plus.

Authenticated metadata binds protocol version, inbox, Source, event, and HPKE suite. Relabeling or ciphertext tampering fails decryption. Idempotent retries reuse one event identity.

## Observable metadata

The operated relay and Cloudflare can observe request timing, IP/network metadata, identifiers, ciphertext sizes, counts, retention timestamps, and bounded rate-limit state. During a five-minute existing-Source access move, the relay also sees a destination label and public key, hashes of temporary proof, and the replacement ciphertext. It never receives the destination private key or retains the plaintext Source URL. Apple processes the device token and generic alert. Notifications contain no event category, label, work, message, or details.

## Recovery and revocation

A missed or denied notification does not lose a retained accepted update; foreground/manual synchronization recovers it. Deleting an update removes it immediately from the active inbox and export, while a recovery copy remains only on the iPhone under **Settings → Recently Deleted** for up to 30 days unless restored or permanently deleted. Offline catch-up never restores a locally deleted update. **Move sending access** and credential replacement invalidate the old private link. Disabling or deleting a Source stops new writes without rewriting retained history. Losing the iPhone private key makes retained ciphertext unrecoverable.
