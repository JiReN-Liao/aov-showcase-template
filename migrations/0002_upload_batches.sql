PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS upload_batches (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_by TEXT NOT NULL REFERENCES admin_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_batches_owner_created ON upload_batches (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS aov_sequences (
  name TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL CHECK (next_value > 0)
);

INSERT OR IGNORE INTO aov_sequences (name, next_value)
VALUES ('product', 1);

UPDATE aov_sequences
SET next_value = MAX(
  next_value,
  COALESCE((
    SELECT MAX(CAST(SUBSTR(code, 5) AS INTEGER)) + 1
    FROM products
    WHERE code GLOB 'AOV-[0-9]*'
  ), 1)
)
WHERE name = 'product';

ALTER TABLE image_objects ADD COLUMN batch_id TEXT REFERENCES upload_batches(id);
ALTER TABLE image_objects ADD COLUMN batch_item_id TEXT;
ALTER TABLE image_objects ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'ready' CHECK (upload_status IN ('pending', 'ready', 'failed'));
ALTER TABLE image_objects ADD COLUMN upload_error TEXT;
ALTER TABLE image_objects ADD COLUMN uploaded_at TEXT;
ALTER TABLE image_objects ADD COLUMN failed_at TEXT;
ALTER TABLE image_objects ADD COLUMN updated_at TEXT;

UPDATE image_objects
SET uploaded_at = COALESCE(uploaded_at, created_at),
    updated_at = COALESCE(updated_at, created_at)
WHERE upload_status = 'ready';

CREATE UNIQUE INDEX IF NOT EXISTS idx_image_objects_batch_item
  ON image_objects (batch_id, batch_item_id)
  WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_image_objects_batch_status
  ON image_objects (batch_id, upload_status)
  WHERE deleted_at IS NULL;
