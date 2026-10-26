GRANT SELECT ON public.exp_category_profile_config TO anon;
GRANT SELECT ON public.exp_category_profile_config TO authenticated;
GRANT ALL ON public.exp_category_profile_config TO service_role;

ALTER TABLE public.exp_category_profile_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile config is publicly readable" ON public.exp_category_profile_config;
CREATE POLICY "profile config is publicly readable"
ON public.exp_category_profile_config
FOR SELECT
TO anon, authenticated
USING (true);