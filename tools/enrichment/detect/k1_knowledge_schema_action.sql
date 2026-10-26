-- K1 · exp_category_knowledge.conversion_actions[].schema_action values that are not
-- schema.org types (checked against exp_schemaorg_types) → set to a valid Action type.
-- Deterministic mapping, in order:
--   1. case-only typo (communicateAction, scheduleAction, subscribeAction) → canonical casing
--   2. ContactAction / MessageAction / CallAction → CommunicateAction
--      GetDirectionsAction → FindAction · ReferAction → ShareAction (existing "Refer a Client" precedent)
--      RequestQuote / RequestQuoteAction → AskAction (curated precedent: "Request a customs quote" = AskAction)
--   3. potentialAction / PotentialAction (a property, not a type) / RequestAction: by label —
--      book|appointment|reserve|"schedule a/my…" → ScheduleAction (not "Fee Schedule") · directions → FindAction ·
--      follow → FollowAction · label starting "Refer…" → ShareAction · call|callback|message|text|email|contact →
--      CommunicateAction · otherwise AskAction
-- The proposed value is re-checked against exp_schemaorg_types (new_valid must be true).
-- One proposal per array element; before carries value + label as the stale-write guard.
-- Read-only. Save as out/raw/k1.json.
WITH el AS (
  SELECT k.id, k.gcid, k.entity_type, (a.ord - 1)::int AS idx,
         a.v->>'label' AS label, a.v->>'schema_action' AS sa
  FROM exp_category_knowledge k
  JOIN gbp_categories g ON g.gcid = k.gcid
  CROSS JOIN LATERAL jsonb_array_elements(k.conversion_actions) WITH ORDINALITY a(v, ord)
  WHERE jsonb_typeof(k.conversion_actions) = 'array'
),
bad AS (
  SELECT el.* FROM el
  WHERE NOT EXISTS (SELECT 1 FROM exp_schemaorg_types s WHERE s.type_id = el.sa)
),
m AS (
  SELECT bad.*,
    coalesce(
      (SELECT s.type_id FROM exp_schemaorg_types s
        WHERE lower(s.type_id) = lower(bad.sa) AND s.type_id LIKE '%Action' LIMIT 1),
      CASE
        WHEN bad.sa IN ('ContactAction','MessageAction','CallAction') THEN 'CommunicateAction'
        WHEN bad.sa = 'GetDirectionsAction' THEN 'FindAction'
        WHEN bad.sa = 'ReferAction' THEN 'ShareAction'
        WHEN bad.sa IN ('RequestQuote','RequestQuoteAction') THEN 'AskAction'
        WHEN bad.label ~* '\m(book|appointment|reserve|schedule (a|an|my|your|the)\M)' THEN 'ScheduleAction'
        WHEN bad.label ~* '\mdirections?\M' THEN 'FindAction'
        WHEN bad.label ~* '\mfollow' THEN 'FollowAction'
        WHEN bad.label ~* '^\s*refer' THEN 'ShareAction'
        WHEN bad.label ~* '\m(call|callback|message|text|email|contact)' THEN 'CommunicateAction'
        ELSE 'AskAction'
      END) AS new_sa
  FROM bad
)
SELECT 'K1'                                                     AS rule,
       m.gcid,
       'knowledge'                                              AS lane,
       'exp_category_knowledge'                                 AS target_table,
       jsonb_build_object('id', m.id, 'entity_type', m.entity_type, 'idx', m.idx) AS target_key,
       'set'                                                    AS op,
       jsonb_build_object('column', 'conversion_actions',
                          'path', jsonb_build_array(m.idx::text, 'schema_action'),
                          'value', m.new_sa)                    AS payload,
       jsonb_build_object('value', m.sa, 'label', m.label,
                          'new_valid', EXISTS (SELECT 1 FROM exp_schemaorg_types s WHERE s.type_id = m.new_sa)) AS before
FROM m
ORDER BY m.sa, m.gcid, m.idx;
