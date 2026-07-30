ALTER TABLE image_objects ADD COLUMN visual_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_image_objects_visual_hash
  ON image_objects (visual_hash)
  WHERE deleted_at IS NULL AND visual_hash IS NOT NULL;
