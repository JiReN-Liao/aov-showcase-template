CREATE TABLE IF NOT EXISTS price_fingerprints (
  sha256 TEXT PRIMARY KEY,
  price INTEGER NOT NULL CHECK (price > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_fingerprints_price ON price_fingerprints (price);
