-- T3 · taxonomy terms carrying non-standard template slots.
-- Standard slots (rendered by the city/geo pages): {city} {neighborhood} {state} {zip} {county}.
--   T3.relabel_geo   only geo-synonym slots ({suburb} {district} {region} {prefecture}
--                    {county name} {pin_code}) → rewrite to the standard slot
--   T3.retire_dup    the rewrite would collide with an existing active term → retire instead
--   T3.retire_slot   entity/person slots ({name} {professional_name} {abbey} {brand}
--                    {last_name} {breed} {year} …) – a category term cannot name one entity
--   T3.retire_alias  aliases must be bare profession names; any slot ("dr. {city} urologist") → retire
-- Global (gcid NULL) modifier rows are out of scope (proposals require a gcid FK).
-- Read-only. Save as out/raw/t3.json.
WITH geo(src, dst) AS (
  VALUES ('suburb','neighborhood'), ('district','neighborhood'), ('region','state'),
         ('prefecture','state'), ('county name','county'), ('pin_code','zip')
),
s AS (
  SELECT t.*, ARRAY(SELECT m[1] FROM regexp_matches(t.term, '\{([^}]*)\}', 'g') m) AS slots
  FROM exp_taxonomy t
  JOIN gbp_categories g ON g.gcid = t.gcid
  WHERE t.is_active AND t.term ~ '\{[^}]*\}'
),
c AS (
  SELECT s.*,
         ARRAY(SELECT x FROM unnest(s.slots) x
               WHERE x NOT IN ('city','neighborhood','state','zip','county')) AS bad
  FROM s
),
c2 AS (
  SELECT c.*,
         (c.level <> 'alias' AND cardinality(c.bad) > 0
          AND NOT EXISTS (SELECT 1 FROM unnest(c.bad) x WHERE x NOT IN (SELECT src FROM geo))) AS geo_only
  FROM c
  WHERE c.level = 'alias' OR cardinality(c.bad) > 0
),
r AS (
  SELECT c2.*,
    CASE WHEN geo_only THEN
      replace(replace(replace(replace(replace(replace(c2.term,
        '{suburb}','{neighborhood}'),'{district}','{neighborhood}'),'{region}','{state}'),
        '{prefecture}','{state}'),'{county name}','{county}'),'{pin_code}','{zip}') END AS new_term,
    CASE WHEN geo_only THEN
      replace(replace(replace(replace(replace(replace(coalesce(c2.term_display, c2.term),
        '{suburb}','{neighborhood}'),'{district}','{neighborhood}'),'{region}','{state}'),
        '{prefecture}','{state}'),'{county name}','{county}'),'{pin_code}','{zip}') END AS new_display
  FROM c2
),
r2 AS (
  SELECT r.*,
    CASE WHEN geo_only THEN
      CASE WHEN r.term_slug = trim(both '_' FROM regexp_replace(lower(r.term), '[^a-z0-9]+', '_', 'g'))
           THEN trim(both '_' FROM regexp_replace(lower(r.new_term), '[^a-z0-9]+', '_', 'g'))
           ELSE regexp_replace(lower(r.new_term), '[^a-z0-9]+', '_', 'g') END END AS new_slug
  FROM r
),
r3 AS (
  SELECT r2.*,
    (geo_only AND EXISTS (
       SELECT 1 FROM exp_taxonomy o
       WHERE o.gcid = r2.gcid AND o.level = r2.level AND o.id <> r2.id
         AND (o.term_slug = r2.new_slug OR (o.is_active AND lower(o.term) = lower(r2.new_term))))) AS collides
  FROM r2
)
SELECT
  CASE WHEN level = 'alias' THEN 'T3.retire_alias'
       WHEN geo_only AND NOT collides THEN 'T3.relabel_geo'
       WHEN geo_only THEN 'T3.retire_dup'
       ELSE 'T3.retire_slot' END                                 AS rule,
  gcid,
  'taxonomy'                                                    AS lane,
  'exp_taxonomy'                                                AS target_table,
  jsonb_build_object('id', id)                                  AS target_key,
  CASE WHEN level <> 'alias' AND geo_only AND NOT collides THEN 'relabel' ELSE 'retire' END AS op,
  CASE WHEN level <> 'alias' AND geo_only AND NOT collides
       THEN jsonb_build_object('term', new_term, 'term_display', new_display, 'term_slug', new_slug)
       ELSE jsonb_build_object('is_active', false) END          AS payload,
  jsonb_build_object('level', level, 'term', term, 'term_display', term_display,
                     'term_slug', term_slug, 'slots', to_jsonb(slots))      AS before
FROM r3
ORDER BY 1, gcid, level, term;
