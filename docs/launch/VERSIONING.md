# Versioning

## Documentation authority

Every new development version owns a `docs/vX.Y/README.md`. That index names the canonical design or plan, current stage status, evidence, and release boundary for the version. Cross-version root documents route readers and define stable policy only; they do not duplicate version decisions or milestone status.

An older version remains immutable release evidence. A newer version inherits its behavior except where the newer version's canonical documents explicitly change it. Development starts from the target version directory, never from a retired milestone sequence.

Pre-release product decisions do not create customer entitlements or force unreleased features into a later version. Superseded planning is recoverable from Git instead of being repeated in active plans. This does not waive compatibility review for deployed protocol behavior or persisted user data.

Before the first public release, an uploaded but unreleased build creates no customer migration, allowance, or entitlement obligation. A later version may replace that behavior as one clean first-public-release contract. Production or pre-release data is still changed only through an explicit deployment plan; absence of public compatibility debt is not deletion authority.

[`../../release/version.json`](../../release/version.json) is the machine-readable source for product, package, iOS marketing/build, and wire-protocol versions. The iOS build number increases for every uploaded or superseded binary.

Protocol 2 is a clean boundary. A protocol-1 request is rejected, not imported, relabeled, or partially rendered.

Local Inbox features such as search, filters, sorting, and batch management do not by themselves change package, protocol, relay, retention, allowance, or hosted-policy versions. Any release that changes one of those external contracts must update the machine-readable version source and its version-owned documentation together.
