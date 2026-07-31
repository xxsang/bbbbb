CREATE TABLE IF NOT EXISTS v2_source_transfer_sessions (
  session_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  claim_secret_hash TEXT NOT NULL,
  receiver_secret_hash TEXT NOT NULL,
  recipient_public_key TEXT NOT NULL CHECK (length(recipient_public_key) BETWEEN 600 AND 900),
  receiver_label TEXT NOT NULL CHECK (length(receiver_label) BETWEEN 1 AND 48),
  inbox_id TEXT,
  source_id TEXT,
  ciphertext TEXT CHECK (ciphertext IS NULL OR length(ciphertext) BETWEEN 680 AND 700),
  state TEXT NOT NULL CHECK (state IN ('awaiting_approval', 'completed', 'consumed', 'cancelled')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES v2_sources(source_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS v2_source_transfer_sessions_expiry
  ON v2_source_transfer_sessions (expires_at);
