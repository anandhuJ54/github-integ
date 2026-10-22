GRANT SELECT, INSERT, UPDATE ON public.exp_products TO authenticated;
GRANT ALL ON public.exp_products TO service_role;
CREATE POLICY "Staff insert products" ON public.exp_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update products" ON public.exp_products FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON public.exp_pricing_config TO authenticated;
GRANT ALL ON public.exp_pricing_config TO service_role;
ALTER TABLE public.exp_pricing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read pricing config" ON public.exp_pricing_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff update pricing config" ON public.exp_pricing_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);