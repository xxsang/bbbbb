# bbbbb Relay

This package contains the protocol-2 Cloudflare Worker source, D1 migrations, and secret-free Wrangler configuration for the encrypted bbbbb relay. It cannot decrypt retained Completion Events. It enforces aggregate Inbox rolling-30-day allowance, fixed-minute abuse/burst, and offline-catch-up retention boundaries and exposes usage only to Inbox read authority. There is no daily customer quota. Operators must create their own Cloudflare resources and APNs credentials; no credential, account identifier, `.dev.vars` file, or deployed owner topology is included.

Plus ownership remains canonical to verified StoreKit transactions and App Store Server Notifications. The relay also supports missed-notification reconciliation, audited service suspension/resume, and a Sandbox-only binding reset for repeat purchase testing; the reset is structurally unavailable for Production. See the public-core self-hosting, operations, privacy, and upgrade guides before deployment.
