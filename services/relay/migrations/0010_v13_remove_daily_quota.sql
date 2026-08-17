DROP TRIGGER IF EXISTS v2_event_usage_insert_counts;
DROP TRIGGER IF EXISTS v2_event_usage_delete_counts;

CREATE TRIGGER v2_event_usage_insert_counts
AFTER INSERT ON v2_event_usage
BEGIN
  INSERT INTO v2_usage_totals (inbox_id, rolling_count) VALUES (NEW.inbox_id, 1)
    ON CONFLICT(inbox_id) DO UPDATE SET rolling_count = rolling_count + 1;
END;

CREATE TRIGGER v2_event_usage_delete_counts
AFTER DELETE ON v2_event_usage
BEGIN
  UPDATE v2_usage_totals SET rolling_count = rolling_count - 1 WHERE inbox_id = OLD.inbox_id;
END;

DROP TABLE IF EXISTS v2_usage_days;

CREATE INDEX IF NOT EXISTS v2_event_usage_accepted_at
  ON v2_event_usage (accepted_at);

CREATE INDEX IF NOT EXISTS v2_event_usage_retained
  ON v2_event_usage (inbox_id, accepted_at DESC, event_id DESC)
  WHERE envelope_json IS NOT NULL;
