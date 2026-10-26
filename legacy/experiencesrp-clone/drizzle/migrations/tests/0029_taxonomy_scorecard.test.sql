-- 0029_taxonomy_scorecard.test.sql
--
-- HOW TO RUN: paste the whole file into the SQL runner. Nothing is kept: the DO block ends with
-- RAISE EXCEPTION, which rolls back the function creation and every simulated change. A first line
-- "SCORECARD TEST OK (rolled back by design)" means every assertion held; "TEST FAIL: ..." names the
-- assertion that did not. The message carries the baseline numbers for the four pilot categories.
--
-- The two CREATE FUNCTION statements and four REVOKE/GRANT statements below are VERBATIM copies of
-- drizzle/migrations/0029_taxonomy_scorecard.sql (EXECUTE'd, because a DO block cannot hold DDL any
-- other way). If the migration changes, regenerate this file; do not edit the copies by hand.
--
-- KNOBS (top of the DO block):
--   v_full      false: list only failed metrics (lane/metric value target). true: every row with its detail.
--   v_simulate  true: ADD the four 0028 columns INSIDE this transaction when absent (brief ACCESS EXCLUSIVE
--               lock on exp_taxonomy until the rollback; the table has no triggers), fill gcid:cannabis_store
--               with a known pattern of concept_slug / volume / volume_as_of / evidence, and assert the
--               scorecard reports exactly that pattern. This exercises the post-0028 paths.
--               false: no DDL/DML at all (only the pre-0028 behaviour is tested).
--               If 0028 is already applied the ALTER is a no-op and the pattern is written to the real
--               columns (still rolled back).
-- ASSERTIONS: both functions STABLE + SECURITY INVOKER + search_path public; one row per (lane, metric);
-- 14 active_count rows; no NULL passed/detail; active_count equals a direct count per level (JOIN on level);
-- summary agrees with the scorecard; an unknown gcid scores category_in_master = 0 without error; before
-- 0028 the concept metrics are 0; the simulated pattern is reflected exactly.
-- The BASELINE report in the message is taken BEFORE the simulation changes anything.

DO $test$
DECLARE
  v_gcids    text[]  := ARRAY['gcid:cannabis_store','gcid:mexican_restaurant','gcid:real_estate_agents','gcid:mortgage_lender'];
  v_full     boolean := false;
  v_simulate boolean := true;
  g          text;
  r          record;
  v_n        bigint;
  v_p        bigint;
  v_msg      text := '';
  v_report   text := '';
  v_pre      boolean;
  v_exp      numeric;
  v_val      numeric;
  v_cnt      bigint;
BEGIN
  ---------------------------------------------------------------- create (verbatim from the migration)
  EXECUTE $m1$
