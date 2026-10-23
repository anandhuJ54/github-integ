ALTER TABLE public.graph_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active graph_nodes" ON public.graph_nodes;
CREATE POLICY "Public read active graph_nodes" ON public.graph_nodes
  FOR SELECT TO anon, authenticated USING (is_active = true);
GRANT SELECT ON public.graph_nodes TO anon, authenticated;
GRANT ALL ON public.graph_nodes TO service_role;