-- Search Rank Score v5 — the 10-lane engine from "10-LANE MATH VIEW v5 · 2026-08-17"
-- (src/components/scoring-tab.tsx; method detail in docs/Score_*.md).
--
-- ADDITIVE AND VERSIONED. Adds two new functions; changes nothing that exists:
--   exp_compute_score, exp_compute_score_v2, exp_provisional_score_tick are untouched;
--   no table, column, policy or data change.
--
--   exp_score_v5_explain(p_entity_id uuid, p_entity_type text default 'professional') RETURNS jsonb
--     STABLE, read-only, SECURITY INVOKER. One SQL statement. Returns
--     {version:'v5', gcid, scope, total, lanes:[{lane,max,score,components,inputs}],
--      gaps:[{lane,ring_key,registry_node_id,node_type,label,status,marginal_pts,is_core,evidence_source}]}
--     with gaps sorted by marginal_pts desc.
--   exp_score_v5_persist(p_entity_id uuid, p_entity_type text default 'professional') RETURNS jsonb
--     Calls explain; upserts search_rank_scores (legacy columns filled from the lanes, `gaps` = v5 gaps
--     array) and upserts today's score_history row. Does NOT touch professionals / search_documents
--     (later cutover step). SECURITY DEFINER, guarded (service_role, postgres session, or
--     exp_ctrl_has_role super_admin / architect); EXECUTE revoked from PUBLIC and anon.
--
-- ONE SCORER, ONE PLACE. Every lane formula is written exactly once (CTE `math`) and evaluated over a
-- set of scenarios: scenario 0 = the entity as it is; every other scenario = one gap item satisfied.
-- marginal_pts = total(scenario) - total(base), so a gap's points always come from the same math as
-- the score (cross-lane effects included, e.g. a completeness core item also lifts the Connections gate).
--
-- LANE INPUTS (graph_nodes.ring_key / node_type / schema_property / node_registry_id; never the numeric
-- graph_nodes.ring, never graph_nodes.score_counted):
--   Reviews 187        reviews table (fallback: dated graph `review` nodes) for the 12-month window and
--                      replies; lifetime = max(aggregate_ratings 'all' | sum, review_aggregate node count,
--                      rows); EAR = exp_category_ear.ear_professional (pro scope) | ear (location scope).
--                      Current 140*min(1,RVE/(0.54*EAR)), RVE = n12*star*(1-avg_age/12.5), star = avg/5,
--                      or the <=3-star ladder when >=15% of the window is <=3 stars;
--                      Standing 37*min(1,log10(life)/3.3)*avg/5; Response 10*reply_rate.
--   Completeness 182   182*min(1,node_count/M)*(core_present/core_expected). node_count = all active
--                      graph nodes; M = exp_category_completeness.expected_m. Core rows = registry rows in
--                      scope (entity_scope = scope|shared) with counts_toward_m and ring identity|authority
--                      or required_for_score. Rows are satisfied by node_registry_id first, else by schema
--                      property (k-th ranked row <- k-th ranked node). Credential validity gate: a core row
--                      is satisfied only if the node is valid (not expired / revoked; credentials.valid_until,
--                      is_current) and, where requires_verification, verified and not past refresh_by.
--   Website 102        10 elements x R/C/S (31/43/28). Crawler-gated: reads the website node's
--                      extracted_data.site_audit {confirmed, elements:{key:{r,c,s,applicable}}}; no confirmed
--                      audit => 0. Non-applicable elements drop and the rest renormalise to 102.
--   Articles 103       103*min(1,AVE/EAA); AVE = sum max(0,1-age/18) over article-lane nodes and
--                      exp_voce_article rows authored by the entity. Undated items count 0 (reported).
--   GBP 68             binary: active Google OAuth connection AND Place ID on the entity AND gbp_connected.
--   Directories 90     90*min(1,C/T); C = sum consistency*authority over the category's directories
--                      (exp_category_directory_map + exp_directory_packs tier: 1 => 1.0, 2 => 0.5, 3 => 0.25)
--                      and any listings rows; consistency 1.0 live + NAP match / 0.2 live with mismatch or
--                      drift / 0 not live; x0.5 per rank after T; T = tier-1 count clamped 5..8.
--                      google_business_profile excluded (GBP lane).
--   Q&A 34             34*min(1,answered/EAQ), no decay.
--   Connections 51     min(51, gate*(B1+B2)); gate = completeness core coverage; B1 = 39*sum(w*channel)
--                      over Facebook .30 / Instagram .25 / LinkedIn .25 / X .20, channel = 0 unless OAuth,
--                      else 0.6 + 0.2 complete profile + 0.2 post <=90d; B2 = min(12, 3*sum link scores)
--                      over non-core, non-Google presence links (0.5 present + 0.5 verified).
--   Videos 27          27*min(1,VVE/EAV), 24-month decay.
--   Audio 6            6*min(1,AudioVE/target), 24-month decay, target pro 3 / location 8.
-- Targets: *_professional column for pro scope, base column for location scope; missing row => the spec
-- floor (EAR 50, EAA 18, EAQ 10, EAV 6), reported as default_floor in inputs.
-- Scope: professionals => 'professional'; organizations (office/brand/firm/enterprise) => 'location'.
-- Gap ring_key is the canonical exp_rings key (credentials->authority, media->content, social->presence,
-- transactions->conversion, edge rings->entity_graph).

