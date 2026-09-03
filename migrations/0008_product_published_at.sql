ALTER TABLE products ADD COLUMN published_at TEXT;

UPDATE products
SET published_at = created_at
WHERE status = 'available' AND deleted_at IS NULL AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_public_published
  ON products (status, published_at DESC)
  WHERE deleted_at IS NULL;
