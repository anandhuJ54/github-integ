ALTER TABLE gbp_categories
  ADD COLUMN IF NOT EXISTS estimated_profiles   BIGINT,
  ADD COLUMN IF NOT EXISTS estimated_locations  BIGINT,
  ADD COLUMN IF NOT EXISTS us_relevance         TEXT,
  ADD COLUMN IF NOT EXISTS estimate_confidence  TEXT,
  ADD COLUMN IF NOT EXISTS estimate_source      TEXT,
  ADD COLUMN IF NOT EXISTS estimate_updated_at  TIMESTAMPTZ;