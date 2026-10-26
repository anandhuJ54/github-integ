-- Linter WARNs 37-40, adjudicated:
-- Always-true ALL policies let any signed-in user write these tables — scaffolding leftovers.
DROP POLICY IF EXISTS "Auth write exp_category_directory_map" ON public.exp_category_directory_map;
DROP POLICY IF EXISTS "Auth write exp_directory_packs" ON public.exp_directory_packs;
-- Trigger functions run as definer regardless of EXECUTE grants; PUBLIC execute is pure surface.
REVOKE EXECUTE ON FUNCTION public.invalidate_schema_cache_on_graph_change() FROM PUBLIC;
