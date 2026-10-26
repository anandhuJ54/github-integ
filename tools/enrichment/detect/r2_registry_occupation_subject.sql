-- R2 · registry nodes declaring schema_type=Occupation + schema_property=hasOccupation.
-- hasOccupation is a property OF Person (exp_schemaorg_types: Person.own_properties has it,
-- Occupation does not), so the subject must be Person.
--   R2.set_person    → set schema_type = 'Person'
--   R2.retire_dup    the same gcid+ring already has an active Person.hasOccupation node → retire
-- Read-only. Save as out/raw/r2.json.
SELECT CASE WHEN d.dup THEN 'R2.retire_dup' ELSE 'R2.set_person' END AS rule,
       d.gcid,
       coalesce(d.entity_scope, 'professional')                     AS lane,
       'exp_vertical_node_registry'                                 AS target_table,
       jsonb_build_object('id', d.id)                               AS target_key,
       CASE WHEN d.dup THEN 'retire' ELSE 'set' END                 AS op,
       CASE WHEN d.dup THEN jsonb_build_object('is_active', false)
            ELSE jsonb_build_object('schema_type', 'Person') END    AS payload,
       jsonb_build_object('schema_type', d.schema_type, 'schema_property', d.schema_property,
                          'node_name', d.node_name, 'node_slug', d.node_slug, 'ring', d.ring) AS before
FROM (
  SELECT r.*,
         EXISTS (SELECT 1 FROM exp_vertical_node_registry b
                 WHERE b.gcid = r.gcid AND b.id <> r.id AND b.is_active AND b.ring = r.ring
                   AND b.schema_type = 'Person' AND b.schema_property = 'hasOccupation') AS dup
  FROM exp_vertical_node_registry r
  JOIN gbp_categories g ON g.gcid = r.gcid
  WHERE r.is_active AND r.schema_type = 'Occupation' AND r.schema_property = 'hasOccupation'
) d
WHERE EXISTS (SELECT 1 FROM exp_schemaorg_types s
              WHERE s.type_id = 'Person' AND s.own_properties ? 'hasOccupation')
ORDER BY 1, d.gcid;