CREATE OR REPLACE FUNCTION public.exp_score_v5_explain(p_entity_id uuid, p_entity_type text DEFAULT 'professional')
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $fn$
WITH
params AS (SELECT p_entity_id AS eid, coalesce(p_entity_type, 'professional') AS etype),
-- ── entity + category + scope ───────────────────────────────────────────────
ent AS (
  SELECT pa.eid, pa.etype,
         CASE WHEN pa.etype = 'professional' THEN 'professional' ELSE 'location' END AS scope,
         coalesce(p.gcid, o.gcid) AS gcid,
         coalesce(p.website_url, o.website_url) AS website_url,
         coalesce(p.gbp_place_id, o.gbp_place_id) AS place_id,
         coalesce(p.gbp_connected, o.gbp_connected, false) AS gbp_connected,
         (p.id IS NOT NULL OR o.id IS NOT NULL) AS found
  FROM params pa
  LEFT JOIN professionals p ON pa.etype = 'professional' AND p.id = pa.eid
  LEFT JOIN organizations o ON pa.etype = 'organization' AND o.id = pa.eid
),
-- graph ring_key / registry ring -> canonical exp_rings.ring_key (10 rings)
canon_ring AS (
  SELECT k, canon FROM (VALUES ('credentials','authority'), ('media','content'),
                               ('social','presence'), ('transactions','conversion')) v(k, canon)
  UNION ALL
  SELECT ring_key, 'entity_graph' FROM exp_ring WHERE layer = 'edge'
),
-- ── the entity's active graph nodes, normalized ─────────────────────────────
nodes0 AS (
  SELECT g.id, g.ring_key, g.node_type, g.node_registry_id, g.title, g.url, g.source, g.schema_type,
         g.refresh_by, g.extracted_data AS ed,
         coalesce(cr.canon, g.ring_key) AS canon_ring,
         split_part(coalesce(g.schema_property,
           CASE g.node_type WHEN 'credential' THEN 'hasCredential' WHEN 'service' THEN 'makesOffer'
                            WHEN 'service_area' THEN 'areaServed' WHEN 'profile_link' THEN 'sameAs'
                            WHEN 'review' THEN 'review' WHEN 'review_aggregate' THEN 'aggregateRating' END,
           -- platform identity nodes carry 'Label: value' titles and no schema_property
           (SELECT tl.prop FROM (VALUES ('name','name'), ('legal name','legalName'), ('phone','telephone'),
                                        ('email','email'), ('logo','logo'), ('profile photo','image'),
                                        ('about / description','description'), ('bio / about','description'),
                                        ('website','url'), ('address','address'), ('job title','jobTitle'),
                                        ('year started','foundingDate')) tl(lbl, prop)
             WHERE g.node_type = 'identity' AND tl.lbl = lower(trim(split_part(g.title, ':', 1))))), '.', 1) AS prop,
         CASE WHEN g.node_registry_id IS NOT NULL THEN r.owns_lane
              WHEN g.node_type IN ('review', 'review_aggregate') THEN 'reviews'
              WHEN g.node_type ~ '(podcast|audio)' OR g.schema_type IN ('AudioObject','PodcastEpisode','PodcastSeries') THEN 'audio'
              WHEN g.node_type ~ 'video' OR g.schema_type = 'VideoObject' THEN 'videos'
              WHEN g.node_type ~ '(answer|question|qa_)' OR g.schema_type IN ('Answer','Question','QAPage') THEN 'qa'
              WHEN g.node_type ~ '(article|blog|voce)' OR g.schema_type IN ('Article','BlogPosting','NewsArticle') THEN 'articles'
         END AS lane,
         (SELECT min(CASE WHEN t ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])' THEN substr(t, 1, 10)::date END)
            FROM (VALUES (g.extracted_data->>'date'), (g.extracted_data->>'datePublished'),
                         (g.extracted_data->>'published_at'), (g.extracted_data->>'published_on'),
                         (g.extracted_data->>'uploadDate')) d(t)) AS item_date,
         (SELECT min(CASE WHEN t ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])' THEN substr(t, 1, 10)::date END)
            FROM (VALUES (g.extracted_data->>'valid_until'), (g.extracted_data->>'validUntil'),
                         (g.extracted_data->>'expires'), (g.extracted_data->>'expirationDate')) d(t)) AS ed_expires,
         c.valid_until AS cred_valid_until, c.is_current AS cred_is_current,
         (coalesce(g.verified, false) OR coalesce(c.verified, false)) AS verified
  FROM graph_nodes g
  JOIN params pa ON g.entity_id = pa.eid AND g.entity_type = pa.etype
  LEFT JOIN exp_vertical_node_registry r ON r.id = g.node_registry_id
  LEFT JOIN canon_ring cr ON cr.k = g.ring_key
  LEFT JOIN LATERAL (SELECT c1.valid_until, c1.is_current, c1.verified FROM credentials c1
                     WHERE c1.graph_node_id = g.id ORDER BY c1.verified DESC LIMIT 1) c ON true
  WHERE g.is_active
),
nodes AS (
  SELECT n.*,
         NOT (coalesce(coalesce(n.ed_expires, n.cred_valid_until) < current_date, false)
              OR lower(coalesce(n.ed->>'status', '')) IN ('expired','revoked','inactive','suspended','invalid','lapsed')
              OR n.cred_is_current IS FALSE) AS valid,
         (n.verified AND n.refresh_by IS NOT NULL AND n.refresh_by < now()) AS stale,
         CASE WHEN n.item_date IS NULL THEN NULL ELSE (current_date - n.item_date) / 30.4375 END AS age_m
  FROM nodes0 n
),
-- ── Completeness: registry rows in scope that count toward M ────────────────
reg AS (
  SELECT r.id, r.node_slug, r.node_name, r.ring, coalesce(cr.canon, r.ring) AS canon_ring,
         split_part(r.schema_property, '.', 1) AS prop, r.required_for_score, r.requires_verification,
         r.priority, r.connection_method,
         (r.ring IN ('identity', 'authority') OR coalesce(r.required_for_score, false)) AS is_core
  FROM exp_vertical_node_registry r
  JOIN ent e ON r.gcid = e.gcid
  LEFT JOIN canon_ring cr ON cr.k = r.ring
  WHERE r.is_active AND r.counts_toward_m
    AND (r.entity_scope IS NULL OR r.entity_scope IN (e.scope, 'shared'))
),
-- a node linked by node_registry_id satisfies its own row first
reg_direct AS (
  SELECT DISTINCT ON (r.id) r.id AS reg_id, n.id AS node_id
  FROM reg r JOIN nodes n ON n.node_registry_id = r.id
  ORDER BY r.id, n.valid DESC, n.verified DESC, n.stale, n.id
),
-- remaining rows are allocated nodes by schema property: rank k row <- rank k node
reg_ranked AS (
  SELECT r.*, row_number() OVER (PARTITION BY r.prop ORDER BY r.is_core DESC, r.requires_verification DESC,
                                 coalesce(r.required_for_score, false) DESC, r.priority, r.node_slug) AS rk
  FROM reg r WHERE NOT EXISTS (SELECT 1 FROM reg_direct d WHERE d.reg_id = r.id)
),
node_ranked AS (
  SELECT n.*, row_number() OVER (PARTITION BY n.prop ORDER BY n.valid DESC, n.verified DESC, n.stale, n.id) AS rk
  FROM nodes n WHERE n.node_registry_id IS NULL AND n.prop IS NOT NULL
),
reg_match AS (
  SELECT r.id, r.node_slug, r.node_name, r.canon_ring, r.is_core, r.requires_verification, r.connection_method,
         coalesce(d.node_id, nr.id) AS node_id
  FROM reg r
  LEFT JOIN reg_direct d ON d.reg_id = r.id
  LEFT JOIN reg_ranked rr ON rr.id = r.id
  LEFT JOIN node_ranked nr ON d.node_id IS NULL AND nr.prop = rr.prop AND nr.rk = rr.rk
),
reg_status AS (
  SELECT m.*, n.node_type, n.source,
         CASE WHEN n.id IS NULL THEN 'missing'
              WHEN NOT m.is_core THEN 'ok'
              WHEN NOT n.valid THEN 'invalid'
              WHEN m.requires_verification AND NOT n.verified THEN 'unverified'
              WHEN m.requires_verification AND n.stale THEN 'stale'
              ELSE 'ok' END AS status
  FROM reg_match m LEFT JOIN nodes n ON n.id = m.node_id
),
comp_in AS (
  SELECT (SELECT count(*) FROM nodes)::numeric AS nc,
         coalesce((SELECT cc.expected_m FROM exp_category_completeness cc JOIN ent e ON cc.gcid = e.gcid),
                  (SELECT count(*) FROM reg))::numeric AS m,
         ((SELECT cc.expected_m FROM exp_category_completeness cc JOIN ent e ON cc.gcid = e.gcid) IS NULL) AS m_fallback,
         (SELECT count(*) FROM reg_status WHERE is_core)::numeric AS ce,
         (SELECT count(*) FROM reg_status WHERE is_core AND status = 'ok')::numeric AS cp,
         (SELECT count(*) FROM reg)::numeric AS reg_rows,
         (SELECT count(*) FROM reg_status WHERE NOT is_core AND status = 'ok')::numeric AS noncore_ok,
         (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM reg_status WHERE is_core GROUP BY 1) s) AS core_by_status
),
-- ── Reviews ─────────────────────────────────────────────────────────────────
rv_tab AS (
  SELECT rv.rating::numeric AS rating, rv.review_date AS d, (rv.reply_body IS NOT NULL) AS replied
  FROM reviews rv JOIN params pa ON rv.entity_id = pa.eid AND rv.entity_type = pa.etype
),
rv_items AS (
  SELECT rating, d, replied FROM rv_tab
  UNION ALL
  SELECT CASE WHEN n.ed->>'rating' ~ '^\d+(\.\d+)?$' THEN (n.ed->>'rating')::numeric END, n.item_date,
         (n.ed ? 'reply' OR n.ed ? 'reply_body')
  FROM nodes n
  WHERE n.node_type = 'review' AND n.item_date IS NOT NULL AND NOT EXISTS (SELECT 1 FROM rv_tab)
),
rv_agg AS (
  SELECT CASE WHEN bool_or(source = 'all') THEN max(review_count) FILTER (WHERE source = 'all') ELSE sum(review_count) END AS life,
         CASE WHEN bool_or(source = 'all') THEN max(rating_value) FILTER (WHERE source = 'all')
              ELSE sum(rating_value * review_count) / nullif(sum(review_count) FILTER (WHERE rating_value IS NOT NULL), 0) END AS lavg
  FROM aggregate_ratings a JOIN params pa ON a.entity_id = pa.eid AND a.entity_type = pa.etype
),
rv_node_agg AS (
  SELECT max(CASE WHEN ed->>'count' ~ '^\d+$' THEN (ed->>'count')::numeric END) AS life,
         max(CASE WHEN ed->>'avg_rating' ~ '^\d+(\.\d+)?$' THEN (ed->>'avg_rating')::numeric END) AS lavg
  FROM nodes WHERE node_type = 'review_aggregate'
),
rv_in AS (
  SELECT count(*) FILTER (WHERE w12)::numeric AS n12,
         coalesce(sum(rating / 5.0) FILTER (WHERE w12), 0) AS sr,
         coalesce(sum(CASE WHEN rating <= 3 THEN 0 ELSE rating / 5.0 END) FILTER (WHERE w12), 0) AS sl,
         count(*) FILTER (WHERE w12 AND rating <= 3)::numeric AS nl,
         coalesce(sum((current_date - d) / 30.4375) FILTER (WHERE w12), 0) AS agesum,
         greatest(coalesce((SELECT life FROM rv_agg), 0), coalesce((SELECT life FROM rv_node_agg), 0),
                  count(*), (SELECT count(*) FROM nodes WHERE node_type = 'review'))::numeric AS life,
         coalesce((SELECT lavg FROM rv_agg), (SELECT lavg FROM rv_node_agg), avg(rating), 0) AS lavg,
         count(*)::numeric AS total,
         count(*) FILTER (WHERE replied)::numeric AS replied,
         (SELECT CASE WHEN e.scope = 'professional' THEN coalesce(t.ear_professional, t.ear) ELSE t.ear END
            FROM ent e JOIN exp_category_ear t ON t.gcid = e.gcid) AS ear_row,
         (SELECT t.non_reviewable FROM ent e JOIN exp_category_ear t ON t.gcid = e.gcid) AS non_reviewable,
         CASE WHEN EXISTS (SELECT 1 FROM rv_tab) THEN 'reviews' WHEN count(*) > 0 THEN 'graph_nodes' ELSE 'none' END AS item_source
  FROM (SELECT rating, d, replied, (d > current_date - interval '12 months' AND rating IS NOT NULL) AS w12 FROM rv_items) x
),
-- ── content lanes (Articles 18-mo, Videos/Audio 24-mo, Q&A no decay) ────────
vol_items AS (
  SELECT lane, age_m, id::text AS item_id FROM nodes WHERE lane IN ('articles', 'videos', 'audio', 'qa')
  UNION ALL
  SELECT 'articles', (current_date - va.published_on) / 30.4375, va.id::text
  FROM exp_voce_article va JOIN params pa ON va.author_entity_id = pa.eid
  WHERE coalesce(va.author_entity_type, pa.etype) = pa.etype
),
vol_in AS (
  SELECT coalesce(sum(greatest(0, 1 - age_m / 18)) FILTER (WHERE lane = 'articles' AND age_m IS NOT NULL), 0) AS art_ve,
         count(*) FILTER (WHERE lane = 'articles') AS art_n,
         count(*) FILTER (WHERE lane = 'articles' AND age_m IS NULL) AS art_undated,
         count(*) FILTER (WHERE lane = 'qa')::numeric AS qa_n,
         coalesce(sum(greatest(0, 1 - age_m / 24)) FILTER (WHERE lane = 'videos' AND age_m IS NOT NULL), 0) AS vid_ve,
         count(*) FILTER (WHERE lane = 'videos') AS vid_n,
         count(*) FILTER (WHERE lane = 'videos' AND age_m IS NULL) AS vid_undated,
         coalesce(sum(greatest(0, 1 - age_m / 24)) FILTER (WHERE lane = 'audio' AND age_m IS NOT NULL), 0) AS aud_ve,
         count(*) FILTER (WHERE lane = 'audio') AS aud_n,
         count(*) FILTER (WHERE lane = 'audio' AND age_m IS NULL) AS aud_undated
  FROM vol_items
),
targets AS (
  SELECT
    (SELECT CASE WHEN e.scope = 'professional' THEN coalesce(t.eaa_professional, t.eaa) ELSE t.eaa END FROM exp_category_eaa t WHERE t.gcid = e.gcid) AS eaa_row,
    (SELECT CASE WHEN e.scope = 'professional' THEN coalesce(t.eaq_professional, t.eaq) ELSE t.eaq END FROM exp_category_eaq t WHERE t.gcid = e.gcid) AS eaq_row,
    (SELECT CASE WHEN e.scope = 'professional' THEN coalesce(t.eav_professional, t.eav) ELSE t.eav END FROM exp_category_eav t WHERE t.gcid = e.gcid) AS eav_row,
    CASE WHEN e.scope = 'professional' THEN 3 ELSE 8 END::numeric AS eau
  FROM ent e
),
-- ── Website + Schema: 10 elements x R/C/S, crawler-gated ────────────────────
web_el(el_key, el_label, pr, pc, ps, ord) AS (VALUES
  ('identity_nap', 'Identity / NAP', 2, 8, 2, 1), ('reviews', 'Reviews', 6, 6, 4, 2),
  ('services', 'Services / Products', 6, 6, 4, 3), ('credentials', 'Credentials', 3, 6, 3, 4),
  ('hours', 'Hours', 2, 3, 1, 5), ('about', 'About / Expertise', 3, 3, 2, 6),
  ('media', 'Media / Photos', 4, 1, 1, 7), ('structured_data', 'Structured Data', 0, 6, 8, 8),
  ('social_links', 'Social links', 2, 2, 1, 9), ('cta', 'Conversion / CTA', 3, 2, 2, 10)),
