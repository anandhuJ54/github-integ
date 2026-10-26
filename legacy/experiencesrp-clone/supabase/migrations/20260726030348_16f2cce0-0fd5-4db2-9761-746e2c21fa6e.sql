CREATE TABLE IF NOT EXISTS public.exp_schemaorg_types (
  type_id text PRIMARY KEY,
  label text,
  comment text,
  parents text[],
  own_properties jsonb DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS public.exp_schemaorg_properties (
  property_id text PRIMARY KEY,
  label text,
  comment text,
  domain_types text[],
  range_types text[]
);

GRANT SELECT ON public.exp_schemaorg_types TO anon, authenticated;
GRANT SELECT ON public.exp_schemaorg_properties TO anon, authenticated;
GRANT ALL ON public.exp_schemaorg_types TO service_role;
GRANT ALL ON public.exp_schemaorg_properties TO service_role;

ALTER TABLE public.exp_schemaorg_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_schemaorg_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schemaorg types are public reference data"
  ON public.exp_schemaorg_types FOR SELECT USING (true);
CREATE POLICY "schemaorg properties are public reference data"
  ON public.exp_schemaorg_properties FOR SELECT USING (true);

GRANT INSERT, UPDATE, DELETE ON public.exp_schemaorg_types TO sandbox_exec;
GRANT INSERT, UPDATE, DELETE ON public.exp_schemaorg_properties TO sandbox_exec;