CREATE OR REPLACE FUNCTION public.exp_taxonomy_scorecard(p_gcid text)
RETURNS TABLE(lane text, metric text, value numeric, target numeric, passed boolean, detail text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
WITH
p AS (SELECT p_gcid AS g),
-- which 0028 columns exist (wording of detail only; values always come from to_jsonb)
cols AS (
  SELECT
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.exp_taxonomy'::regclass AND attname = 'concept_slug'  AND NOT attisdropped) AS has_concept,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.exp_taxonomy'::regclass AND attname = 'volume_source' AND NOT attisdropped) AS has_vsrc,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.exp_taxonomy'::regclass AND attname = 'volume_as_of'  AND NOT attisdropped) AS has_vasof,
    EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.exp_taxonomy'::regclass AND attname = 'evidence'      AND NOT attisdropped) AS has_evidence
),
-- lane config: order, target range, demand lane (carries search volume), templatable (geo templates allowed)
cfg(lo, ln, min_n, max_n, demand, templ) AS (VALUES
  (1,  'keyword',          25, 50,  true,  true),
  (2,  'product_service',  50, 100, true,  false),
  (3,  'question',         25, 50,  true,  true),
  (4,  'content_title',    25, 50,  true,  true),
  (5,  'topic',            20, 60,  true,  true),
  (6,  'tag',              15, 40,  false, true),
  (7,  'audience',         10, 30,  false, true),
  (8,  'specialization',   10, 40,  false, false),
  (9,  'alias',            6,  20,  false, true),
  (10, 'profession_title', 3,  15,  false, false),
  (11, 'industry_term',    20, 60,  false, false),
  (12, 'review_aspect',    12, 30,  false, false),
  (13, 'negative_keyword', 8,  30,  false, false),
  (14, 'modifier',         0,  50,  false, true)
),
cat AS (
  SELECT p.g AS gcid,
         gc.gcid IS NOT NULL AS in_master,
         gc.display_name AS head_name,
         s.gcid IS NOT NULL AS has_shape,
         CASE WHEN s.gcid IS NULL THEN NULL ELSE 'professional' = ANY (s.allowed_entity_types) END AS has_pro,
         CASE WHEN s.gcid IS NULL THEN NULL ELSE 'location'     = ANY (s.allowed_entity_types) END AS has_loc,
         st.schema_type,
         COALESCE(st.schema_type ~ '(Store|Restaurant|Bakery|BarOrPub|CafeOrCoffeeShop|FoodEstablishment|FoodService|IceCreamShop|Brewery|Winery|Distillery|Florist)$', false) AS concept_only
  FROM p
  LEFT JOIN gbp_categories gc          ON gc.gcid = p.g
  LEFT JOIN exp_category_shape s       ON s.gcid  = p.g
  LEFT JOIN exp_category_schema_type st ON st.gcid = p.g
),
-- active rows of the requested categories; 0028 columns read through to_jsonb (NULL if absent)
base AS (
  SELECT row_number() OVER (ORDER BY t.id) AS rid,
         t.gcid, t.level AS ln, t.term, t.source, t.search_volume_monthly AS vol,
         t.entity_scope AS scope, t.priority, t.created_at,
         (COALESCE(t.use_srp, false) AND COALESCE(t.use_voce, false) AND COALESCE(t.use_search, false)
            AND COALESCE(t.use_agents, false) AND COALESCE(t.use_schema, false)) AS all_flags,
         x.j -> 'evidence'                                       AS ev,
         NULLIF(btrim(x.j ->> 'concept_slug'), '')               AS concept,
         NULLIF(btrim(x.j ->> 'volume_source'), '')              AS vsrc,
         NULLIF(btrim(x.j ->> 'volume_as_of'), '')::timestamptz  AS vasof
  FROM p
  JOIN exp_taxonomy t ON t.gcid = p.g AND t.is_active IS TRUE
  CROSS JOIN LATERAL (SELECT to_jsonb(t) AS j) x
),
heads AS (
  SELECT -(row_number() OVER (ORDER BY c.gcid)) AS rid, c.gcid, c.head_name AS term
  FROM cat c WHERE c.head_name IS NOT NULL
),
-- token-set key: lowercase, split on whitespace/punctuation, drop stopwords, stem plurals, sort, dedupe
words AS (
  SELECT k.rid,
         CASE
           WHEN x.w ~ '[^aeiou]ies$'             THEN regexp_replace(x.w, 'ies$', 'y')
           WHEN x.w ~ '[^aeiou]ie$'              THEN regexp_replace(x.w, 'ie$', 'y')
           WHEN x.w ~ '(ches|shes|xes|zes|sses)$' THEN regexp_replace(x.w, 'es$', '')
           WHEN x.w ~ '(ss|us|is)$'              THEN x.w
           WHEN x.w ~ '.{3,}s$'                  THEN left(x.w, -1)
           ELSE x.w
         END AS stem
  FROM (SELECT rid, term FROM base UNION ALL SELECT rid, term FROM heads) k
  CROSS JOIN LATERAL regexp_split_to_table(btrim(regexp_replace(lower(k.term), '[\s[:punct:]]+', ' ', 'g')), ' ') AS x(w)
  WHERE x.w <> ''
    AND NOT (x.w = ANY (ARRAY['a','an','the','of','for','to','in','on','at','and','or','with','my','your','you','i',
                              'is','are','do','does','did','can','should','would','will','it','its','this','that',
                              'be','from','by','s','our','we']))
),
nk AS (
  SELECT rid, string_agg(DISTINCT stem, ' ' ORDER BY stem) AS nkey FROM words GROUP BY rid
),
r1 AS (
  SELECT b.*,
         btrim(regexp_replace(lower(b.term), '[\s[:punct:]]+', ' ', 'g')) AS xkey,
         COALESCE(n.nkey, btrim(regexp_replace(lower(b.term), '[\s[:punct:]]+', ' ', 'g'))) AS nkey,
         (NULLIF(btrim(b.source), '') IS NOT NULL) AS has_src,
         (b.vol IS NOT NULL) AS has_vol,
         (b.ev IS NOT NULL AND b.ev NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb, '""'::jsonb)) AS has_ev,
         (b.term ~* '\{[^{}]*\}|\{\{|\}\}|%s|%\([a-z_]+\)s|<[a-z_ ]{2,}>|\[[a-z_ ]{2,}\]') AS has_ph,
         (b.term ~* '\{[^{}]*\}|\{\{|\}\}|%s|%\([a-z_]+\)s|<[a-z_ ]{2,}>|\[[a-z_ ]{2,}\]'
            AND regexp_replace(b.term, '\{(city|state|zip|zipcode|zip_code|neighborhood|county|suburb|region|district|metro|town|area)\}', '', 'gi')
                  !~* '\{[^{}]*\}|\{\{|\}\}|%s|%\([a-z_]+\)s|<[a-z_ ]{2,}>|\[[a-z_ ]{2,}\]') AS geo_only,
         array_remove(ARRAY[
           CASE WHEN b.term ~* '\m(gbp|gmb|google business profile)\M' THEN 'gbp' END,
           CASE WHEN b.term ~* '\mverified\M' THEN 'verified' END,
           CASE WHEN b.term ~* '\mstorefront\M' THEN 'storefront' END,
           CASE WHEN b.term ~* 'near me.*near me' THEN 'near_me_twice' END,
           CASE WHEN b.term ~ '^[[:digit:][:punct:][:space:]]+$' THEN 'digits_only' END,
           CASE WHEN b.term ~* '(https?://|www\.|\.(com|net|org|io)\M|@[a-z0-9-]+\.[a-z])' THEN 'url_or_email' END,
           CASE WHEN b.term ~* '\m(best|top|near|me|in|the|of|for|and|to|service|services|store|shop|company|local)\M \m\1\M' THEN 'repeated_word' END,
           CASE WHEN b.term ~ '^[a-z0-9]+(-[a-z0-9]+){3,}$' THEN 'slug_like' END,
           CASE WHEN b.term ~* '\m(lorem ipsum|click here|todo|tbd|undefined|null|n/a)\M' THEN 'filler' END,
           CASE WHEN length(btrim(b.term)) < 2
                  OR length(b.term) > CASE WHEN b.ln IN ('content_title', 'question') THEN 160 ELSE 100 END THEN 'length' END
         ], NULL) AS junk_tags
  FROM base b
  LEFT JOIN nk n ON n.rid = b.rid
),
pc AS (SELECT DISTINCT gcid, concept FROM base WHERE ln = 'product_service' AND concept IS NOT NULL),
r2 AS (
  SELECT r.*,
         COALESCE(f.templ, false) AS templ,
         (r.geo_only AND COALESCE(f.templ, false)) AS local_tpl,
         (r.has_ph AND NOT (r.geo_only AND COALESCE(f.templ, false))) AS unres,
         (r.scope IS NULL OR r.scope NOT IN ('shared', 'professional', 'location')
            OR (r.scope = 'professional' AND c.has_pro IS FALSE)
            OR (r.scope = 'location'     AND c.has_loc IS FALSE)) AS scope_bad,
         (r.concept IS NOT NULL AND EXISTS (SELECT 1 FROM pc WHERE pc.gcid = r.gcid AND pc.concept = r.concept)) AS linked,
         count(*) OVER (PARTITION BY r.gcid, r.ln, r.nkey) AS near_grp
  FROM r1 r
  JOIN cat c ON c.gcid = r.gcid
  LEFT JOIN cfg f ON f.ln = r.ln
),
agg AS (
  SELECT r.gcid, r.ln,
         count(*) AS n,
         count(*) FILTER (WHERE r.has_src AND (r.has_vol OR r.has_ev)) AS evid_n,
         count(*) FILTER (WHERE r.has_src) AS src_n,
         count(*) FILTER (WHERE r.has_vol) AS vol_n,
         count(*) FILTER (WHERE r.has_ev)  AS ev_n,
         count(*) FILTER (WHERE r.has_vol AND r.vsrc IS NOT NULL AND r.vasof IS NOT NULL) AS prov_n,
         count(*) FILTER (WHERE r.has_vol AND (r.vasof IS NULL OR r.vasof < now() - interval '180 days')) AS stale_n,
         count(*) - count(DISTINCT r.xkey) AS exact_d,
         count(*) - count(DISTINCT r.nkey) AS near_d,
         count(*) FILTER (WHERE r.local_tpl) AS local_n,
         count(*) FILTER (WHERE r.unres) AS unres_n,
         count(*) FILTER (WHERE cardinality(r.junk_tags) > 0) AS junk_n,
         count(*) FILTER (WHERE r.scope_bad) AS scope_bad_n,
         count(*) FILTER (WHERE r.all_flags) AS all_true_n,
         count(*) FILTER (WHERE r.concept IS NOT NULL) AS concept_n,
         count(*) FILTER (WHERE r.linked) AS linked_n
  FROM r2 r
  WHERE r.ln IN (SELECT ln FROM cfg)
  GROUP BY r.gcid, r.ln
),
unknown_lane AS (
  SELECT gcid, count(*) AS n FROM r2 WHERE ln NOT IN (SELECT ln FROM cfg) GROUP BY gcid
),
-- example terms (3 per kind) and junk tag counts for detail text
ex AS (
  SELECT gcid, ln, kind, string_agg(txt, ' | ' ORDER BY txt) AS terms
  FROM (
    SELECT u.*, row_number() OVER (PARTITION BY gcid, ln, kind ORDER BY txt) AS rn
    FROM (
      SELECT gcid, ln, 'junk' AS kind, term AS txt FROM r2 WHERE cardinality(junk_tags) > 0
      UNION ALL SELECT gcid, ln, 'ph',   term FROM r2 WHERE unres
      UNION ALL SELECT gcid, ln, 'dup',  term FROM r2 WHERE near_grp > 1
      UNION ALL SELECT gcid, ln, 'scope', scope || ': ' || term FROM r2 WHERE scope_bad
    ) u
  ) v
  WHERE rn <= 3
  GROUP BY gcid, ln, kind
),
jt AS (
  SELECT gcid, ln, string_agg(tag || '=' || c, ', ' ORDER BY c DESC, tag) AS tags
  FROM (SELECT r.gcid, r.ln, tag, count(*) AS c FROM r2 r CROSS JOIN LATERAL unnest(r.junk_tags) AS tag GROUP BY 1, 2, 3) q
  GROUP BY gcid, ln
),
hd AS (
  SELECT c.gcid, c.head_name,
         COALESCE(EXISTS (SELECT 1 FROM r2 r WHERE r.gcid = c.gcid AND r.ln = 'keyword' AND r.nkey = hn.nkey), false) AS head_ok,
         ta.term AS alias_term,
         COALESCE(EXISTS (SELECT 1 FROM r2 r WHERE r.gcid = c.gcid AND r.ln = 'keyword' AND r.nkey = ta.nkey), false) AS alias_ok
  FROM cat c
  LEFT JOIN heads h ON h.gcid = c.gcid
  LEFT JOIN nk hn ON hn.rid = h.rid
  LEFT JOIN LATERAL (
    SELECT r.term, r.nkey FROM r2 r
    WHERE r.gcid = c.gcid AND r.ln = 'alias'
    ORDER BY r.priority ASC NULLS LAST, r.vol DESC NULLS LAST, r.created_at, r.term
    LIMIT 1
  ) ta ON true
),
L AS (
  SELECT c.gcid, f.lo, f.ln, f.demand, f.templ, c.schema_type, c.concept_only, c.has_shape, c.has_pro, c.has_loc,
         CASE WHEN f.ln = 'product_service' AND c.concept_only THEN 20
              WHEN f.ln = 'profession_title' AND c.has_pro IS FALSE THEN 0
              ELSE f.min_n END AS min_n,
         CASE WHEN f.ln = 'product_service' AND c.concept_only THEN 60 ELSE f.max_n END AS max_n,
         COALESCE(a.n, 0)          AS n,
         COALESCE(a.evid_n, 0)     AS evid_n,
         COALESCE(a.src_n, 0)      AS src_n,
         COALESCE(a.vol_n, 0)      AS vol_n,
         COALESCE(a.ev_n, 0)       AS ev_n,
         COALESCE(a.prov_n, 0)     AS prov_n,
         COALESCE(a.stale_n, 0)    AS stale_n,
         COALESCE(a.exact_d, 0)    AS exact_d,
         COALESCE(a.near_d, 0)     AS near_d,
         COALESCE(a.local_n, 0)    AS local_n,
         COALESCE(a.unres_n, 0)    AS unres_n,
         COALESCE(a.junk_n, 0)     AS junk_n,
         COALESCE(a.scope_bad_n, 0) AS scope_bad_n,
         COALESCE(a.all_true_n, 0) AS all_true_n,
         COALESCE(a.concept_n, 0)  AS concept_n,
         COALESCE(a.linked_n, 0)   AS linked_n,
         COALESCE(exd.terms, '')   AS dup_ex,
         COALESCE(exp_.terms, '')  AS ph_ex,
         COALESCE(exj.terms, '')   AS junk_ex,
         COALESCE(exs.terms, '')   AS scope_ex,
         COALESCE(jt.tags, '')     AS junk_tags
  FROM cat c
  CROSS JOIN cfg f
  LEFT JOIN agg a  ON a.gcid = c.gcid AND a.ln = f.ln
  LEFT JOIN ex exd ON exd.gcid = c.gcid AND exd.ln = f.ln AND exd.kind = 'dup'
  LEFT JOIN ex exp_ ON exp_.gcid = c.gcid AND exp_.ln = f.ln AND exp_.kind = 'ph'
  LEFT JOIN ex exj ON exj.gcid = c.gcid AND exj.ln = f.ln AND exj.kind = 'junk'
  LEFT JOIN ex exs ON exs.gcid = c.gcid AND exs.ln = f.ln AND exs.kind = 'scope'
  LEFT JOIN jt     ON jt.gcid  = c.gcid AND jt.ln  = f.ln
),
m AS (
  -- ---------------------------------------------------------------- _all
  SELECT c.gcid, 0 AS lo, '_all' AS ln, 1 AS ord, 'category_in_master' AS metric,
         (CASE WHEN c.in_master THEN 1 ELSE 0 END)::numeric AS value, 1::numeric AS target, c.in_master AS passed,
         CASE WHEN c.in_master THEN 'gcid joins to gbp_categories; need 1'
              ELSE 'gcid NOT found in gbp_categories (identifier contract: no invented or re-keyed gcids); need 1' END AS detail
  FROM cat c
  UNION ALL
  SELECT c.gcid, 0, '_all', 2, 'shape_row_present',
         (CASE WHEN c.has_shape THEN 1 ELSE 0 END)::numeric, 1::numeric, c.has_shape,
         CASE WHEN c.has_shape THEN 'exp_category_shape row present (allowed_entity_types drives scope_violation_share); need 1'
              ELSE 'no exp_category_shape row: scope_violation_share cannot check professional/location scope; need 1' END
  FROM cat c
  UNION ALL
  SELECT c.gcid, 0, '_all', 3, 'unknown_lane_rows',
         COALESCE(u.n, 0)::numeric, 0::numeric, COALESCE(u.n, 0) = 0,
         COALESCE(u.n, 0) || ' active rows have a level outside the 14 lanes; need 0'
  FROM cat c LEFT JOIN unknown_lane u ON u.gcid = c.gcid
  -- ---------------------------------------------------------------- per lane
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 10, 'active_count',
         l.n::numeric, l.min_n::numeric, (l.n BETWEEN l.min_n AND l.max_n),
         l.n || ' active; need ' || l.min_n || '-' || l.max_n
           || CASE WHEN l.ln = 'product_service' AND l.concept_only THEN ' (concept-only category, schema type ' || l.schema_type || ')'
                   WHEN l.ln = 'profession_title' AND l.has_pro IS FALSE THEN ' (category does not allow professionals)'
                   ELSE '' END
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 20, 'evidence_coverage',
         round(l.evid_n::numeric / NULLIF(l.n, 0), 4), CASE WHEN l.demand THEN 0.80 ELSE 0.50 END,
         ((l.n = 0 AND l.min_n = 0) OR (l.n > 0 AND l.evid_n::numeric / l.n >= CASE WHEN l.demand THEN 0.80 ELSE 0.50 END)),
         l.evid_n || '/' || l.n || ' rows have a source and (a volume or an evidence flag); sourced ' || l.src_n
           || ', with volume ' || l.vol_n || ', with evidence ' || l.ev_n
           || '; need >= ' || CASE WHEN l.demand THEN '0.80' ELSE '0.50' END
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 21, 'volume_provenance',
         round(l.prov_n::numeric / NULLIF(l.vol_n, 0), 4), 1::numeric,
         (l.vol_n = 0 OR l.prov_n = l.vol_n),
         CASE WHEN l.vol_n = 0 THEN 'n/a: no row carries a volume (see evidence_coverage)'
              ELSE l.prov_n || '/' || l.vol_n || ' volume rows have volume_source and volume_as_of'
                   || CASE WHEN NOT (k.has_vsrc AND k.has_vasof) THEN ' (columns not present: 0028 not applied)' ELSE '' END
                   || '; need 1.0' END
  FROM L l CROSS JOIN cols k WHERE l.demand
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 22, 'volume_freshness',
         round(l.stale_n::numeric / NULLIF(l.vol_n, 0), 4), 0.10,
         (l.vol_n = 0 OR l.stale_n::numeric / l.vol_n <= 0.10),
         CASE WHEN l.vol_n = 0 THEN 'n/a: no row carries a volume (see evidence_coverage)'
              ELSE l.stale_n || '/' || l.vol_n || ' volume rows are older than 180 days or undated'
                   || CASE WHEN NOT k.has_vasof THEN ' (volume_as_of not present: 0028 not applied)' ELSE '' END
                   || '; need <= 0.10' END
  FROM L l CROSS JOIN cols k WHERE l.demand
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 30, 'exact_dup_share',
         round(l.exact_d::numeric / NULLIF(l.n, 0), 4), 0::numeric, (l.exact_d = 0),
         l.exact_d || '/' || l.n || ' rows repeat another row after lowercasing and dropping punctuation; need 0'
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 31, 'near_dup_share',
         round(l.near_d::numeric / NULLIF(l.n, 0), 4), 0.05,
         (l.n = 0 OR l.near_d::numeric / l.n <= 0.05),
         l.near_d || '/' || l.n || ' rows are redundant by token set (stopwords dropped, plurals stemmed, includes exact duplicates)'
           || CASE WHEN l.dup_ex <> '' THEN '; e.g. ' || l.dup_ex ELSE '' END || '; need <= 0.05'
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 40, 'placeholder_unresolved_share',
         round(l.unres_n::numeric / NULLIF(l.n, 0), 4), 0::numeric, (l.unres_n = 0),
         l.unres_n || '/' || l.n || ' rows carry an unresolved placeholder (unknown token, or geo token in a lane that is not templatable)'
           || CASE WHEN l.ph_ex <> '' THEN '; e.g. ' || l.ph_ex ELSE '' END || '; need 0'
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 41, 'local_template_share',
         round(l.local_n::numeric / NULLIF(l.n, 0), 4), 0.30,
         (l.n = 0 OR l.local_n::numeric / l.n <= 0.30),
         l.local_n || '/' || l.n || ' rows are typed local templates ({city} {state} {zip} ...)'
           || CASE WHEN NOT l.templ THEN ' (lane is not templatable: such rows count as unresolved)' ELSE '' END || '; need <= 0.30'
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 50, 'junk_suspect_share',
         round(l.junk_n::numeric / NULLIF(l.n, 0), 4), 0.02,
         (l.n = 0 OR l.junk_n::numeric / l.n <= 0.02),
         l.junk_n || '/' || l.n || ' rows match a brand/junk heuristic'
           || CASE WHEN l.junk_tags <> '' THEN ' (' || l.junk_tags || ')' ELSE '' END
           || CASE WHEN l.junk_ex <> '' THEN '; e.g. ' || l.junk_ex ELSE '' END || '; need <= 0.02'
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 60, 'scope_violation_share',
         round(l.scope_bad_n::numeric / NULLIF(l.n, 0), 4), 0::numeric, (l.scope_bad_n = 0),
         l.scope_bad_n || '/' || l.n || ' rows have an entity_scope the category does not allow'
           || CASE WHEN NOT l.has_shape THEN ' (no exp_category_shape row: only unknown scope values checked)'
                   ELSE ' (professional allowed: ' || l.has_pro || ', location allowed: ' || l.has_loc || ')' END
           || CASE WHEN l.scope_ex <> '' THEN '; e.g. ' || l.scope_ex ELSE '' END || '; need 0'
  FROM L l
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 70, 'use_flags_all_true_share',
         round(l.all_true_n::numeric / NULLIF(l.n, 0), 4), 0.95,
         (l.n = 0 OR l.all_true_n::numeric / l.n <= 0.95),
         l.all_true_n || '/' || l.n || ' rows have all five use_* flags true (the flags route nothing when almost all are all-true); need <= 0.95'
  FROM L l
  -- ---------------------------------------------------------------- keyword: bare head term and alias
  UNION ALL
  SELECT h.gcid, 1, 'keyword', 80, 'bare_head_term',
         (CASE WHEN h.head_ok THEN 1 ELSE 0 END)::numeric, 1::numeric, h.head_ok,
         CASE WHEN h.head_name IS NULL THEN 'category has no display_name in gbp_categories; need 1'
              WHEN h.head_ok THEN 'category name "' || h.head_name || '" exists as an active keyword; need 1'
              ELSE 'category name "' || h.head_name || '" is not an active keyword (compared on token-set key); need 1' END
  FROM hd h
  UNION ALL
  SELECT h.gcid, 1, 'keyword', 81, 'bare_head_alias',
         (CASE WHEN h.alias_ok THEN 1 ELSE 0 END)::numeric, 1::numeric, h.alias_ok,
         CASE WHEN h.alias_term IS NULL THEN 'category has no active alias; need 1'
              WHEN h.alias_ok THEN 'top alias "' || h.alias_term || '" exists as an active keyword; need 1'
              ELSE 'top alias "' || h.alias_term || '" is not an active keyword; need 1' END
  FROM hd h
  -- ---------------------------------------------------------------- concept links (0 before 0028)
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 90, 'concept_slug_share',
         round(l.concept_n::numeric / NULLIF(l.n, 0), 4), 0.95,
         (l.n > 0 AND l.concept_n::numeric / l.n >= 0.95),
         l.concept_n || '/' || l.n || ' product_service rows have a concept_slug'
           || CASE WHEN NOT k.has_concept THEN ' (concept_slug column not present: 0028 not applied)' ELSE '' END || '; need >= 0.95'
  FROM L l CROSS JOIN cols k WHERE l.ln = 'product_service'
  UNION ALL
  SELECT l.gcid, l.lo, l.ln, 91, 'concept_link_share',
         round(l.linked_n::numeric / NULLIF(l.n, 0), 4), 0.60,
         (l.n > 0 AND l.linked_n::numeric / l.n >= 0.60),
         l.linked_n || '/' || l.n || ' rows share a concept_slug with an active product_service row'
           || CASE WHEN NOT k.has_concept THEN ' (concept_slug column not present: 0028 not applied)' ELSE '' END || '; need >= 0.60'
  FROM L l CROSS JOIN cols k WHERE l.ln IN ('content_title', 'question', 'topic')
)
SELECT m.ln AS lane, m.metric, m.value, m.target, m.passed, m.detail
FROM m
ORDER BY m.lo, m.ord
$fn$;
$m1$;

  EXECUTE $m2$