web_node AS (
  SELECT n.id, n.source, n.ed->'site_audit' AS audit
  FROM nodes n WHERE n.node_type = 'website' OR (n.prop = 'url' AND n.canon_ring IN ('presence', 'identity'))
  ORDER BY coalesce(n.ed ? 'site_audit', false) DESC, n.verified DESC, n.id LIMIT 1
),
web_checks AS (
  SELECT w.el_key, w.el_label, w.ord, c.chk, c.pts::numeric AS pts,
         coalesce((SELECT wn.audit->'elements'->w.el_key->>'applicable' FROM web_node wn), 'true') <> 'false' AS applicable,
         least(1, greatest(0, coalesce((SELECT CASE WHEN wn.audit->'elements'->w.el_key->>c.chk ~ '^\d+(\.\d+)?$'
                                                    THEN (wn.audit->'elements'->w.el_key->>c.chk)::numeric END FROM web_node wn), 0))) AS frac
  FROM web_el w CROSS JOIN LATERAL (VALUES ('r', w.pr), ('c', w.pc), ('s', w.ps)) c(chk, pts)
),
web_in AS (
  SELECT coalesce((SELECT wn.audit->>'confirmed' = 'true' FROM web_node wn), false) AS confirmed,
         (SELECT count(*) FROM web_node) > 0 OR (SELECT website_url FROM ent) IS NOT NULL AS has_site,
         coalesce(sum(pts * frac) FILTER (WHERE applicable), 0) AS web_sum,
         coalesce(sum(pts) FILTER (WHERE applicable), 0) AS web_app
  FROM web_checks
),
-- ── Directories: listings consistency x authority, Google excluded ──────────
dir_keys AS (
  SELECT m.directory_key FROM exp_category_directory_map m JOIN ent e ON m.gcid = e.gcid
  WHERE m.is_active AND m.directory_key <> 'google_business_profile'
  UNION
  SELECT l.directory_key FROM listings l JOIN params pa ON l.entity_id = pa.eid AND l.entity_type = pa.etype
  WHERE l.directory_key <> 'google_business_profile'
),
dir_items AS (
  SELECT k.directory_key, coalesce(p.directory_name, l.directory_name, k.directory_key) AS directory_name,
         coalesce(p.tier, 3) AS tier,
         CASE coalesce(p.tier, 3) WHEN 1 THEN 1.0 WHEN 2 THEN 0.5 ELSE 0.25 END AS auth,
         l.status,
         CASE WHEN l.status IN ('published', 'claimed') THEN
                CASE WHEN coalesce(l.has_drift, false) OR l.name_match IS FALSE OR l.phone_match IS FALSE
                          OR l.address_match IS FALSE THEN 0.2 ELSE 1.0 END
              ELSE 0 END AS cons
  FROM dir_keys k
  LEFT JOIN exp_directory_packs p ON p.directory_key = k.directory_key
  LEFT JOIN listings l ON l.directory_key = k.directory_key
        AND l.entity_id = (SELECT eid FROM params) AND l.entity_type = (SELECT etype FROM params)
),
dir_t AS (SELECT greatest(5, least(8, count(*) FILTER (WHERE tier = 1)))::numeric AS t FROM dir_items),
dir_scen_c AS (
  SELECT s.k, coalesce(sum(x.c * CASE WHEN x.rk <= t.t THEN 1 ELSE power(0.5, x.rk - t.t) END), 0) AS c
  FROM (SELECT NULL::text AS k UNION ALL SELECT directory_key FROM dir_items WHERE cons < 1) s
  CROSS JOIN dir_t t
  LEFT JOIN LATERAL (
    SELECT z.c, row_number() OVER (ORDER BY z.c DESC, z.directory_key) AS rk
    FROM (SELECT di.directory_key, CASE WHEN di.directory_key = s.k THEN di.auth ELSE di.auth * di.cons END AS c
          FROM dir_items di) z) x ON true
  GROUP BY s.k
),
-- ── GBP: verified OAuth + confirmed Place ID ────────────────────────────────
gbp_in AS (
  SELECT EXISTS (SELECT 1 FROM oauth_connections oc JOIN params pa ON oc.entity_id = pa.eid
                 WHERE coalesce(oc.is_active, false)
                   AND lower(oc.provider) ~ '(google|gbp|gmb|business_profile)') AS oauth,
         e.place_id IS NOT NULL AS place_confirmed,
         coalesce(e.place_id, (SELECT n.title FROM nodes n WHERE n.node_type = 'gbp_place' LIMIT 1)) AS place_known,
         e.gbp_connected
  FROM ent e
),
-- ── Connections: B1 OAuth core channels (39) + B2 link channels (cap 12) ────
core_ch(ch, label, w, pat) AS (VALUES
  ('facebook', 'Facebook', 0.30, 'facebook'), ('instagram', 'Instagram', 0.25, 'instagram'),
  ('linkedin', 'LinkedIn', 0.25, 'linkedin'), ('x', 'X (Twitter)', 0.20, '(twitter|//(www\.)?x\.com)')),
