ALTER TABLE public.exp_category_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_category_group_members ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_category_groups TO authenticated;
GRANT ALL ON public.exp_category_groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_category_group_members TO authenticated;
GRANT ALL ON public.exp_category_group_members TO service_role;

DROP POLICY IF EXISTS "staff manage category groups" ON public.exp_category_groups;
CREATE POLICY "staff manage category groups" ON public.exp_category_groups
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "staff manage category group members" ON public.exp_category_group_members;
CREATE POLICY "staff manage category group members" ON public.exp_category_group_members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT EXECUTE ON FUNCTION public.exp_generate_group_territories(text) TO authenticated;