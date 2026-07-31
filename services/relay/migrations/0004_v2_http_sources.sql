CREATE TABLE IF NOT EXISTS v2_inboxes (
  inbox_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  read_credential_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_sources (
  source_id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  method TEXT NOT NULL CHECK (method IN ('http', 'cli')),
  credential_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_success_at INTEGER,
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS v2_sources_inbox_created
  ON v2_sources (inbox_id, created_at, source_id);

CREATE TABLE IF NOT EXISTS v2_devices (
  inbox_id TEXT PRIMARY KEY,
  device_token TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  updated_at INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_events (
  inbox_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  envelope_json TEXT NOT NULL CHECK (length(envelope_json) <= 24576),
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (inbox_id, event_id),
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES v2_sources(source_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS v2_events_inbox_accepted
  ON v2_events (inbox_id, accepted_at, event_id);

CREATE TABLE IF NOT EXISTS v2_add_source_sessions (
  session_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  claim_secret_hash TEXT NOT NULL,
  setup_secret_hash TEXT NOT NULL,
  source_name TEXT NOT NULL CHECK (length(source_name) BETWEEN 1 AND 80),
  inbox_id TEXT,
  source_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('awaiting_approval', 'approved', 'consumed', 'cancelled')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS v2_add_source_sessions_expiry
  ON v2_add_source_sessions (expires_at);

CREATE TABLE IF NOT EXISTS v2_rate_limits (
  scope TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (scope, window_start)
);
