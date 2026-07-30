PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sync_items (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('line', 'facebook', 'mobile', 'local')),
  content_hash TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL DEFAULT '',
  local_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_items_supplier_active
  ON sync_items (supplier_id, updated_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sync_items_local_pending
  ON sync_items (origin, local_synced_at)
  WHERE deleted_at IS NULL;
