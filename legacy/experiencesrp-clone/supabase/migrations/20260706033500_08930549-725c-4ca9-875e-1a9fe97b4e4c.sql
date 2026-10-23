DROP POLICY IF EXISTS "Auth write exp_category_directory_map" ON public.exp_category_directory_map;
DROP POLICY IF EXISTS "Auth write exp_directory_packs" ON public.exp_directory_packs;
REVOKE EXECUTE ON FUNCTION public.invalidate_schema_cache_on_graph_change() FROM PUBLIC;