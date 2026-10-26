-- Read-only aggregate for the territory proposer: profile_count per logo (root org).
-- Uses organizations + professionals only (no graph/taxonomy tables).
CREATE OR REPLACE FUNCTION public.exp_territory_logo_profiles()
RETURNS TABLE(group_key text, logo_id uuid, logo_name text, logo_gcid text, locations bigint, professionals bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE tree AS (
    SELECT o.id, o.id AS root_id FROM organizations o WHERE o.parent_org_id IS NULL
    UNION ALL
    SELECT c.id, t.root_id FROM organizations c JOIN tree t ON c.parent_org_id = t.id
  ),
  locs AS (SELECT root_id, count(*) - 1 AS n FROM tree GROUP BY root_id),
  pros AS (
    SELECT t.root_id, count(p.id) AS n
    FROM professionals p JOIN tree t ON t.id = p.primary_org_id
    GROUP BY t.root_id
  )
  SELECT coalesce(m.group_key, '_catchall'), r.id, r.name, r.gcid,
         coalesce(l.n, 0), coalesce(pr.n, 0)
  FROM organizations r
  LEFT JOIN locs l ON l.root_id = r.id
  LEFT JOIN pros pr ON pr.root_id = r.id
  LEFT JOIN LATERAL (
    SELECT gm.group_key FROM exp_category_group_members gm WHERE gm.gcid = r.gcid
    ORDER BY gm.group_key LIMIT 1
  ) m ON true
  WHERE r.parent_org_id IS NULL;
$$;
REVOKE ALL ON FUNCTION public.exp_territory_logo_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_territory_logo_profiles() TO authenticated, service_role;