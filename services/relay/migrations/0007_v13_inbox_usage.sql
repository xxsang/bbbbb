CREATE TABLE IF NOT EXISTS v2_event_usage (
  inbox_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  envelope_json TEXT CHECK (envelope_json IS NULL OR length(envelope_json) <= 24576),
  PRIMARY KEY (inbox_id, event_id),
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS v2_event_usage_inbox_accepted
  ON v2_event_usage (inbox_id, accepted_at, event_id);

CREATE TABLE IF NOT EXISTS v2_usage_totals (
  inbox_id TEXT PRIMARY KEY,
  rolling_count INTEGER NOT NULL DEFAULT 0 CHECK (rolling_count >= 0),
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_usage_days (
  inbox_id TEXT NOT NULL,
  day_start INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  PRIMARY KEY (inbox_id, day_start),
  FOREIGN KEY (inbox_id) REFERENCES v2_inboxes(inbox_id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS v2_event_usage_insert_counts
AFTER INSERT ON v2_event_usage
BEGIN
  INSERT INTO v2_usage_totals (inbox_id, rolling_count) VALUES (NEW.inbox_id, 1)
    ON CONFLICT(inbox_id) DO UPDATE SET rolling_count = rolling_count + 1;
  INSERT INTO v2_usage_days (inbox_id, day_start, accepted_count)
    VALUES (NEW.inbox_id, (NEW.accepted_at / 86400000) * 86400000, 1)
    ON CONFLICT(inbox_id, day_start) DO UPDATE SET accepted_count = accepted_count + 1;
END;

CREATE TRIGGER IF NOT EXISTS v2_event_usage_delete_counts
AFTER DELETE ON v2_event_usage
BEGIN
  UPDATE v2_usage_totals SET rolling_count = rolling_count - 1 WHERE inbox_id = OLD.inbox_id;
  UPDATE v2_usage_days SET accepted_count = accepted_count - 1
    WHERE inbox_id = OLD.inbox_id AND day_start = (OLD.accepted_at / 86400000) * 86400000;
  DELETE FROM v2_usage_days WHERE inbox_id = OLD.inbox_id AND accepted_count = 0;
END;

INSERT OR IGNORE INTO v2_event_usage (inbox_id, event_id, source_id, accepted_at, envelope_json)
  SELECT inbox_id, event_id, source_id, accepted_at, envelope_json FROM v2_events;
