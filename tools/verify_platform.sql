-- PLATFORM VERIFICATION SUITE v2 (2026-07-06). Run whole script; every row self-labels.
-- Each recent migration has a signature check; foundation checks prove the base layers.
SELECT '01 universe' AS chk, count(*)::text AS actual, '4041' AS expected,
       CASE WHEN count(*)=4041 THEN 'PASS' ELSE 'FAIL' END AS status FROM gbp_categories
UNION ALL SELECT '02 km_rows', count(*)::text, '4041',
       CASE WHEN count(*)=4041 THEN 'PASS' ELSE 'FAIL' END FROM exp_category_knowledge
UNION ALL SELECT '03 logic_layer_rows', count(*)::text, '4041',
       CASE WHEN count(*)=4041 THEN 'PASS' ELSE 'CHECK' END
       FROM exp_category_knowledge WHERE conversion_actions IS NOT NULL
UNION ALL SELECT '04 invalid_ContactAction [mig 220000]', count(*)::text, '0',
       CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END
       FROM exp_category_knowledge WHERE conversion_actions::text LIKE '%ContactAction%'
UNION ALL SELECT '05 rings_canonical_10', count(*)::text, '10',
       CASE WHEN count(*)=10 THEN 'PASS' ELSE 'FAIL' END FROM exp_rings
UNION ALL SELECT '06 reputation_legacy_null [mig 213000]',
       coalesce((SELECT legacy_key FROM exp_rings WHERE ring_key='reputation'),'NULL'), 'NULL',
       CASE WHEN (SELECT legacy_key FROM exp_rings WHERE ring_key='reputation') IS NULL THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '07 type_key_coverage', count(*)::text, '4032 of 4041',
       CASE WHEN count(*)=4032 THEN 'PASS' ELSE 'FAIL' END
       FROM gbp_categories g JOIN exp_category_schema_type t ON t.gcid=g.gcid WHERE t.schema_type IS NOT NULL
UNION ALL SELECT '08 ringmap', count(*)::text||' rows / '||count(DISTINCT ring_key)::text||' rings', '12601 / 10',
       CASE WHEN count(*)=12601 AND count(DISTINCT ring_key)=10 THEN 'PASS' ELSE 'FAIL' END FROM exp_schema_type_ring_map
UNION ALL SELECT '09 registry_legacy_ring_values [mig 001500]', count(*)::text, '0',
       CASE WHEN count(*)=0 THEN 'PASS' ELSE 'FAIL' END FROM exp_vertical_node_registry
       WHERE ring IN ('core_identity','profiles_presence','verifiable_authority','published_content',
                      'media_voice','social_engagement','transactions_outcomes','upstream_context')
UNION ALL SELECT '10 registry_ring_check_canonical [mig 001500]',
       CASE WHEN pg_get_constraintdef(oid) LIKE '%conversion%' THEN 'canonical-10' ELSE 'stale' END, 'canonical-10',
       CASE WHEN pg_get_constraintdef(oid) LIKE '%conversion%' THEN 'PASS' ELSE 'FAIL' END
       FROM pg_constraint WHERE conname='exp_vertical_node_registry_ring_check'
UNION ALL SELECT '11 re_registry_nodes [mig 001000]', count(*)::text, '149',
       CASE WHEN count(*)=149 THEN 'PASS' ELSE 'FAIL' END
       FROM exp_vertical_node_registry WHERE gcid='gcid:real_estate_agents'
UNION ALL SELECT '12 credential_date_fix [mig 002000]',
       coalesce((SELECT schema_property FROM exp_vertical_node_registry
                 WHERE gcid='gcid:real_estate_agents' AND node_slug='license_expiration_date'),'missing'),
       'hasCredential.expires',
       CASE WHEN (SELECT schema_property FROM exp_vertical_node_registry
                  WHERE gcid='gcid:real_estate_agents' AND node_slug='license_expiration_date')='hasCredential.expires'
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '13 taxonomy_pilot [mig 231000]', count(*)::text, '205 (181 RE + 24 global)',
       CASE WHEN count(*)=205 THEN 'PASS' ELSE 'FAIL' END
       FROM exp_taxonomy WHERE gcid='gcid:real_estate_agents' OR gcid IS NULL
UNION ALL SELECT '14 taxonomy_levels', count(DISTINCT level)::text, '14',
       CASE WHEN count(DISTINCT level)=14 THEN 'PASS' ELSE 'FAIL' END
       FROM exp_taxonomy WHERE gcid='gcid:real_estate_agents' OR gcid IS NULL
