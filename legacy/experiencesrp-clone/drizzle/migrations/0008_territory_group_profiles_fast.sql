CREATE OR REPLACE FUNCTION public.exp_territory_group_profiles(p_group_key text)
RETURNS TABLE(group_key text, logo_id uuid, logo_name text, logo_gcid text, locations bigint, professionals bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH RECURSIVE g AS (
    -- a gcid belongs to its first group (same rule as exp_territory_logo_profiles)
    SELECT gm.gcid FROM exp_category_group_members gm
    WHERE gm.group_key = p_group_key
      AND NOT EXISTS (SELECT 1 FROM exp_category_group_members o WHERE o.gcid = gm.gcid AND o.group_key < p_group_key)
  ),
  roots AS (SELECT r.id, r.name, r.gcid FROM organizations r JOIN g ON g.gcid = r.gcid WHERE r.parent_org_id IS NULL),
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