CREATE OR REPLACE FUNCTION public.exp_taxonomy_scorecard_summary(p_gcids text[])
RETURNS TABLE(gcid text, display_name text, active_rows bigint, metrics_total integer, metrics_passed integer,
              metrics_failed integer, pass_rate numeric, gate_passed boolean, failed_metrics text[])
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
SELECT g.gcid,
       gc.display_name,
       (SELECT count(*) FROM exp_taxonomy t WHERE t.gcid = g.gcid AND t.is_active IS TRUE),
       count(*)::integer,
       (count(*) FILTER (WHERE s.passed))::integer,
       (count(*) FILTER (WHERE NOT s.passed))::integer,
       round((count(*) FILTER (WHERE s.passed))::numeric / NULLIF(count(*), 0), 4),
       bool_and(s.passed),
       array_agg(s.lane || '/' || s.metric ORDER BY s.lane, s.metric) FILTER (WHERE NOT s.passed)
FROM (SELECT DISTINCT x AS gcid FROM unnest(p_gcids) AS x WHERE x IS NOT NULL) g
CROSS JOIN LATERAL public.exp_taxonomy_scorecard(g.gcid) s
LEFT JOIN gbp_categories gc ON gc.gcid = g.gcid
GROUP BY g.gcid, gc.display_name
ORDER BY g.gcid
$fn$;
$m2$;

  EXECUTE $m3$ REVOKE ALL ON FUNCTION public.exp_taxonomy_scorecard(text) FROM PUBLIC, anon; $m3$;
  EXECUTE $m4$ REVOKE ALL ON FUNCTION public.exp_taxonomy_scorecard_summary(text[]) FROM PUBLIC, anon; $m4$;
  EXECUTE $m5$ GRANT EXECUTE ON FUNCTION public.exp_taxonomy_scorecard(text) TO authenticated, service_role; $m5$;
  EXECUTE $m6$ GRANT EXECUTE ON FUNCTION public.exp_taxonomy_scorecard_summary(text[]) TO authenticated, service_role; $m6$;

  ---------------------------------------------------------------- 1. function properties
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.oid IN ('public.exp_taxonomy_scorecard(text)'::regprocedure, 'public.exp_taxonomy_scorecard_summary(text[])'::regprocedure)
     AND p.provolatile = 's' AND NOT p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%';
  IF v_n <> 2 THEN RAISE EXCEPTION 'TEST FAIL: both functions must be STABLE, SECURITY INVOKER, search_path public (found % of 2)', v_n; END IF;

  v_pre := NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.exp_taxonomy'::regclass AND attname = 'concept_slug' AND NOT attisdropped);
  v_msg := v_msg || format(E'0028 columns present before the test: %s\n', CASE WHEN v_pre THEN 'NO (pre-0028 baseline)' ELSE 'YES' END);

  ---------------------------------------------------------------- 2. per-gcid structural assertions
  FOREACH g IN ARRAY v_gcids LOOP
    SELECT count(*) - count(DISTINCT lane || '/' || metric) INTO v_n FROM public.exp_taxonomy_scorecard(g);
    IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL: % has duplicate (lane, metric) rows', g; END IF;

    SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard(g) WHERE metric = 'active_count';
    IF v_n <> 14 THEN RAISE EXCEPTION 'TEST FAIL: % has % active_count rows, expected 14 lanes', g, v_n; END IF;

    SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard(g) WHERE passed IS NULL OR detail IS NULL OR metric IS NULL OR lane IS NULL;
    IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL: % has % rows with NULL passed/detail/metric/lane', g, v_n; END IF;

    SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard(g) WHERE metric = 'category_in_master' AND value = 1 AND passed;
    IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL: % does not JOIN to gbp_categories', g; END IF;

    -- active_count must equal a direct count per level (JOIN on level; mismatching lanes counted)
    SELECT count(*) INTO v_n
      FROM (SELECT lane, value FROM public.exp_taxonomy_scorecard(g) WHERE metric = 'active_count') s
      FULL JOIN (SELECT level, count(*) AS c FROM public.exp_taxonomy WHERE gcid = g AND is_active GROUP BY level) d ON d.level = s.lane
     WHERE COALESCE(s.value, 0) <> COALESCE(d.c, 0);
    IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL: % active_count disagrees with a direct count on % lanes', g, v_n; END IF;

    IF v_pre THEN
      SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard(g)
       WHERE metric IN ('concept_slug_share', 'concept_link_share') AND (value IS DISTINCT FROM 0 OR passed);
      IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL: % concept metrics must be 0 and failing before 0028 (% offenders)', g, v_n; END IF;
    END IF;
  END LOOP;

  ---------------------------------------------------------------- 3. summary agrees with the scorecard
  SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard_summary(v_gcids);
  IF v_n <> 4 THEN RAISE EXCEPTION 'TEST FAIL: summary returned % rows, expected 4', v_n; END IF;
  FOR r IN SELECT * FROM public.exp_taxonomy_scorecard_summary(v_gcids) LOOP
    SELECT count(*), count(*) FILTER (WHERE passed) INTO v_n, v_p FROM public.exp_taxonomy_scorecard(r.gcid);
    IF r.metrics_total <> v_n OR r.metrics_passed <> v_p OR r.metrics_failed <> v_n - v_p
       OR r.gate_passed IS DISTINCT FROM (v_n = v_p)
       OR COALESCE(cardinality(r.failed_metrics), 0) <> v_n - v_p THEN
      RAISE EXCEPTION 'TEST FAIL: summary for % disagrees with the scorecard (% of % passed vs summary % of %)', r.gcid, v_p, v_n, r.metrics_passed, r.metrics_total;
    END IF;
    SELECT count(*) INTO v_cnt FROM public.exp_taxonomy WHERE gcid = r.gcid AND is_active;
    IF r.active_rows <> v_cnt THEN RAISE EXCEPTION 'TEST FAIL: summary active_rows for % is %, direct count %', r.gcid, r.active_rows, v_cnt; END IF;
    v_msg := v_msg || format(E'SUMMARY %-26s %s | active %s | metrics %s | passed %s | failed %s | rate %s | gate %s\n',
                             r.gcid, r.display_name, r.active_rows, r.metrics_total, r.metrics_passed, r.metrics_failed, r.pass_rate, r.gate_passed);
  END LOOP;

  ---------------------------------------------------------------- 4. unknown gcid degrades, never raises
  SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard('gcid:__no_such_category__') WHERE metric = 'category_in_master' AND value = 0 AND NOT passed;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL: unknown gcid must score category_in_master = 0'; END IF;
  SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard_summary(ARRAY['gcid:__no_such_category__', NULL, 'gcid:__no_such_category__']) WHERE gate_passed = false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL: summary of an unknown gcid (with a NULL and a repeat) must return exactly one failing row'; END IF;

  ---------------------------------------------------------------- 5. BASELINE report (taken before any simulated change)
  FOREACH g IN ARRAY v_gcids LOOP
    v_report := v_report || format(E'== %s (%s metrics)\n', g, (SELECT count(*) FROM public.exp_taxonomy_scorecard(g)));
    FOR r IN SELECT lane, metric, value, target, passed, detail FROM public.exp_taxonomy_scorecard(g) LOOP
      IF v_full OR NOT r.passed THEN
        v_report := v_report || format(E'  %s %s/%s value %s target %s%s\n', CASE WHEN r.passed THEN 'ok  ' ELSE 'FAIL' END, r.lane, r.metric,
                                       COALESCE(r.value::text, 'n/a'), r.target, CASE WHEN v_full THEN ' -- ' || r.detail ELSE '' END);
      END IF;
    END LOOP;
  END LOOP;

  ---------------------------------------------------------------- 6. simulate 0028 + a known pattern on cannabis_store
  IF v_simulate THEN
    ALTER TABLE public.exp_taxonomy
      ADD COLUMN IF NOT EXISTS concept_slug  text,
      ADD COLUMN IF NOT EXISTS volume_source text,
      ADD COLUMN IF NOT EXISTS volume_as_of  date,
      ADD COLUMN IF NOT EXISTS evidence      jsonb;

    -- products: concept_slug = term_slug
    UPDATE public.exp_taxonomy SET concept_slug = term_slug
     WHERE gcid = 'gcid:cannabis_store' AND level = 'product_service' AND is_active;
    -- exactly 10 content titles share the first product's concept
    UPDATE public.exp_taxonomy SET concept_slug = (SELECT term_slug FROM public.exp_taxonomy
                                                    WHERE gcid = 'gcid:cannabis_store' AND level = 'product_service' AND is_active ORDER BY term LIMIT 1)
     WHERE id IN (SELECT id FROM public.exp_taxonomy WHERE gcid = 'gcid:cannabis_store' AND level = 'content_title' AND is_active ORDER BY term LIMIT 10);
    -- every active keyword: volume + source + date 10 days old, except 10 that are 200 days old
    UPDATE public.exp_taxonomy SET search_volume_monthly = 100, volume_source = 'sim', volume_as_of = current_date - 10
     WHERE gcid = 'gcid:cannabis_store' AND level = 'keyword' AND is_active;
    UPDATE public.exp_taxonomy SET volume_as_of = current_date - 200
     WHERE id IN (SELECT id FROM public.exp_taxonomy WHERE gcid = 'gcid:cannabis_store' AND level = 'keyword' AND is_active ORDER BY term LIMIT 10);
    -- 5 questions carry an evidence flag (no volume)
    UPDATE public.exp_taxonomy SET evidence = '{"flag":"manual"}'::jsonb
     WHERE id IN (SELECT id FROM public.exp_taxonomy WHERE gcid = 'gcid:cannabis_store' AND level = 'question' AND is_active ORDER BY term LIMIT 5);

    SELECT value INTO v_val FROM public.exp_taxonomy_scorecard('gcid:cannabis_store') WHERE lane = 'product_service' AND metric = 'concept_slug_share';
    IF v_val IS DISTINCT FROM 1.0000 THEN RAISE EXCEPTION 'TEST FAIL: simulated concept_slug_share expected 1.0000, got %', v_val; END IF;

    SELECT round(10::numeric / count(*), 4) INTO v_exp FROM public.exp_taxonomy WHERE gcid = 'gcid:cannabis_store' AND level = 'content_title' AND is_active;
    SELECT value INTO v_val FROM public.exp_taxonomy_scorecard('gcid:cannabis_store') WHERE lane = 'content_title' AND metric = 'concept_link_share';
    IF v_val IS DISTINCT FROM v_exp THEN RAISE EXCEPTION 'TEST FAIL: simulated concept_link_share expected %, got %', v_exp, v_val; END IF;

    SELECT value INTO v_val FROM public.exp_taxonomy_scorecard('gcid:cannabis_store') WHERE lane = 'keyword' AND metric = 'evidence_coverage';
    IF v_val IS DISTINCT FROM 1.0000 THEN RAISE EXCEPTION 'TEST FAIL: simulated keyword evidence_coverage expected 1.0000, got %', v_val; END IF;
    SELECT value INTO v_val FROM public.exp_taxonomy_scorecard('gcid:cannabis_store') WHERE lane = 'keyword' AND metric = 'volume_provenance';
    IF v_val IS DISTINCT FROM 1.0000 THEN RAISE EXCEPTION 'TEST FAIL: simulated keyword volume_provenance expected 1.0000, got %', v_val; END IF;
    SELECT round(10::numeric / count(*), 4) INTO v_exp FROM public.exp_taxonomy WHERE gcid = 'gcid:cannabis_store' AND level = 'keyword' AND is_active;
    SELECT value INTO v_val FROM public.exp_taxonomy_scorecard('gcid:cannabis_store') WHERE lane = 'keyword' AND metric = 'volume_freshness';
    IF v_val IS DISTINCT FROM v_exp THEN RAISE EXCEPTION 'TEST FAIL: simulated keyword volume_freshness expected %, got %', v_exp, v_val; END IF;
    SELECT count(*) INTO v_n FROM public.exp_taxonomy_scorecard('gcid:cannabis_store') WHERE lane = 'keyword' AND metric = 'volume_freshness' AND NOT passed;
    IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL: a stale share above 0.10 must fail volume_freshness'; END IF;

    SELECT round(5::numeric / count(*), 4) INTO v_exp FROM public.exp_taxonomy WHERE gcid = 'gcid:cannabis_store' AND level = 'question' AND is_active;
    SELECT value INTO v_val FROM public.exp_taxonomy_scorecard('gcid:cannabis_store') WHERE lane = 'question' AND metric = 'evidence_coverage';
    IF v_val IS DISTINCT FROM v_exp THEN RAISE EXCEPTION 'TEST FAIL: simulated question evidence_coverage expected %, got %', v_exp, v_val; END IF;

    v_msg := v_msg || E'SIMULATED 0028 PATTERN on gcid:cannabis_store: every simulated assertion held\n';
    FOR r IN SELECT lane, metric, value, target, passed, detail FROM public.exp_taxonomy_scorecard('gcid:cannabis_store')
              WHERE (lane = 'keyword' AND metric IN ('evidence_coverage', 'volume_provenance', 'volume_freshness'))
                 OR (lane = 'product_service' AND metric = 'concept_slug_share')
                 OR (lane = 'content_title' AND metric = 'concept_link_share')
                 OR (lane = 'question' AND metric = 'evidence_coverage') LOOP
      v_msg := v_msg || format(E'  sim %s/%s value %s target %s passed %s -- %s\n', r.lane, r.metric, r.value, r.target, r.passed, r.detail);
    END LOOP;
  ELSE
    v_msg := v_msg || E'SIMULATION SKIPPED (v_simulate = false): post-0028 paths not exercised\n';
  END IF;

  RAISE EXCEPTION E'SCORECARD TEST OK (rolled back by design)\n%\nBASELINE (before simulation)\n%', v_msg, v_report;
END
$test$;
