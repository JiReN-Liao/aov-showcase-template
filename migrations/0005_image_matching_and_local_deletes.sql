ALTER TABLE image_objects ADD COLUMN content_hash TEXT;
ALTER TABLE sync_items ADD COLUMN local_deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_image_objects_content_hash
  ON image_objects (content_hash)
  WHERE deleted_at IS NULL AND content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sync_items_pending_local_delete
  ON sync_items (deleted_at, local_deleted_at)
  WHERE deleted_at IS NOT NULL AND local_deleted_at IS NULL;
