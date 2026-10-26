DROP POLICY IF EXISTS temp_bulk_upsert_knowledge ON public.exp_category_knowledge;
REVOKE INSERT, UPDATE ON public.exp_category_knowledge FROM PUBLIC;