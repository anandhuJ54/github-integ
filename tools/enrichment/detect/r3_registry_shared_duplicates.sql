-- R3 · a 'shared' registry node that duplicates an active scoped (location/professional)
-- node of the same name and ring in the same category → retire the shared copy; the scoped
-- node is the more specific one (typed schema_type + dotted property).
-- Live 2026-10-11: exactly one — insurance_agent "Google Review Count"
-- (shared google_review_count_node vs location google_review_count).
-- Read-only. Save as out/raw/r3.json.
SELECT 'R3'                                   AS rule,
       a.gcid,
       'shared'                               AS lane,
       'exp_vertical_node_registry'           AS target_table,
       jsonb_build_object('id', a.id)         AS target_key,
       'retire'                               AS op,
       jsonb_build_object('is_active', false) AS payload,
       jsonb_build_object('node_name', a.node_name, 'node_slug', a.node_slug, 'entity_scope', a.entity_scope,
                          'schema_property', a.schema_property, 'kept_id', b.id, 'kept_slug', b.node_slug,
                          'kept_scope', b.entity_scope, 'kept_property', b.schema_property) AS before
FROM exp_vertical_node_registry a
JOIN gbp_categories g ON g.gcid = a.gcid
JOIN exp_vertical_node_registry b
  ON b.gcid = a.gcid AND b.id <> a.id AND b.is_active
 AND lower(b.node_name) = lower(a.node_name) AND b.ring = a.ring
 AND b.entity_scope IN ('location', 'professional')
WHERE a.is_active AND a.entity_scope = 'shared'
ORDER BY a.gcid;
