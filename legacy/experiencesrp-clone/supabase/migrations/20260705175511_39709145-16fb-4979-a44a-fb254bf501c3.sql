CREATE TABLE IF NOT EXISTS exp_category_schema_type (
  gcid        text PRIMARY KEY,
  schema_type text,
  confidence  text,
  rule        text
);
GRANT SELECT ON public.exp_category_schema_type TO authenticated;
GRANT SELECT ON public.exp_category_schema_type TO anon;
GRANT ALL ON public.exp_category_schema_type TO service_role;
ALTER TABLE public.exp_category_schema_type ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "cst readable" ON exp_category_schema_type FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;