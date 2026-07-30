CREATE TABLE IF NOT EXISTS price_styles (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  label TEXT NOT NULL,
  signature_json TEXT NOT NULL DEFAULT '{}',
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE price_fingerprints ADD COLUMN supplier_id TEXT;
ALTER TABLE price_fingerprints ADD COLUMN style_id TEXT REFERENCES price_styles(id);

CREATE INDEX IF NOT EXISTS idx_price_styles_supplier
  ON price_styles (supplier_id, id);

CREATE INDEX IF NOT EXISTS idx_price_fingerprints_style
  ON price_fingerprints (supplier_id, style_id);
