ALTER TABLE feeds ADD COLUMN source_fingerprint TEXT;
ALTER TABLE feeds ADD COLUMN radarr_cache TEXT;
ALTER TABLE feeds ADD COLUMN sonarr_cache TEXT;
ALTER TABLE feeds ADD COLUMN cache_updated_at TEXT;