UNION ALL SELECT '15 taxonomy_uniqueness_index [mig 000000]',
       CASE WHEN EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='uq_taxonomy_term') THEN 'exists' ELSE 'missing' END,
       'exists', CASE WHEN EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='uq_taxonomy_term') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '16 intelligence_view [mig 230000]',
       CASE WHEN EXISTS(SELECT 1 FROM information_schema.views WHERE table_name='exp_category_intelligence') THEN 'exists' ELSE 'missing' END,
       'exists', CASE WHEN EXISTS(SELECT 1 FROM information_schema.views WHERE table_name='exp_category_intelligence') THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '17 re_schema_projection [mig 003000]',
       coalesce((SELECT model FROM exp_category_schema WHERE gcid='gcid:real_estate_agents'),'missing'),
       'registry-projection-linted-v1',
       CASE WHEN (SELECT model FROM exp_category_schema WHERE gcid='gcid:real_estate_agents')='registry-projection-linted-v1'
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '17b projection_content_intact [mig 003000]',
       'fields '||coalesce((SELECT sum(jsonb_array_length(e->'fields'))
                   FROM jsonb_array_elements(schema_json->'lanes') l,
                        jsonb_array_elements(l->'elements') e),0)::text||
       ' / lane jsonld '||coalesce(length(schema_json->'lanes'->0->>'jsonld'),0)::text||'B+'||
       coalesce(length(schema_json->'lanes'->1->>'jsonld'),0)::text||'B / profiles '||
       coalesce(jsonb_array_length(schema_json->'lanes'->0->'profile'),0)::text||'+'||
       coalesce(jsonb_array_length(schema_json->'lanes'->1->'profile'),0)::text,
       '183 fields / >=800B each / 7+13 sections',
       CASE WHEN (SELECT sum(jsonb_array_length(e->'fields'))
                  FROM jsonb_array_elements(schema_json->'lanes') l,
                       jsonb_array_elements(l->'elements') e)=183
             AND length(schema_json->'lanes'->0->>'jsonld')>=800
             AND length(schema_json->'lanes'->1->>'jsonld')>=800
             AND jsonb_array_length(schema_json->'lanes'->0->'profile')>=7
             AND jsonb_array_length(schema_json->'lanes'->1->'profile')>=13
            THEN 'PASS' ELSE 'FAIL' END
       FROM exp_category_schema WHERE gcid='gcid:real_estate_agents'
UNION ALL SELECT '11b mortgage_registry_v2 [mig 005000]', count(*)::text, '141',
       CASE WHEN count(*)=141 THEN 'PASS' ELSE 'FAIL' END
       FROM exp_vertical_node_registry WHERE gcid='gcid:mortgage_broker'
UNION ALL SELECT '17c mortgage_projection [mig 004000]',
       coalesce((SELECT model FROM exp_category_schema WHERE gcid='gcid:mortgage_broker'),'missing')
       ||' / fields '||coalesce((SELECT sum(jsonb_array_length(e->'fields'))
          FROM exp_category_schema cs, jsonb_array_elements(cs.schema_json->'lanes') l,
               jsonb_array_elements(l->'elements') e WHERE cs.gcid='gcid:mortgage_broker'),0)::text,
       'registry-projection-linted-v1 / fields 292',
       CASE WHEN (SELECT model FROM exp_category_schema WHERE gcid='gcid:mortgage_broker')='registry-projection-linted-v1'
             AND (SELECT sum(jsonb_array_length(e->'fields'))
                  FROM exp_category_schema cs, jsonb_array_elements(cs.schema_json->'lanes') l,
                       jsonb_array_elements(l->'elements') e WHERE cs.gcid='gcid:mortgage_broker')=292
            THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '23 pilot_registries [migs 011-016]',
  (SELECT count(DISTINCT gcid) FROM exp_vertical_node_registry WHERE gcid IN
   ('gcid:lawyer','gcid:veterinarian','gcid:insurance_agency','gcid:hotel','gcid:church','gcid:electrician',
    'gcid:auto_repair_shop','gcid:chiropractor','gcid:financial_planner','gcid:pediatric_dentist','gcid:family_restaurant'))::text,
  '11', CASE WHEN (SELECT count(DISTINCT gcid) FROM exp_vertical_node_registry WHERE gcid IN
   ('gcid:lawyer','gcid:veterinarian','gcid:insurance_agency','gcid:hotel','gcid:church','gcid:electrician',
    'gcid:auto_repair_shop','gcid:chiropractor','gcid:financial_planner','gcid:pediatric_dentist','gcid:family_restaurant'))=11
   THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '24 projections_full_universe',
  (SELECT count(*) FROM exp_category_schema WHERE model='registry-projection-linted-v1')::text,
  '>=4032',
  CASE WHEN (SELECT count(*) FROM exp_category_schema WHERE model='registry-projection-linted-v1')>=4032 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '25 no_person_on_location_pilots [mig 015000]',
  (SELECT count(*) FROM exp_vertical_node_registry WHERE schema_type='Person'
    AND gcid IN ('gcid:hotel','gcid:family_restaurant','gcid:church'))::text,
  '0', CASE WHEN (SELECT count(*) FROM exp_vertical_node_registry WHERE schema_type='Person'
    AND gcid IN ('gcid:hotel','gcid:family_restaurant','gcid:church'))=0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '26 seed_registries [migs 031-032]',
  (SELECT count(DISTINCT gcid) FROM exp_vertical_node_registry WHERE gcid IN
   ('gcid:dentist','gcid:restaurant','gcid:italian_restaurant','gcid:accountant','gcid:hair_salon',
    'gcid:hardware_store','gcid:plumber'))::text,'7',
  CASE WHEN (SELECT count(DISTINCT gcid) FROM exp_vertical_node_registry WHERE gcid IN
   ('gcid:dentist','gcid:restaurant','gcid:italian_restaurant','gcid:accountant','gcid:hair_salon',
    'gcid:hardware_store','gcid:plumber'))=7 THEN 'PASS' ELSE 'FAIL' END
UNION ALL SELECT '18 compliance_rows', count(*)::text, '>=4032', CASE WHEN count(*)>=4032 THEN 'PASS' ELSE 'FAIL' END FROM exp_category_compliance
UNION ALL SELECT '19 registry_categories', count(DISTINCT gcid)::text, '>=4032', CASE WHEN count(DISTINCT gcid)>=4032 THEN 'PASS' ELSE 'FAIL' END FROM exp_vertical_node_registry
UNION ALL SELECT '20 taxonomy_categories', count(DISTINCT gcid)::text, '>=4032', CASE WHEN count(DISTINCT gcid)>=4032 THEN 'PASS' ELSE 'FAIL' END FROM exp_taxonomy
ORDER BY 1;
