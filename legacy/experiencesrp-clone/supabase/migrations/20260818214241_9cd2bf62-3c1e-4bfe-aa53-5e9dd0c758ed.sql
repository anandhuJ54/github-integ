ALTER TABLE public.graph_edges ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.graph_edges TO anon, authenticated;
GRANT ALL ON public.graph_edges TO service_role;
DROP POLICY IF EXISTS "Public read graph_edges" ON public.graph_edges;
CREATE POLICY "Public read graph_edges" ON public.graph_edges FOR SELECT TO anon, authenticated USING (true);