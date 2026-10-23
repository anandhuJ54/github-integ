CREATE TABLE IF NOT EXISTS public.exp_category_schema (
  gcid                 text PRIMARY KEY REFERENCES public.gbp_categories(gcid) ON DELETE CASCADE,
  entity_type          text,
  schema_json          jsonb NOT NULL,
  model                text,
  knowledge_updated_at timestamptz,
  is_launched          boolean NOT NULL DEFAULT false,
  generated_by         uuid,
  reviewed_by          uuid,
  reviewed_at          timestamptz,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.exp_category_schema TO anon, authenticated;
GRANT ALL ON public.exp_category_schema TO service_role;

ALTER TABLE public.exp_category_schema ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read exp_category_schema" ON public.exp_category_schema;
CREATE POLICY "Public read exp_category_schema"
  ON public.exp_category_schema
  FOR SELECT
  TO anon, authenticated
  USING (true);