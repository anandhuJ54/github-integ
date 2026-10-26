-- EAR
CREATE TABLE IF NOT EXISTS public.exp_category_ear (
  gcid text PRIMARY KEY REFERENCES public.gbp_categories(gcid),
  annual_transactions numeric NOT NULL,
  ear numeric NOT NULL,
  band text NOT NULL CHECK (band IN ('floor','mid','cap')),
  ear_professional numeric,
  band_professional text,
  confidence text,
  non_reviewable boolean NOT NULL DEFAULT false,
  method_version text NOT NULL DEFAULT 'reviews_v2_simplified',
  provenance text NOT NULL DEFAULT 'prior'
);
GRANT SELECT ON public.exp_category_ear TO anon, authenticated;
GRANT ALL ON public.exp_category_ear TO service_role;
ALTER TABLE public.exp_category_ear ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ear" ON public.exp_category_ear FOR SELECT TO anon, authenticated USING (true);

-- EAA
CREATE TABLE IF NOT EXISTS public.exp_category_eaa (
  gcid text PRIMARY KEY REFERENCES public.gbp_categories(gcid),
  annual_transactions numeric NOT NULL,
  eaa numeric NOT NULL,
  band text NOT NULL CHECK (band IN ('floor','mid','cap')),
  eaa_professional numeric,
  band_professional text,
  confidence text,
  non_authored boolean NOT NULL DEFAULT false,
  method_version text NOT NULL DEFAULT 'articles_v1_standalone',
  provenance text NOT NULL DEFAULT 'prior'
);
GRANT SELECT ON public.exp_category_eaa TO anon, authenticated;
GRANT ALL ON public.exp_category_eaa TO service_role;
ALTER TABLE public.exp_category_eaa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read eaa" ON public.exp_category_eaa FOR SELECT TO anon, authenticated USING (true);

-- COMPLETENESS
CREATE TABLE IF NOT EXISTS public.exp_category_completeness (
  gcid text PRIMARY KEY REFERENCES public.gbp_categories(gcid),
  total_node_types int NOT NULL,
  core_node_types int NOT NULL,
  expected_m numeric NOT NULL,
  method_version text NOT NULL DEFAULT 'completeness_v1',
  provenance text NOT NULL DEFAULT 'prior'
);
GRANT SELECT ON public.exp_category_completeness TO anon, authenticated;
GRANT ALL ON public.exp_category_completeness TO service_role;
ALTER TABLE public.exp_category_completeness ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read completeness" ON public.exp_category_completeness FOR SELECT TO anon, authenticated USING (true);

-- EAV
CREATE TABLE IF NOT EXISTS public.exp_category_eav (
  gcid text PRIMARY KEY REFERENCES public.gbp_categories(gcid),
  annual_transactions numeric NOT NULL,
  eav numeric NOT NULL,
  band text NOT NULL CHECK (band IN ('floor','mid','cap')),
  eav_professional numeric,
  band_professional text,
  confidence text,
  non_video boolean NOT NULL DEFAULT false,
  method_version text NOT NULL DEFAULT 'videos_v1',
  provenance text NOT NULL DEFAULT 'prior'
);
GRANT SELECT ON public.exp_category_eav TO anon, authenticated;
GRANT ALL ON public.exp_category_eav TO service_role;
ALTER TABLE public.exp_category_eav ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read eav" ON public.exp_category_eav FOR SELECT TO anon, authenticated USING (true);

-- EAQ
CREATE TABLE IF NOT EXISTS public.exp_category_eaq (
  gcid text PRIMARY KEY REFERENCES public.gbp_categories(gcid),
  annual_transactions numeric NOT NULL,
  eaq numeric NOT NULL,
  band text NOT NULL CHECK (band IN ('floor','mid','cap')),
  eaq_professional numeric,
  band_professional text,
  confidence text,
  non_qa boolean NOT NULL DEFAULT false,
  method_version text NOT NULL DEFAULT 'qa_v1',
  provenance text NOT NULL DEFAULT 'prior'
);
GRANT SELECT ON public.exp_category_eaq TO anon, authenticated;
GRANT ALL ON public.exp_category_eaq TO service_role;
ALTER TABLE public.exp_category_eaq ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read eaq" ON public.exp_category_eaq FOR SELECT TO anon, authenticated USING (true);