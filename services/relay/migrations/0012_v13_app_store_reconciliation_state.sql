CREATE TABLE IF NOT EXISTS v2_app_store_reconciliation_state (
  environment TEXT PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  checkpoint_at INTEGER NOT NULL CHECK (checkpoint_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= checkpoint_at)
);
