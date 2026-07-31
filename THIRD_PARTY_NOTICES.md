# Third-Party Notices

The CLI uses the `qrcode` runtime dependency tree to render terminal pairing codes. [`THIRD_PARTY_INVENTORY.json`](THIRD_PARTY_INVENTORY.json) enumerates every production dependency and its package-declared license from the exact lockfile. CI regenerates that inventory and requires a byte-for-byte match.

The current inventory contains only MIT and ISC package declarations, reviewed as compatible with this project's Apache-2.0 license. Any dependency or license change requires a renewed compatibility and redistribution review; package metadata alone must not silently approve a new license.

Apple platform frameworks, Cloudflare Workers tooling, Node.js, TypeScript, and other development tools are not redistributed as source within this repository unless included in a packaged artifact. Their applicable terms continue to govern their use.
