-- Listings tables DDL (from 20260709010000_listings_tables.sql) + required GRANTs
CREATE TABLE IF NOT EXISTS public.exp_listings_publishers (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, api_notes text, publishes_to text, ops_notes jsonb
);
CREATE TABLE IF NOT EXISTS public.exp_listings_field_map (
  id serial PRIMARY KEY, publisher_id text REFERENCES public.exp_listings_publishers(id),
  section text NOT NULL, section_note text, their_field text NOT NULL, our_target text NOT NULL,
  rules text, applicability text NOT NULL DEFAULT 'base',
  status_default text NOT NULL DEFAULT 'mapped', variant_family text, sort int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS public.exp_listings_crosswalk (
  gcid text NOT NULL, publisher_id text NOT NULL, code text NOT NULL, label text,
  breadcrumb text, confidence text, verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (gcid, publisher_id)
);
CREATE TABLE IF NOT EXISTS public.exp_listings_category_status (
  gcid text NOT NULL, family text NOT NULL, present boolean NOT NULL, PRIMARY KEY (gcid, family)
);
CREATE TABLE IF NOT EXISTS public.exp_listings_overlays (
  gcid text NOT NULL, overlay text NOT NULL, PRIMARY KEY (gcid, overlay)
);

GRANT SELECT ON public.exp_listings_publishers TO anon, authenticated;
GRANT ALL ON public.exp_listings_publishers TO service_role;
GRANT SELECT ON public.exp_listings_field_map TO anon, authenticated;
GRANT ALL ON public.exp_listings_field_map TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.exp_listings_field_map_id_seq TO service_role;
GRANT SELECT ON public.exp_listings_crosswalk TO anon, authenticated;
GRANT ALL ON public.exp_listings_crosswalk TO service_role;
GRANT SELECT ON public.exp_listings_category_status TO anon, authenticated;
GRANT ALL ON public.exp_listings_category_status TO service_role;
GRANT SELECT ON public.exp_listings_overlays TO anon, authenticated;
GRANT ALL ON public.exp_listings_overlays TO service_role;

ALTER TABLE public.exp_listings_publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_listings_field_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_listings_crosswalk ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_listings_category_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_listings_overlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read listings publishers" ON public.exp_listings_publishers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings field map" ON public.exp_listings_field_map FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings crosswalk" ON public.exp_listings_crosswalk FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings category status" ON public.exp_listings_category_status FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings overlays" ON public.exp_listings_overlays FOR SELECT TO anon, authenticated USING (true);