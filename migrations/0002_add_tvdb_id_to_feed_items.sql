ALTER TABLE feed_items ADD COLUMN tvdb_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_feed_items_feed_tvdb
  ON feed_items (feed_id, tvdb_id);
