ALTER TABLE public.exp_sales_rep_verticals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read exp_sales_rep_verticals" ON public.exp_sales_rep_verticals
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert exp_sales_rep_verticals" ON public.exp_sales_rep_verticals
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update exp_sales_rep_verticals" ON public.exp_sales_rep_verticals
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff delete exp_sales_rep_verticals" ON public.exp_sales_rep_verticals
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "Staff insert exp_territory_brand" ON public.exp_territory_brand
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update exp_territory_brand" ON public.exp_territory_brand
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff delete exp_territory_brand" ON public.exp_territory_brand
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "Staff delete exp_sales_quotas" ON public.exp_sales_quotas
  FOR DELETE TO authenticated USING (true);