pres_nodes AS (
  SELECT n.*, lower(coalesce(n.ed->>'platform', n.title, '')) AS platform,
         lower(coalesce(n.ed->>'platform', '') || ' ' || coalesce(n.title, '') || ' ' || coalesce(n.url, '') || ' ' || coalesce(n.ed->>'url', '')) AS hay
  FROM nodes n
  WHERE n.canon_ring = 'presence' AND n.node_type <> 'website'
    AND (n.node_type IN ('profile_link', 'social_profile') OR n.prop = 'sameAs')
),
core_in AS (
  SELECT c.ch, c.label, c.w,
         EXISTS (SELECT 1 FROM oauth_connections oc JOIN params pa ON oc.entity_id = pa.eid
                 WHERE coalesce(oc.is_active, false) AND lower(oc.provider) ~ c.pat) AS oauth,
         EXISTS (SELECT 1 FROM pres_nodes pn WHERE pn.hay ~ c.pat) AS linked,
         CASE WHEN EXISTS (SELECT 1 FROM pres_nodes pn WHERE pn.hay ~ c.pat AND pn.ed ? 'bio'
                           AND (pn.ed ? 'link' OR pn.ed ? 'website') AND (pn.ed ? 'photo' OR pn.ed ? 'image'))
              THEN 0.2 ELSE 0 END AS complete,
         CASE WHEN EXISTS (SELECT 1 FROM nodes n WHERE n.lane = 'connections' AND n.node_type ~ 'post'
                           AND n.age_m IS NOT NULL AND n.age_m <= 90 / 30.4375
                           AND lower(coalesce(n.title, '') || ' ' || coalesce(n.url, '')) ~ c.pat)
              THEN 0.2 ELSE 0 END AS recent,
         (SELECT pn.source FROM pres_nodes pn WHERE pn.hay ~ c.pat LIMIT 1) AS src
  FROM core_ch c
),
link_in AS (
  SELECT pn.platform AS ch, max(pn.title) AS label,
         max(CASE WHEN pn.url IS NOT NULL OR pn.ed ? 'url' OR pn.verified THEN 0.5 ELSE 0 END
             + CASE WHEN pn.verified THEN 0.5 ELSE 0 END) AS s,
         max(pn.source) AS src
  FROM pres_nodes pn
  WHERE NOT EXISTS (SELECT 1 FROM core_ch c WHERE pn.hay ~ c.pat)
    AND pn.hay !~ '(google|g\.page|goo\.gl|gbp)'
    AND pn.platform NOT IN ('', 'website')
  GROUP BY pn.platform
),
conn_in AS (
  SELECT coalesce((SELECT sum(39 * w * CASE WHEN oauth THEN 0.6 + complete + recent ELSE 0 END) FROM core_in), 0) AS b1,
         coalesce((SELECT sum(s) FROM link_in), 0) AS l
),
-- ── one row of base inputs for every lane ───────────────────────────────────
base AS (
  SELECT r.n12 AS rv_n12, r.sr AS rv_sr, r.sl AS rv_sl, r.nl AS rv_nl, r.agesum AS rv_agesum,
         r.life AS rv_life, r.lavg AS rv_lavg, r.total AS rv_total, r.replied AS rv_replied,
         coalesce(r.ear_row, 50) AS ear,
         c.nc, c.m, c.ce, c.cp,
         w.confirmed AS web_confirmed, w.web_sum, w.web_app,
         v.art_ve, coalesce(t.eaa_row, 18) AS eaa,
         CASE WHEN g.oauth AND g.place_confirmed AND g.gbp_connected THEN 1 ELSE 0 END AS gbp_ok,
         coalesce((SELECT d.c FROM dir_scen_c d WHERE d.k IS NULL), 0) AS dir_c, dt.t AS dir_t,
         v.qa_n, coalesce(t.eaq_row, 10) AS eaq,
         cn.b1 AS conn_b1, cn.l AS conn_l,
         v.vid_ve, coalesce(t.eav_row, 6) AS eav,
         v.aud_ve, t.eau
  FROM rv_in r, comp_in c, web_in w, vol_in v, targets t, gbp_in g, dir_t dt, conn_in cn
),
-- ── scenarios: 'base' + one row per gap with that item satisfied ────────────
scen AS (
  SELECT 0 AS sid, NULL::text AS lane, NULL::text AS ring_key, NULL::uuid AS registry_node_id, NULL::text AS node_type,
         NULL::text AS label, NULL::text AS status, false AS is_core, NULL::text AS evidence_source,
         '{}'::jsonb AS ov, '{}'::jsonb AS extra
  UNION ALL
  -- Reviews: one new 5-star review today, replied
  SELECT 1, 'reviews', 'reputation', NULL, 'review', 'Earn a new 5-star review (and reply to it)', 'missing', false,
         CASE WHEN b.rv_total > 0 THEN 'reviews' ELSE 'aggregate_ratings' END,
         jsonb_build_object('rv_n12', b.rv_n12 + 1, 'rv_sr', b.rv_sr + 1, 'rv_sl', b.rv_sl + 1,
                            'rv_life', b.rv_life + 1, 'rv_lavg', (b.rv_lavg * b.rv_life + 5) / (b.rv_life + 1),
                            'rv_total', b.rv_total + 1, 'rv_replied', b.rv_replied + 1), '{}'::jsonb
  FROM base b
  UNION ALL
  SELECT 2, 'reviews', 'reputation', NULL, 'review_reply',
         'Reply to ' || (b.rv_total - b.rv_replied)::int || ' unanswered review(s)', 'missing', false, 'reviews',
         jsonb_build_object('rv_replied', b.rv_total), jsonb_build_object('unreplied', b.rv_total - b.rv_replied)
  FROM base b WHERE b.rv_total > b.rv_replied
  UNION ALL
  -- Completeness: each unsatisfied registry row
  SELECT 100 + row_number() OVER (ORDER BY s.node_slug), 'completeness', s.canon_ring, s.id, s.node_slug, s.node_name, s.status,
         s.is_core, coalesce(s.source, s.connection_method),
         jsonb_build_object('nc', b.nc + CASE WHEN s.node_id IS NULL THEN 1 ELSE 0 END,
                            'cp', b.cp + CASE WHEN s.is_core THEN 1 ELSE 0 END), '{}'::jsonb
  FROM reg_status s, base b WHERE s.status <> 'ok'
  UNION ALL
  -- Website: crawler gate, then each element check below 1
  SELECT 3, 'website', 'identity', NULL, 'website', 'Confirm your website for crawling (unlocks Website + Schema)',
         CASE WHEN w.has_site THEN 'unverified' ELSE 'missing' END, false, 'site_audit',
         jsonb_build_object('web_confirmed', true), jsonb_build_object('unlocks_max', 102)
  FROM web_in w WHERE NOT w.confirmed
  UNION ALL
  SELECT 1000 + c.ord * 10 + CASE c.chk WHEN 'r' THEN 1 WHEN 'c' THEN 2 ELSE 3 END, 'website', 'identity', NULL, 'website_element',
         'Website ' || c.el_label || ': ' || CASE c.chk WHEN 'r' THEN 'richness' WHEN 'c' THEN 'consistency with graph' ELSE 'schema markup' END,
         CASE WHEN c.frac = 0 THEN 'missing' ELSE 'invalid' END, false, 'site_audit',
         jsonb_build_object('web_sum', w.web_sum + c.pts * (1 - c.frac)), jsonb_build_object('element', c.el_key, 'check', c.chk)
  FROM web_checks c, web_in w WHERE w.confirmed AND c.applicable AND c.pts > 0 AND c.frac < 1
  UNION ALL
  SELECT 4, 'articles', 'content', NULL, 'article', 'Publish an on-category article', 'missing', false, 'graph_nodes',
         jsonb_build_object('art_ve', b.art_ve + 1), '{}'::jsonb FROM base b
  UNION ALL
  SELECT 5, 'gbp', 'presence', NULL, 'gbp_place',
         CASE WHEN g.place_known IS NOT NULL THEN 'Verify ownership of your Google Business Profile (OAuth)'
              ELSE 'Connect and verify your Google Business Profile' END,
         CASE WHEN g.oauth OR g.place_known IS NOT NULL THEN 'unverified' ELSE 'missing' END, false, 'oauth_connections',
         jsonb_build_object('gbp_ok', 1), '{}'::jsonb
  FROM gbp_in g, base b WHERE b.gbp_ok = 0
  UNION ALL
  SELECT 2000 + row_number() OVER (ORDER BY di.directory_key), 'directories', 'presence', NULL, di.directory_key,
         CASE WHEN di.cons > 0 THEN 'Fix NAP mismatch on ' ELSE 'Publish a consistent listing on ' END || di.directory_name,
         CASE WHEN di.cons > 0 OR di.status = 'error' THEN 'invalid' ELSE 'missing' END, false, 'listings',
         jsonb_build_object('dir_c', d.c), jsonb_build_object('tier', di.tier)
  FROM dir_items di JOIN dir_scen_c d ON d.k = di.directory_key
  UNION ALL
  SELECT 6, 'qa', 'content', NULL, 'qa_answer', 'Answer an on-category question', 'missing', false, 'graph_nodes',
         jsonb_build_object('qa_n', b.qa_n + 1), '{}'::jsonb FROM base b
  UNION ALL
  SELECT 3000 + row_number() OVER (ORDER BY c.ch), 'connections', 'presence', NULL, 'oauth_' || c.ch,
         'OAuth-connect ' || c.label, CASE WHEN c.linked THEN 'unverified' ELSE 'missing' END, false,
         coalesce(c.src, 'oauth_connections'),
         jsonb_build_object('conn_b1', b.conn_b1 + 39 * c.w * (0.6 + c.complete + c.recent)), '{}'::jsonb
  FROM core_in c, base b WHERE NOT c.oauth
  UNION ALL
  SELECT 4000 + row_number() OVER (ORDER BY li.ch), 'connections', 'presence', NULL, 'link_channel',
         'Verify your ' || li.label || ' link', 'unverified', false, coalesce(li.src, 'graph_nodes'),
         jsonb_build_object('conn_l', b.conn_l + (1 - li.s)), '{}'::jsonb
  FROM link_in li, base b WHERE li.s < 1
  UNION ALL
  SELECT 7, 'videos', 'content', NULL, 'video', 'Publish an on-category video', 'missing', false, 'graph_nodes',
         jsonb_build_object('vid_ve', b.vid_ve + 1), '{}'::jsonb FROM base b
  UNION ALL
  SELECT 8, 'audio', 'content', NULL, 'audio', 'Publish a podcast or audio episode', 'missing', false, 'graph_nodes',
         jsonb_build_object('aud_ve', b.aud_ve + 1), '{}'::jsonb FROM base b
),
merged AS (
  SELECT s.*,
    coalesce((s.ov->>'rv_n12')::numeric, b.rv_n12) AS rv_n12, coalesce((s.ov->>'rv_sr')::numeric, b.rv_sr) AS rv_sr,
    coalesce((s.ov->>'rv_sl')::numeric, b.rv_sl) AS rv_sl, b.rv_nl, b.rv_agesum,
    coalesce((s.ov->>'rv_life')::numeric, b.rv_life) AS rv_life, coalesce((s.ov->>'rv_lavg')::numeric, b.rv_lavg) AS rv_lavg,
    coalesce((s.ov->>'rv_total')::numeric, b.rv_total) AS rv_total, coalesce((s.ov->>'rv_replied')::numeric, b.rv_replied) AS rv_replied,
    b.ear,
    coalesce((s.ov->>'nc')::numeric, b.nc) AS nc, b.m, b.ce, coalesce((s.ov->>'cp')::numeric, b.cp) AS cp,
    coalesce((s.ov->>'web_confirmed')::boolean, b.web_confirmed) AS web_confirmed,
    coalesce((s.ov->>'web_sum')::numeric, b.web_sum) AS web_sum, b.web_app,
    coalesce((s.ov->>'art_ve')::numeric, b.art_ve) AS art_ve, b.eaa,
    coalesce((s.ov->>'gbp_ok')::numeric, b.gbp_ok) AS gbp_ok,
    coalesce((s.ov->>'dir_c')::numeric, b.dir_c) AS dir_c, b.dir_t,
    coalesce((s.ov->>'qa_n')::numeric, b.qa_n) AS qa_n, b.eaq,
    coalesce((s.ov->>'conn_b1')::numeric, b.conn_b1) AS conn_b1, coalesce((s.ov->>'conn_l')::numeric, b.conn_l) AS conn_l,
    coalesce((s.ov->>'vid_ve')::numeric, b.vid_ve) AS vid_ve, b.eav,
    coalesce((s.ov->>'aud_ve')::numeric, b.aud_ve) AS aud_ve, b.eau
  FROM scen s CROSS JOIN base b
),
-- ── THE MATH: every lane formula appears exactly once, evaluated per scenario ─
math1 AS (
  SELECT m.*,
    CASE WHEN m.rv_n12 > 0 THEN CASE WHEN m.rv_nl / m.rv_n12 >= 0.15 THEN m.rv_sl ELSE m.rv_sr END / m.rv_n12 ELSE 0 END AS rv_star,
    CASE WHEN m.rv_n12 > 0 THEN m.rv_agesum / m.rv_n12 ELSE 0 END AS rv_age,
    CASE WHEN m.ce > 0 THEN m.cp / m.ce ELSE 1 END AS core_cov,
    CASE WHEN m.m > 0 THEN least(1, m.nc / m.m) ELSE 0 END AS vol_ratio,
    least(12, 3 * m.conn_l) AS conn_b2
  FROM merged m
),
math2 AS (
  SELECT x.*,
    x.rv_n12 * x.rv_star * greatest(0, 1 - x.rv_age / 12.5) AS rve
  FROM math1 x
),
math AS (
  SELECT y.*,
    140 * least(1, y.rve / nullif(0.54 * y.ear, 0)) AS s_rv_current,
    CASE WHEN y.rv_life >= 1 THEN 37 * least(1, log(y.rv_life) / 3.3) * least(1, y.rv_lavg / 5) ELSE 0 END AS s_rv_standing,
    CASE WHEN y.rv_total > 0 THEN 10 * y.rv_replied / y.rv_total ELSE 0 END AS s_rv_response,
    182 * y.vol_ratio * y.core_cov AS s_completeness,
    CASE WHEN y.web_confirmed AND y.web_app > 0 THEN 102 * y.web_sum / y.web_app ELSE 0 END AS s_website,
    coalesce(103 * least(1, y.art_ve / nullif(y.eaa, 0)), 0) AS s_articles,
    68 * y.gbp_ok AS s_gbp,
    coalesce(90 * least(1, y.dir_c / nullif(y.dir_t, 0)), 0) AS s_directories,
    coalesce(34 * least(1, y.qa_n / nullif(y.eaq, 0)), 0) AS s_qa,
    least(51, y.core_cov * (y.conn_b1 + y.conn_b2)) AS s_connections,
    coalesce(27 * least(1, y.vid_ve / nullif(y.eav, 0)), 0) AS s_videos,
    coalesce(6 * least(1, y.aud_ve / nullif(y.eau, 0)), 0) AS s_audio
  FROM math2 y
),
scored AS (
  SELECT z.*, coalesce(z.s_rv_current, 0) + z.s_rv_standing + z.s_rv_response AS s_reviews,
         coalesce(z.s_rv_current, 0) + z.s_rv_standing + z.s_rv_response + z.s_completeness + z.s_website + z.s_articles
           + z.s_gbp + z.s_directories + z.s_qa + z.s_connections + z.s_videos + z.s_audio AS s_total
  FROM math z
),
b AS (SELECT * FROM scored WHERE sid = 0),
gaps AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lane', s.lane, 'ring_key', s.ring_key, 'registry_node_id', s.registry_node_id, 'node_type', s.node_type,
           'label', s.label, 'status', s.status, 'marginal_pts', round(s.s_total - b.s_total, 2),
           'is_core', s.is_core, 'evidence_source', s.evidence_source) || s.extra
         ORDER BY round(s.s_total - b.s_total, 2) DESC, s.is_core DESC, s.lane, s.sid), '[]'::jsonb) AS arr
  FROM scored s CROSS JOIN b
  WHERE s.sid <> 0 AND (round(s.s_total - b.s_total, 2) > 0 OR s.extra ? 'unlocks_max')
)
SELECT CASE WHEN NOT e.found THEN
  jsonb_build_object('version', 'v5', 'entity_id', e.eid, 'entity_type', e.etype, 'error', 'entity_not_found')
