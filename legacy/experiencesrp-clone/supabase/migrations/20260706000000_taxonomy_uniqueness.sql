-- NO-DUPLICATES enforcement: one term per level per category (global rows: per level).
-- Cleans any existing dupes first (keeps oldest), then constrains forever.
DELETE FROM exp_taxonomy a USING exp_taxonomy b
WHERE a.id > b.id AND a.level = b.level AND a.term_slug = b.term_slug
  AND coalesce(a.gcid,'__global__') = coalesce(b.gcid,'__global__');
CREATE UNIQUE INDEX IF NOT EXISTS uq_taxonomy_term
  ON exp_taxonomy (coalesce(gcid,'__global__'), level, term_slug);
