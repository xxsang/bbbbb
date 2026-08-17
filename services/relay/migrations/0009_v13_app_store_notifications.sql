CREATE TABLE IF NOT EXISTS v2_app_store_notifications (
  notification_uuid TEXT PRIMARY KEY CHECK (length(notification_uuid) = 36),
  notification_type TEXT NOT NULL CHECK (length(notification_type) BETWEEN 1 AND 64),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  state_changed_at INTEGER CHECK (state_changed_at IS NULL OR state_changed_at >= 0)
);

CREATE INDEX IF NOT EXISTS v2_app_store_notifications_received
  ON v2_app_store_notifications (received_at, notification_uuid);
