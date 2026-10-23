-- T2 · taxonomy junk: engine_v1 terms built from internal GBP-verification jargon
-- ("gbp verified acrylic store", "gbp signal photo count threshold scoring").
-- These are scoring-pipeline vocabulary leaked into consumer taxonomy → retire.
-- Read-only. Output contract (every detector): rule, gcid, lane, target_table,
-- target_key, op, payload, before.  Save the result as out/raw/t2.json.
-- Live 2026-10-11: 257 rows / 13 categories (word-boundary "gbp"; the 15
-- engine_v1 rows that say "google business" are NOT matched — judgement call).
SELECT 'T2'                                   AS rule,
       t.gcid,
       'taxonomy'                             AS lane,
       'exp_taxonomy'                         AS target_table,
       jsonb_build_object('id', t.id)         AS target_key,
       'retire'                               AS op,
       jsonb_build_object('is_active', false) AS payload,
       jsonb_build_object('level', t.level, 'term', t.term, 'source', t.source, 'is_active', true) AS before
FROM exp_taxonomy t
JOIN gbp_categories g ON g.gcid = t.gcid
WHERE t.is_active
  AND t.source = 'engine_v1'
  AND t.term ~* '\mgbp\M'
ORDER BY t.gcid, t.level, t.term;
