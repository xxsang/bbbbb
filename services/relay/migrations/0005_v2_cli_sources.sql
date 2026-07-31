ALTER TABLE v2_add_source_sessions
  ADD COLUMN method TEXT NOT NULL DEFAULT 'http'
  CHECK (method IN ('http', 'cli'));
