ALTER TABLE public.exp_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_territory_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_territory_brand ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_lead_routing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_sales_quotas ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_territories TO authenticated;
GRANT ALL ON public.exp_territories TO service_role;
GRANT SELECT ON public.exp_territory_rules TO authenticated;
GRANT ALL ON public.exp_territory_rules TO service_role;
GRANT SELECT ON public.exp_territory_brand TO authenticated;
GRANT ALL ON public.exp_territory_brand TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.exp_lead_routing_state TO authenticated;
GRANT ALL ON public.exp_lead_routing_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_sales_quotas TO authenticated;
GRANT ALL ON public.exp_sales_quotas TO service_role;

CREATE POLICY "Staff read exp_territories" ON public.exp_territories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff update exp_territories" ON public.exp_territories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff insert exp_territories" ON public.exp_territories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff read exp_territory_rules" ON public.exp_territory_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff read exp_territory_brand" ON public.exp_territory_brand FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff read exp_lead_routing_state" ON public.exp_lead_routing_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff write exp_lead_routing_state" ON public.exp_lead_routing_state FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update exp_lead_routing_state" ON public.exp_lead_routing_state FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff read exp_sales_quotas" ON public.exp_sales_quotas FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert exp_sales_quotas" ON public.exp_sales_quotas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update exp_sales_quotas" ON public.exp_sales_quotas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION public.exp_generate_territories(text) TO authenticated;