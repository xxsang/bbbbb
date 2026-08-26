CREATE TABLE IF NOT EXISTS v2_entitlement_restore_targets (
  entitlement_id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  FOREIGN KEY (entitlement_id) REFERENCES v2_entitlements(entitlement_id) ON DELETE CASCADE,
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_entitlement_controls (
  inbox_id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('xcode', 'sandbox', 'production')),
  status TEXT NOT NULL CHECK (status = 'suspended'),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 3 AND 64),
  actor_fingerprint TEXT NOT NULL CHECK (length(actor_fingerprint) BETWEEN 16 AND 64),
  changed_at INTEGER NOT NULL CHECK (changed_at >= 0),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > changed_at),
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_entitlement_operation_audit (
  operation_id TEXT PRIMARY KEY CHECK (length(operation_id) = 36),
  action TEXT NOT NULL CHECK (action IN ('suspend', 'resume', 'sandbox_reset')),
  environment TEXT NOT NULL CHECK (environment IN ('xcode', 'sandbox', 'production')),
  target_fingerprint TEXT NOT NULL CHECK (length(target_fingerprint) BETWEEN 16 AND 64),
  actor_fingerprint TEXT NOT NULL CHECK (length(actor_fingerprint) BETWEEN 16 AND 64),
  reason_code TEXT NOT NULL CHECK (length(reason_code) BETWEEN 3 AND 64),
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
  expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > occurred_at)
);

CREATE INDEX IF NOT EXISTS v2_entitlement_operation_audit_occurred
  ON v2_entitlement_operation_audit (occurred_at, operation_id);