ELSE jsonb_build_object(
  'version', 'v5', 'spec', '10-LANE MATH VIEW v5 · 2026-08-17',
  'entity_id', e.eid, 'entity_type', e.etype, 'gcid', e.gcid, 'scope', e.scope,
  'total', round(b.s_total, 2), 'max', 850, 'computed_at', now(),
  'lanes', jsonb_build_array(
    jsonb_build_object('lane', 'reviews', 'max', 187, 'score', round(b.s_reviews, 2),
      'components', jsonb_build_object('current', round(coalesce(b.s_rv_current, 0), 2), 'standing', round(b.s_rv_standing, 2),
                                       'response', round(b.s_rv_response, 2), 'rve', round(b.rve, 3),
                                       'star_factor', round(b.rv_star, 3), 'star_ladder', b.rv_n12 > 0 AND b.rv_nl / b.rv_n12 >= 0.15,
                                       'avg_age_months', round(b.rv_age, 2)),
      'inputs', jsonb_build_object('reviews_12mo', b.rv_n12, 'lifetime', b.rv_life, 'lifetime_avg', round(b.rv_lavg, 2),
                                   'reply_rate', CASE WHEN b.rv_total > 0 THEN round(b.rv_replied / b.rv_total, 3) END,
                                   'ear', b.ear, 'ear_source', CASE WHEN r.ear_row IS NULL THEN 'default_floor' ELSE 'exp_category_ear.' || CASE WHEN e.scope = 'professional' THEN 'ear_professional' ELSE 'ear' END END,
                                   'non_reviewable', r.non_reviewable, 'item_source', r.item_source)),
    jsonb_build_object('lane', 'completeness', 'max', 182, 'score', round(b.s_completeness, 2),
      'components', jsonb_build_object('volume_ratio', round(b.vol_ratio, 4), 'core_coverage', round(b.core_cov, 4)),
      'inputs', jsonb_build_object('node_count', b.nc, 'm', b.m, 'm_source', CASE WHEN c.m_fallback THEN 'registry_row_count' ELSE 'exp_category_completeness.expected_m' END,
                                   'core_present', b.cp, 'core_expected', b.ce, 'core_by_status', c.core_by_status,
                                   'registry_rows_in_scope', c.reg_rows, 'noncore_present', c.noncore_ok)),
    jsonb_build_object('lane', 'website', 'max', 102, 'score', round(b.s_website, 2),
      'components', jsonb_build_object('confirmed', b.web_confirmed, 'weighted_sum', round(b.web_sum, 3), 'applicable_pts', b.web_app,
        'elements', (SELECT jsonb_object_agg(el_key, jsonb_build_object('r', fr, 'c', fc, 's', fs, 'applicable', app))
                     FROM (SELECT el_key, bool_and(applicable) app,
                                  max(frac) FILTER (WHERE chk = 'r') fr, max(frac) FILTER (WHERE chk = 'c') fc,
                                  max(frac) FILTER (WHERE chk = 's') fs FROM web_checks GROUP BY el_key) we)),
      'inputs', jsonb_build_object('has_site', w.has_site, 'website_url', e.website_url, 'site_audit', (SELECT wn.audit IS NOT NULL FROM web_node wn))),
    jsonb_build_object('lane', 'articles', 'max', 103, 'score', round(b.s_articles, 2),
      'components', jsonb_build_object('ave', round(b.art_ve, 3), 'ratio', round(least(1, b.art_ve / nullif(b.eaa, 0)), 4)),
      'inputs', jsonb_build_object('items', v.art_n, 'undated_items', v.art_undated, 'eaa', b.eaa, 'eaa_source', CASE WHEN t.eaa_row IS NULL THEN 'default_floor' ELSE 'exp_category_eaa' END, 'decay_months', 18)),
    jsonb_build_object('lane', 'gbp', 'max', 68, 'score', round(b.s_gbp, 2),
      'components', jsonb_build_object('verified', b.gbp_ok = 1),
      'inputs', jsonb_build_object('oauth_connected', g.oauth, 'place_id_confirmed', g.place_confirmed, 'place_id_known', g.place_known IS NOT NULL, 'gbp_connected_flag', g.gbp_connected)),
    jsonb_build_object('lane', 'directories', 'max', 90, 'score', round(b.s_directories, 2),
      'components', jsonb_build_object('c', round(b.dir_c, 3), 't', b.dir_t),
      'inputs', jsonb_build_object('category_directories', (SELECT count(*) FROM dir_items),
                                   'listings_live', (SELECT count(*) FROM dir_items WHERE status IN ('published', 'claimed')),
                                   'listings_consistent', (SELECT count(*) FROM dir_items WHERE cons = 1),
                                   'google_excluded', true)),
    jsonb_build_object('lane', 'qa', 'max', 34, 'score', round(b.s_qa, 2),
      'components', jsonb_build_object('ratio', round(least(1, b.qa_n / nullif(b.eaq, 0)), 4)),
      'inputs', jsonb_build_object('answered', b.qa_n, 'eaq', b.eaq, 'eaq_source', CASE WHEN t.eaq_row IS NULL THEN 'default_floor' ELSE 'exp_category_eaq' END, 'decay', 'none')),
    jsonb_build_object('lane', 'connections', 'max', 51, 'score', round(b.s_connections, 2),
      'components', jsonb_build_object('gate', round(b.core_cov, 4), 'bucket1', round(b.conn_b1, 3), 'bucket2', round(b.conn_b2, 3)),
      'inputs', jsonb_build_object('core_channels', (SELECT jsonb_object_agg(ch, jsonb_build_object('oauth', oauth, 'linked', linked)) FROM core_in),
                                   'link_channels', (SELECT coalesce(jsonb_object_agg(ch, s), '{}'::jsonb) FROM link_in),
                                   'status', 'spec_not_built_upstream: OAuth inputs absent, computed from available inputs')),
    jsonb_build_object('lane', 'videos', 'max', 27, 'score', round(b.s_videos, 2),
      'components', jsonb_build_object('vve', round(b.vid_ve, 3), 'ratio', round(least(1, b.vid_ve / nullif(b.eav, 0)), 4)),
      'inputs', jsonb_build_object('items', v.vid_n, 'undated_items', v.vid_undated, 'eav', b.eav, 'eav_source', CASE WHEN t.eav_row IS NULL THEN 'default_floor' ELSE 'exp_category_eav' END, 'decay_months', 24)),
    jsonb_build_object('lane', 'audio', 'max', 6, 'score', round(b.s_audio, 2),
      'components', jsonb_build_object('audio_ve', round(b.aud_ve, 3), 'ratio', round(least(1, b.aud_ve / nullif(b.eau, 0)), 4)),
      'inputs', jsonb_build_object('items', v.aud_n, 'undated_items', v.aud_undated, 'target', b.eau, 'target_source', 'default (pro 3 / location 8)', 'decay_months', 24))
  ),
  'gaps', gp.arr)
