-- Per-group variant of exp_territory_logo_profiles (same counting rule), scoped so it fits the API time limit.
CREATE OR REPLACE FUNCTION public.exp_territory_group_profiles(p_group_key text)
RETURNS TABLE(group_key text, logo_id uuid, logo_name text, logo_gcid text, locations bigint, professionals bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH RECURSIVE roots AS (
    SELECT r.id, r.name, r.gcid FROM organizations r
    WHERE r.parent_org_id IS NULL
      AND r.gcid IN (SELECT gm.gcid FROM exp_category_group_members gm WHERE gm.group_key = p_group_key)
      AND (SELECT min(gm2.group_key) FROM exp_category_group_members gm2 WHERE gm2.gcid = r.gcid) = p_group_key
  ),
  tree AS (
    SELECT r.id, r.id AS root_id FROM roots r
    UNION ALL
    SELECT c.id, t.root_id FROM organizations c JOIN tree t ON c.parent_org_id = t.id
  ),
  locs AS (SELECT root_id, count(*) - 1 AS n FROM tree GROUP BY root_id),
  pros AS (SELECT t.root_id, count(p.id) AS n FROM professionals p JOIN tree t ON t.id = p.primary_org_id GROUP BY t.root_id)
  SELECT p_group_key, r.id, r.name, r.gcid, coalesce(l.n, 0), coalesce(pr.n, 0)
  FROM roots r LEFT JOIN locs l ON l.root_id = r.id LEFT JOIN pros pr ON pr.root_id = r.id;
$$;
REVOKE ALL ON FUNCTION public.exp_territory_group_profiles(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_territory_group_profiles(text) TO authenticated;