# Self-hosting boundary

The Apache-2.0 core is auditable and may be adapted, but bbbbb V1.1 does not promise supported turnkey self-hosting.

A real deployment must independently own Cloudflare Worker and D1 configuration, migration execution, exact website-origin CORS, APNs token credentials, backup and rollback policy, seven-day/newest-100 retention, abuse controls, monitoring, security updates, and user-facing support/privacy/deletion surfaces.

Never copy the operated service’s account identifiers, APNs credentials, device tokens, deployment manifests, or private owner configuration. Use a separate account, database, hostname, app identifier, and APNs topic.

The checked-in `wrangler.jsonc` is a redacted development shape. Passing a local dry run proves code portability, not production readiness or support eligibility.
