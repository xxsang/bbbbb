CREATE TABLE IF NOT EXISTS v2_entitlements (
  entitlement_id TEXT PRIMARY KEY CHECK (length(entitlement_id) BETWEEN 32 AND 128),
  product_id TEXT NOT NULL CHECK (product_id = 'org.shenren.bbbbb.plus'),
  environment TEXT NOT NULL CHECK (environment IN ('xcode', 'sandbox', 'production')),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  state_changed_at INTEGER NOT NULL CHECK (state_changed_at >= 0),
  verified_at INTEGER NOT NULL CHECK (verified_at >= state_changed_at)
);

CREATE TABLE IF NOT EXISTS v2_entitlement_bindings (
  entitlement_id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL UNIQUE,
  bound_at INTEGER NOT NULL CHECK (bound_at >= 0),
  FOREIGN KEY (entitlement_id) REFERENCES v2_entitlements(entitlement_id) ON DELETE CASCADE,
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS v2_entitlement_bindings_inbox
  ON v2_entitlement_bindings (inbox_id, entitlement_id);
