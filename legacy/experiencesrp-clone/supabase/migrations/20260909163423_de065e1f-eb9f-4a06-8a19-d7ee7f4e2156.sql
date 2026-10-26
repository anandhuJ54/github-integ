GRANT SELECT ON public.exp_voce_article TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_voce_article TO authenticated;
GRANT ALL ON public.exp_voce_article TO service_role;

ALTER TABLE public.exp_voce_article ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voce articles are publicly readable when published"
ON public.exp_voce_article FOR SELECT TO anon, authenticated
USING (published_on IS NOT NULL AND published_on <= CURRENT_DATE);

CREATE POLICY "voce staff read"
ON public.exp_voce_article FOR SELECT TO authenticated
USING (public.exp_ctrl_has_role(ARRAY['super_admin','architect','analyst']));

CREATE POLICY "voce staff write"
ON public.exp_voce_article FOR ALL TO authenticated
USING (public.exp_ctrl_has_role(ARRAY['super_admin','architect']))
WITH CHECK (public.exp_ctrl_has_role(ARRAY['super_admin','architect']));