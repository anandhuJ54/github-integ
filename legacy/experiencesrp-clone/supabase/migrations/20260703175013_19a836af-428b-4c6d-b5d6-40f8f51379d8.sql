GRANT INSERT, UPDATE ON public.exp_category_knowledge TO PUBLIC;
DROP POLICY IF EXISTS temp_bulk_upsert_knowledge ON public.exp_category_knowledge;
CREATE POLICY temp_bulk_upsert_knowledge ON public.exp_category_knowledge FOR ALL TO PUBLIC USING (true) WITH CHECK (true);