GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_brand_adoption TO authenticated;
GRANT ALL ON public.exp_brand_adoption TO service_role;
ALTER TABLE public.exp_brand_adoption ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Signed-in users manage brand adoption" ON public.exp_brand_adoption;
CREATE POLICY "Signed-in users manage brand adoption" ON public.exp_brand_adoption
  FOR ALL TO authenticated USING (true) WITH CHECK (true);