END
FROM ent e, b, rv_in r, comp_in c, web_in w, vol_in v, targets t, gbp_in g, gaps gp
$fn$;

COMMENT ON FUNCTION public.exp_score_v5_explain(uuid, text) IS
  'Search Rank Score v5 (10-LANE MATH VIEW v5 2026-08-17). Read-only: lanes with components/inputs and gaps ranked by marginal_pts from the same math.';

REVOKE ALL ON FUNCTION public.exp_score_v5_explain(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_score_v5_explain(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_score_v5_explain(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exp_score_v5_persist(p_entity_id uuid, p_entity_type text DEFAULT 'professional')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_etype text := coalesce(p_entity_type, 'professional');
  v_x     jsonb;
  v_l     jsonb;
  v_total numeric;
  v_tot_i smallint;
  v_prev  smallint;
  v_h7    smallint;
  v_h30   smallint;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role'
          OR session_user IN ('postgres', 'supabase_admin')
          OR public.exp_ctrl_has_role(ARRAY['super_admin', 'architect'])) THEN
    RAISE EXCEPTION 'exp_score_v5_persist: not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_etype NOT IN ('professional', 'organization') THEN
    RAISE EXCEPTION 'exp_score_v5_persist: entity_type must be professional or organization, got %', v_etype;
  END IF;

  v_x := public.exp_score_v5_explain(p_entity_id, v_etype);
  IF v_x ? 'error' THEN
    RETURN v_x || jsonb_build_object('persisted', false);
  END IF;

  SELECT jsonb_object_agg(l->>'lane', (l->>'score')::numeric) INTO v_l
  FROM jsonb_array_elements(v_x->'lanes') l;
  v_total := (v_x->>'total')::numeric;
  v_tot_i := round(v_total)::smallint;

  SELECT total_score INTO v_prev FROM search_rank_scores
   WHERE entity_type = v_etype AND entity_id = p_entity_id;
  SELECT total_score INTO v_h7 FROM score_history
   WHERE entity_type = v_etype AND entity_id = p_entity_id AND snapshot_date <= current_date - 7
   ORDER BY snapshot_date DESC LIMIT 1;
  SELECT total_score INTO v_h30 FROM score_history
   WHERE entity_type = v_etype AND entity_id = p_entity_id AND snapshot_date <= current_date - 30
   ORDER BY snapshot_date DESC LIMIT 1;

  -- Legacy column mapping (same buckets the v1/v2 scorers used):
  --   score_reviews = reviews; score_profile = completeness; score_listings = gbp + directories;
  --   score_content = articles + qa + videos + audio; score_web_analytics = website;
  --   score_connections = connections; gaps = the v5 gaps array (lanes stay in explain: no column for them).
  --   next_milestone / local_rank / local_market / top_pct are left as they are.
  INSERT INTO search_rank_scores AS s (
    entity_type, entity_id, gcid, total_score, max_possible, score_pct,
    score_reviews, score_profile, score_listings, score_content, score_web_analytics, score_connections,
    previous_score, score_change_7d, score_change_30d, gaps, calculated_at)
  VALUES (
    v_etype, p_entity_id, v_x->>'gcid', v_tot_i, 850, round(v_total / 850 * 100, 1),
    round((v_l->>'reviews')::numeric)::smallint,
    round((v_l->>'completeness')::numeric)::smallint,
    round((v_l->>'gbp')::numeric + (v_l->>'directories')::numeric)::smallint,
    round((v_l->>'articles')::numeric + (v_l->>'qa')::numeric + (v_l->>'videos')::numeric + (v_l->>'audio')::numeric)::smallint,
    round((v_l->>'website')::numeric)::smallint,
    round((v_l->>'connections')::numeric)::smallint,
    v_prev, v_tot_i - v_h7, v_tot_i - v_h30, v_x->'gaps', now())
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    gcid = EXCLUDED.gcid, total_score = EXCLUDED.total_score, max_possible = EXCLUDED.max_possible,
    score_pct = EXCLUDED.score_pct, score_reviews = EXCLUDED.score_reviews,
    score_profile = EXCLUDED.score_profile, score_listings = EXCLUDED.score_listings,
    score_content = EXCLUDED.score_content, score_web_analytics = EXCLUDED.score_web_analytics,
    score_connections = EXCLUDED.score_connections, previous_score = s.total_score,
    score_change_7d = EXCLUDED.score_change_7d, score_change_30d = EXCLUDED.score_change_30d,
    gaps = EXCLUDED.gaps, calculated_at = EXCLUDED.calculated_at;

  -- score_history is unique per (entity, day): the day's row is appended; re-runs the same day refresh it.
  INSERT INTO score_history (entity_type, entity_id, total_score, score_reviews, score_profile,
                             score_listings, score_content, snapshot_date)
  VALUES (v_etype, p_entity_id, v_tot_i,
          round((v_l->>'reviews')::numeric)::smallint,
          round((v_l->>'completeness')::numeric)::smallint,
          round((v_l->>'gbp')::numeric + (v_l->>'directories')::numeric)::smallint,
          round((v_l->>'articles')::numeric + (v_l->>'qa')::numeric + (v_l->>'videos')::numeric + (v_l->>'audio')::numeric)::smallint,
          current_date)
  ON CONFLICT (entity_type, entity_id, snapshot_date) DO UPDATE SET
    total_score = EXCLUDED.total_score, score_reviews = EXCLUDED.score_reviews,
    score_profile = EXCLUDED.score_profile, score_listings = EXCLUDED.score_listings,
    score_content = EXCLUDED.score_content;

  RETURN v_x || jsonb_build_object('persisted', true, 'previous_score', v_prev);
END
$fn$;

COMMENT ON FUNCTION public.exp_score_v5_persist(uuid, text) IS
  'Search Rank Score v5: runs exp_score_v5_explain and upserts search_rank_scores + score_history. Does not write professionals/search_documents.';

REVOKE ALL ON FUNCTION public.exp_score_v5_persist(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_score_v5_persist(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exp_score_v5_persist(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICATION (read-only, 2026-10-11, live DB). Functions cannot be created from the review
-- session, so the body of exp_score_v5_explain above was run verbatim as one SELECT, with only the
-- `params` CTE changed to read from an outer VALUES list:
--   SELECT x.label, q.res
--   FROM (VALUES ('greg', '56d35654-1bcd-4ee6-97e3-3571ef61c8f1'::uuid, 'professional'), ...) x(label, eid, etype)
--   CROSS JOIN LATERAL ( WITH params AS (SELECT x.eid AS eid, x.etype AS etype), <rest of body> ) q(res);
--
-- entity (category, scope)                    total   rev    comp  web art gbp dir qa  conn  vid aud  gaps
-- Greg Aldridge 56d35654 (insurance, pro)      2.45   0.00   2.45   0   0   0   0   0  0.00   0   0    88
--   35 nodes / M 611 => volume .0573; core 8/34 => .2353 (23 missing; 3 unverified: KS/MO/OK licences on
--   hasCredential rows that require verification). Website on file, no crawl audit => 0.
--   Top gaps: GBP connect+verify 68; six tier-1 directories (Apple, Bing, Experience.com, Facebook,
--   Waze, Yelp) 15 each; first 5-star review, replied 12.96; video 3.70; article 3.53; Q&A 2.33;
--   audio 2.00; OAuth Facebook 1.65 (link exists, status unverified).
-- State Farm pro 3f565691 (insurance, pro)     4.35   0.00   3.99   0   0   0   0   0  0.35   0   0    88
--   57 nodes, core 8/34; Yelp link (unverified) 0.5 => B2 1.5 x gate .2353; GBP gap 'unverified'
--   (Place ID on record, no OAuth).
-- NAF Amber Ernst 22222222-..01 (mortgage    73.54  51.50  21.00   0   0   0   0   0  1.04   0   0    88
--   broker, pro)  5 reviews in 12 mo, avg age 7.6 mo, star .992 => RVE 1.946 vs 0.54 x EAR 75 =>
--   current 6.73; lifetime 2,606 @4.97 => standing 36.78; replies 4/5 => 8.00. 2,644 nodes >= M 321
--   => volume 1.0; core 6/52 => 21.00. B2 = Zillow + YouTube + LendingTree (verified) = 9 x gate .1154.
-- NAF Bettendorf office 11111111-..02         38.14  36.70   1.06   0   0   0   0   0  0.38   0   0    91
--   (mortgage broker, location)  lifetime 3,766 @4.96, no dated reviews => standing only.
-- NAF enterprise 11111111-..01 (mortgage     39.52  36.11   2.14   0   0   0   0   0  1.27   0   0   119
--   lender, location)  lifetime 462,446 @4.88 (EAR 300); Yelp + YouTube links.
-- State Farm office 12f52dc1 (insurance,       0.01   0.00   0.01   0   0   0   0   0  0.00   0   0    87
--   location)  1 node (logo); Place ID on record => GBP gap 'unverified'.
-- Real-estate pro acf94a02 (no graph nodes)    0.00   0.00   0.00   0   0   0   0   0  0.00   0   0    86
--   every lane 0; first-review gap 15.19 (EAR pro 50).
-- No entity has listings rows, oauth_connections rows, crawl audits or article/video/audio/Q&A nodes
-- today, so those lanes are 0 everywhere and appear only as gaps.
