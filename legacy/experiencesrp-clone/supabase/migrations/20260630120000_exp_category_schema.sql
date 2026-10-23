-- Combined-schema storage for AI-generated category definitions.
-- The static EXPERTISE_SCHEMAS map (real_estate_agents) stays the curated gold
-- reference in code; this table holds AI-generated definitions for the other
-- categories, written by the generateCategorySchema server function and read by
-- the Schema tab (which prefers a stored row, else falls back to the static map).

CREATE TABLE IF NOT EXISTS exp_category_schema (
  gcid         text PRIMARY KEY,
  schema_json  jsonb NOT NULL,
  model        text,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exp_category_schema ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read exp_category_schema" ON public.exp_category_schema;
CREATE POLICY "Public read exp_category_schema"
  ON public.exp_category_schema FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Auth write exp_category_schema" ON public.exp_category_schema;
CREATE POLICY "Auth write exp_category_schema"
  ON public.exp_category_schema FOR ALL TO authenticated USING (true) WITH CHECK (true);
