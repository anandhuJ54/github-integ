-- T5 · question-level taxonomy terms that do not end in "?" → relabel (append "?").
-- term_slug is left unchanged (slugs are identity; no collision risk).
-- Rows that also carry a non-standard slot are left to T3 (propose.ts dedupes too).
-- Read-only. Save as out/raw/t5.json.
SELECT 'T5'                           AS rule,
       t.gcid,
       'taxonomy'                     AS lane,
       'exp_taxonomy'                 AS target_table,
       jsonb_build_object('id', t.id) AS target_key,
       'relabel'                      AS op,
       jsonb_build_object(
         'term', rtrim(t.term) || '?',
         'term_display', CASE WHEN rtrim(coalesce(t.term_display, t.term)) LIKE '%?'
                              THEN coalesce(t.term_display, t.term)
                              ELSE rtrim(coalesce(t.term_display, t.term)) || '?' END) AS payload,
       jsonb_build_object('term', t.term, 'term_display', t.term_display) AS before
FROM exp_taxonomy t
JOIN gbp_categories g ON g.gcid = t.gcid
WHERE t.is_active
  AND t.level = 'question'
  AND rtrim(t.term) NOT LIKE '%?'
  AND NOT EXISTS (SELECT 1 FROM regexp_matches(t.term, '\{([^}]*)\}', 'g') m
                  WHERE m[1] NOT IN ('city','neighborhood','state','zip','county'))
ORDER BY t.gcid, t.term;
