CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL,
  list_title TEXT,
  list_author TEXT,
  list_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  item_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_synced_at TEXT,
  last_source_modified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS feed_items (
  feed_id INTEGER NOT NULL,
  imdb_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,
  title_type TEXT,
  added_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (feed_id, imdb_id),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feed_items_feed_position
  ON feed_items (feed_id, position);

CREATE INDEX IF NOT EXISTS idx_feeds_last_synced_at
  ON feeds (last_synced_at);
