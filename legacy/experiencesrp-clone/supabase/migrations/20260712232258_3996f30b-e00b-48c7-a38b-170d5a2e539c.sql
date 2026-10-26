DROP TABLE IF EXISTS public.exp_category_eap;
CREATE TABLE public.exp_category_eap (
  gcid text PRIMARY KEY REFERENCES public.gbp_categories(gcid),
  annual_transactions numeric NOT NULL,
  eap numeric NOT NULL,
  band text NOT NULL CHECK (band IN ('floor','mid','cap')),
  eap_professional numeric,
  band_professional text,
  confidence text,
  non_posting boolean NOT NULL DEFAULT false,
  method_version text NOT NULL DEFAULT 'posts_v2_ceil20',
  provenance text NOT NULL DEFAULT 'prior'
);
GRANT SELECT ON public.exp_category_eap TO anon, authenticated;
GRANT ALL ON public.exp_category_eap TO service_role;
ALTER TABLE public.exp_category_eap ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read eap" ON public.exp_category_eap FOR SELECT TO anon, authenticated USING (true);