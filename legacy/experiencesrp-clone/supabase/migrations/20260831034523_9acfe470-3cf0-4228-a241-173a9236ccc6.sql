-- ============================================================
-- DB-NATIVE State Farm deep hydration (no HTTP route dependency)
-- ============================================================

-- 1. helpers ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.safe_jsonb(t text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $f$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $f$;

CREATE OR REPLACE FUNCTION public.exp_sf_strip(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $f$
  SELECT nullif(btrim(regexp_replace(
    replace(replace(replace(replace(replace(replace(
      regexp_replace(coalesce(t,''), '<[^>]*>', ' ', 'g'),
      '&nbsp;',' '),'&amp;','&'),'&quot;','"'),'&#39;',''''),'&rsquo;',''''),'&apos;',''''),
    '\s+',' ','g')), '')
$f$;

CREATE OR REPLACE FUNCTION public.exp_sf_platform(u text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $f$
  SELECT CASE
    WHEN u ILIKE '%facebook.%'  THEN 'Facebook'
    WHEN u ILIKE '%instagram.%' THEN 'Instagram'
    WHEN u ILIKE '%linkedin.%'  THEN 'LinkedIn'
    WHEN u ILIKE '%twitter.%' OR u ILIKE '%x.com%' THEN 'X'
    WHEN u ILIKE '%yelp.%'      THEN 'Yelp'
    WHEN u ILIKE '%youtube.%'   THEN 'YouTube'
    WHEN u ILIKE '%tiktok.%'    THEN 'TikTok'
    WHEN u ILIKE '%pinterest.%' THEN 'Pinterest'
    WHEN u ILIKE '%nextdoor.%'  THEN 'Nextdoor'
    WHEN u ILIKE '%google.%'    THEN 'Google'
    ELSE 'Website' END
$f$;

-- 2. identity key on professionals -----------------------------
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS detail_url text;
CREATE UNIQUE INDEX IF NOT EXISTS professionals_detail_url_key
  ON public.professionals (detail_url) WHERE detail_url IS NOT NULL;

UPDATE public.professionals
   SET detail_url = canonical_url
 WHERE detail_url IS NULL
   AND canonical_url LIKE 'https://www.statefarm.com/agent/%'
   AND NOT EXISTS (
     SELECT 1 FROM public.professionals p2
      WHERE p2.detail_url = public.professionals.canonical_url
   );

CREATE INDEX IF NOT EXISTS idx_orgs_sf_office_addr
  ON public.organizations (parent_org_id, address_city, address_state);

-- staging must be able to record the deep tier
ALTER TABLE public.exp_etl_staging DROP CONSTRAINT IF EXISTS exp_etl_staging_field_tier_check;
ALTER TABLE public.exp_etl_staging ADD CONSTRAINT exp_etl_staging_field_tier_check
  CHECK (field_tier = ANY (ARRAY['core'::text,'enrichment'::text,'deep'::text]));

-- 3. fetch ledger ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.exp_etl_fetch (
  fetch_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id     uuid NOT NULL,
  detail_url   text NOT NULL,
  request_id   bigint,
  requested_at timestamptz NOT NULL DEFAULT now(),
  parsed       boolean NOT NULL DEFAULT false,
  parsed_at    timestamptz,
  http_status  int,
  note         text
);
GRANT SELECT ON public.exp_etl_fetch TO authenticated;
GRANT ALL ON public.exp_etl_fetch TO service_role;
ALTER TABLE public.exp_etl_fetch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "etl fetch readable by authenticated" ON public.exp_etl_fetch;
CREATE POLICY "etl fetch readable by authenticated" ON public.exp_etl_fetch
  FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_etl_fetch_pending ON public.exp_etl_fetch (parsed, requested_at);
CREATE INDEX IF NOT EXISTS idx_etl_fetch_stage ON public.exp_etl_fetch (stage_id);

-- 4. deterministic parser -------------------------------------
CREATE OR REPLACE FUNCTION public.exp_sf_parse(p_html text, p_url text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE
  b jsonb; types jsonb; agency jsonb;
  products jsonb := '[]'::jsonb; socials jsonb := '[]'::jsonb;
  licenses jsonb := '[]'::jsonb; team jsonb := '[]'::jsonb;
  langs text[] := '{}'; hours text[] := '{}'; about text[] := '{}';
  tz text; sec text; chunk text; seen text[] := '{}';
  v_name text; v_desc text; v_bio text; v_photo text; v_cover text;
  v_place text; v_site text; v_addr jsonb; v_geo jsonb;
  tm_name text; tm_role text; tm_lic text; tm_photo text;
  reasons text[] := '{}'; n int := 0; res jsonb;
BEGIN
  FOR b IN
    SELECT public.safe_jsonb(x[1])
      FROM regexp_matches(p_html, '<script[^>]*application/ld\+json[^>]*>(.*?)</script>', 'gs') AS x
  LOOP
    IF b IS NULL THEN CONTINUE; END IF;
    types := CASE WHEN jsonb_typeof(b->'@type') = 'array'
                  THEN b->'@type' ELSE jsonb_build_array(b->'@type') END;
    IF types ?| ARRAY['InsuranceAgency','LocalBusiness','Organization'] AND agency IS NULL THEN
      agency := b;
    ELSIF types ? 'Offer' AND coalesce(b->>'name','') <> '' THEN
      products := products || jsonb_build_object(
        'name', public.exp_sf_strip(b->>'name'),
        'url', b->>'url',
        'description', public.exp_sf_strip(b->>'description'));
    END IF;
  END LOOP;

  v_addr := coalesce(agency->'address', '{}'::jsonb);
  v_geo  := coalesce(agency->'geo', '{}'::jsonb);
  v_desc := public.exp_sf_strip(agency->>'description');

  IF agency IS NOT NULL AND jsonb_typeof(agency->'sameAs') = 'array' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('platform', public.exp_sf_platform(u), 'url', u)), '[]'::jsonb)
      INTO socials
      FROM (SELECT DISTINCT u FROM jsonb_array_elements_text(agency->'sameAs') AS t(u)
             WHERE u ~ '^https?://') s;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'raw', val,
           'state', substring(val from '^([A-Z]{2})'),
           'number', regexp_replace(val, '^[A-Z]{2}[-\s]*', ''),
           'primary', is_primary) ORDER BY is_primary DESC, val), '[]'::jsonb)
    INTO licenses
    FROM (
      SELECT btrim(x[2]) AS val, bool_or(x[1] = 'primary') AS is_primary
        FROM regexp_matches(p_html,
             'credential-value"[^>]*data-credential-type="([^"]*)"[^>]*>([^<]*)<', 'g') AS x
       GROUP BY btrim(x[2])
    ) q
   WHERE val <> '';

  SELECT coalesce(array_agg(DISTINCT x[1]), '{}')
    INTO langs
    FROM regexp_matches(p_html, 'data-language-title="([^"]+)"', 'g') AS x;

  sec := substring(p_html from 'hours-section(.*?)website-section');
  IF sec IS NOT NULL THEN
    SELECT coalesce(array_agg(v), '{}') INTO hours
      FROM (SELECT public.exp_sf_strip(x[1]) AS v
              FROM regexp_matches(sec, '-oneX-body--primary"[^>]*>([^<]*)<', 'g') AS x) q
     WHERE v IS NOT NULL;
    tz := substring(sec from 'data-abbr="([^"]+)"');
  END IF;

  SELECT coalesce(array_agg(v ORDER BY ord), '{}') INTO about
    FROM (
      SELECT v, min(o) AS ord FROM (
        SELECT public.exp_sf_strip(li[1]) AS v, row_number() OVER () AS o
          FROM regexp_matches(p_html, '<ul class="about-me-list">(.*?)</ul>', 'gs') AS ul,
               regexp_matches(ul[1], '<li[^>]*>(.*?)</li>', 'gs') AS li
      ) z WHERE v IS NOT NULL GROUP BY v
    ) q;

  v_photo := substring(p_html from '(https://[^"'']*/formalColorFull\.jpg)');
  v_cover := substring(p_html from '(https://[^"'']*/informalColorFull\.jpg)');
  v_place := substring(p_html from '[?&](?:placeid|query_place_id)=([A-Za-z0-9_-]+)');
  v_site  := substring(p_html from 'redirect-url-[0-9]+"[^>]*href="([^"]+)"');
  IF v_site IS NULL THEN
    v_site := substring(p_html from 'href="([^"]+)"[^>]*id="[^"]*redirect-url-[0-9]+"');
  END IF;

  v_name := public.exp_sf_strip(substring(coalesce(agency->>'name','') from '^(.*?)\s*-\s*State Farm'));
  IF v_name IS NULL THEN v_name := public.exp_sf_strip(agency->'founder'->>'name'); END IF;
  IF v_name IS NULL THEN v_name := public.exp_sf_strip(agency->>'name'); END IF;

  v_bio := CASE WHEN array_length(about,1) > 0 THEN array_to_string(about, ' · ') ELSE v_desc END;

  FOR chunk IN
    SELECT t FROM regexp_split_to_table(p_html, '<div id="team-member-') WITH ORDINALITY AS s(t, ord)
     WHERE ord > 1
  LOOP
    tm_name := public.exp_sf_strip(substring(chunk from 'team-member__name"[^>]*>([^<]*)<'));
    IF tm_name IS NULL OR lower(tm_name) = ANY (seen) THEN CONTINUE; END IF;
    seen := seen || lower(tm_name);
    tm_role  := public.exp_sf_strip(substring(chunk from 'team-member__job-title"[^>]*>([^<]*)<'));
    tm_lic   := public.exp_sf_strip(substring(chunk from 'team-member__credential"[^>]*>([^<]*)<'));
    tm_photo := substring(chunk from '<img[^>]*team-member__photo[^>]*src="([^"]+)"');
    team := team || jsonb_build_object('name', tm_name, 'role', tm_role,
                                       'license', tm_lic, 'photo_url', tm_photo);
  END LOOP;

  -- field-yield gate
  IF jsonb_array_length(products) < 3 THEN reasons := reasons || 'fewer than 3 products'; END IF;
  IF v_desc IS NULL AND v_bio IS NULL THEN reasons := reasons || 'no description/bio'; END IF;
  IF public.exp_sf_strip(v_addr->>'streetAddress') IS NULL
     OR public.exp_sf_strip(v_addr->>'addressLocality') IS NULL
     OR public.exp_sf_strip(v_addr->>'addressRegion') IS NULL THEN
    reasons := reasons || 'incomplete address';
  END IF;
  IF public.exp_sf_strip(agency->>'telephone') IS NULL THEN reasons := reasons || 'no phone'; END IF;
  IF jsonb_array_length(licenses) < 1 THEN reasons := reasons || 'no license'; END IF;
  IF agency IS NULL THEN reasons := ARRAY['no JSON-LD agency object on detail page']; END IF;

  res := jsonb_build_object(
    'detail_url', p_url,
    'name', v_name,
    'legal_name', public.exp_sf_strip(agency->>'name'),
    'description', v_desc,
    'bio', v_bio,
    'about_me', to_jsonb(about),
    'phone', public.exp_sf_strip(agency->>'telephone'),
    'fax', public.exp_sf_strip(agency->>'faxNumber'),
    'website_url', v_site,
    'street', public.exp_sf_strip(v_addr->>'streetAddress'),
    'city', public.exp_sf_strip(v_addr->>'addressLocality'),
    'state', public.exp_sf_strip(v_addr->>'addressRegion'),
    'postal_code', public.exp_sf_strip(v_addr->>'postalCode'),
    'latitude', v_geo->>'latitude',
    'longitude', v_geo->>'longitude',
    'logo', agency->>'logo',
    'photo_url', v_photo,
    'cover_photo_url', v_cover,
    'gbp_place_id', v_place,
    'languages', to_jsonb(langs),
    'office_hours', to_jsonb(hours),
    'office_hours_tz', tz,
    'products', products,
    'social', socials,
    'licenses', licenses,
    'team', team,
    'gate_passed', (array_length(reasons,1) IS NULL),
    'gate_reasons', to_jsonb(reasons)
  );

  SELECT count(*) INTO n FROM jsonb_each(res) e(k, v)
   WHERE k NOT IN ('detail_url','gate_passed','gate_reasons')
     AND v IS NOT NULL AND v <> 'null'::jsonb AND v::text <> '""'
     AND NOT (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0);

  RETURN res || jsonb_build_object('field_count', n);
END $fn$;

-- 5. promotion -------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_sf_apply(p_url text, p_f jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_brand uuid := 'bbbbbbb1-0000-4000-8000-000000000001';
  v_office uuid; v_pro uuid; v_tm uuid;
  v_name text := coalesce(p_f->>'name','State Farm Agent');
  v_first text; v_last text;
  v_street text := p_f->>'street'; v_city text := p_f->>'city';
  v_state text := p_f->>'state'; v_zip text := p_f->>'postal_code';
  v_lic jsonb; v_prod jsonb; v_soc jsonb; v_tmr jsonb;
  v_plic jsonb; v_langs text[];
BEGIN
  v_first := split_part(v_name, ' ', 1);
  v_last  := nullif(btrim(substring(v_name from position(' ' in v_name) + 1)), '');
  IF v_last IS NULL OR position(' ' in v_name) = 0 THEN v_last := 'State Farm'; END IF;

  SELECT id INTO v_office FROM organizations
   WHERE parent_org_id = v_brand AND entity_type = 'office'
     AND lower(coalesce(address_street,'')) = lower(coalesce(v_street,''))
     AND lower(coalesce(address_city,''))   = lower(coalesce(v_city,''))
     AND upper(coalesce(address_state,''))  = upper(coalesce(v_state,''))
   LIMIT 1;

  IF v_office IS NULL THEN
    INSERT INTO organizations (name, legal_name, slug, entity_type, gcid, parent_org_id,
      phone, address_street, address_city, address_state, address_zip, address_country,
      latitude, longitude, gbp_place_id, schema_type, website_url, logo_url, is_active, is_demo)
    VALUES (v_name || ' — State Farm', p_f->>'legal_name',
      'sf-office-' || substr(md5(lower(coalesce(v_street,'') || '|' || coalesce(v_city,'') || '|' || coalesce(v_state,''))), 1, 16),
      'office', 'gcid:insurance_agency', v_brand,
      p_f->>'phone', v_street, v_city, upper(v_state), v_zip, 'US',
      nullif(p_f->>'latitude','')::numeric, nullif(p_f->>'longitude','')::numeric,
      p_f->>'gbp_place_id', 'Organization', p_f->>'website_url', p_f->>'logo', true, false)
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_office;
  END IF;

  SELECT coalesce(array_agg(x), '{}') INTO v_langs
    FROM jsonb_array_elements_text(coalesce(p_f->'languages','[]'::jsonb)) AS t(x);
  v_plic := coalesce(p_f->'licenses'->0, '{}'::jsonb);

  INSERT INTO professionals (first_name, last_name, display_name, slug, detail_url, canonical_url,
    headline, job_title, bio, short_bio, photo_url, cover_photo_url, gcid, phone, website_url,
    address_city, address_state, address_zip, primary_org_id,
    primary_license_number, primary_license_type, primary_license_state,
    gbp_place_id, languages, schema_type, is_active, is_demo)
  VALUES (v_first, v_last, v_name,
    'sf-' || substr(md5(p_url), 1, 20), p_url, p_url,
    'State Farm Insurance Agent — ' || coalesce(v_city,'') || ', ' || coalesce(upper(v_state),''),
    'State Farm Agent', p_f->>'bio', p_f->>'description',
    p_f->>'photo_url', p_f->>'cover_photo_url', 'gcid:insurance_agency',
    p_f->>'phone', p_f->>'website_url', v_city, upper(v_state), v_zip, v_office,
    v_plic->>'number', CASE WHEN v_plic ? 'number' THEN 'Insurance Producer License' END,
    v_plic->>'state', p_f->>'gbp_place_id', v_langs, 'InsuranceAgency', true, false)
  ON CONFLICT (detail_url) DO UPDATE SET
    display_name = excluded.display_name, headline = excluded.headline,
    job_title = excluded.job_title, bio = excluded.bio, short_bio = excluded.short_bio,
    photo_url = excluded.photo_url, cover_photo_url = excluded.cover_photo_url,
    phone = excluded.phone, website_url = excluded.website_url,
    address_city = excluded.address_city, address_state = excluded.address_state,
    address_zip = excluded.address_zip, primary_org_id = excluded.primary_org_id,
    primary_license_number = excluded.primary_license_number,
    primary_license_type = excluded.primary_license_type,
    primary_license_state = excluded.primary_license_state,
    gbp_place_id = excluded.gbp_place_id, languages = excluded.languages,
    schema_type = excluded.schema_type, updated_at = now()
  RETURNING id INTO v_pro;

  IF v_pro IS NULL THEN
    SELECT id INTO v_pro FROM professionals WHERE detail_url = p_url;
  END IF;

  DELETE FROM graph_nodes
   WHERE entity_id = v_pro AND source = 'etl'
     AND node_type IN ('product_service','social_profile','credential');

  FOR v_prod IN SELECT jsonb_array_elements(coalesce(p_f->'products','[]'::jsonb)) LOOP
    INSERT INTO graph_nodes (entity_type, entity_id, ring, node_type, title, url,
      schema_property, source, source_url, extracted_data, is_active, score_points, score_counted)
    VALUES ('professional', v_pro, 2, 'product_service', v_prod->>'name', v_prod->>'url',
      'makesOffer', 'etl', p_url, v_prod, true, 0, false);
  END LOOP;

  FOR v_soc IN SELECT jsonb_array_elements(coalesce(p_f->'social','[]'::jsonb)) LOOP
    INSERT INTO graph_nodes (entity_type, entity_id, ring, node_type, title, url,
      schema_property, source, source_url, is_active, score_points, score_counted)
    VALUES ('professional', v_pro, 2, 'social_profile', v_soc->>'platform', v_soc->>'url',
      'sameAs', 'etl', p_url, true, 0, false);
  END LOOP;

  FOR v_lic IN SELECT jsonb_array_elements(coalesce(p_f->'licenses','[]'::jsonb)) LOOP
    INSERT INTO graph_nodes (entity_type, entity_id, ring, node_type, title,
      schema_property, source, source_url, extracted_data, is_active, score_points, score_counted)
    VALUES ('professional', v_pro, 3, 'credential', v_lic->>'raw',
      'hasCredential', 'etl', p_url, v_lic, true, 0, false);
  END LOOP;

  -- team roster as additional professionals at the same office
  FOR v_tmr IN SELECT jsonb_array_elements(coalesce(p_f->'team','[]'::jsonb)) LOOP
    INSERT INTO professionals (first_name, last_name, display_name, slug, detail_url,
      job_title, photo_url, gcid, primary_org_id, address_city, address_state,
      schema_type, is_active, is_demo)
    VALUES (split_part(v_tmr->>'name',' ',1),
      coalesce(nullif(btrim(substring((v_tmr->>'name') from position(' ' in (v_tmr->>'name')) + 1)),''), 'State Farm'),
      v_tmr->>'name',
      'sf-' || substr(md5(p_url || '#team#' || lower(v_tmr->>'name')), 1, 20),
      p_url || '#team-' || substr(md5(lower(v_tmr->>'name')), 1, 12),
      v_tmr->>'role', v_tmr->>'photo_url', 'gcid:insurance_agency', v_office,
      v_city, upper(v_state), 'Person', true, false)
    ON CONFLICT (detail_url) DO UPDATE SET
      job_title = excluded.job_title, photo_url = excluded.photo_url,
      primary_org_id = excluded.primary_org_id, updated_at = now()
    RETURNING id INTO v_tm;

    IF v_tm IS NOT NULL AND coalesce(v_tmr->>'license','') <> '' THEN
      DELETE FROM graph_nodes WHERE entity_id = v_tm AND source = 'etl' AND node_type = 'credential';
      INSERT INTO graph_nodes (entity_type, entity_id, ring, node_type, title,
        schema_property, source, source_url, extracted_data, is_active, score_points, score_counted)
      VALUES ('professional', v_tm, 3, 'credential', v_tmr->>'license',
        'hasCredential', 'etl', p_url, v_tmr, true, 0, false);
    END IF;
  END LOOP;

  RETURN v_pro;
END $fn$;

-- 6. fetch tick ------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_sf_fetch_tick(p_limit int DEFAULT 150)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net, extensions AS $fn$
DECLARE r record; v_req bigint; n int := 0;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('exp_sf_fetch_tick')) THEN
    RETURN jsonb_build_object('skipped','locked');
  END IF;

  FOR r IN
    SELECT s.stage_id, s.detail_url
      FROM exp_etl_staging s
     WHERE s.gcid = 'gcid:insurance_agent'
       AND s.field_tier = 'core'
       AND s.detail_url IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM exp_etl_fetch f WHERE f.stage_id = s.stage_id)
     ORDER BY s.observed_at
     LIMIT p_limit
  LOOP
    BEGIN
      SELECT net.http_get(r.detail_url, timeout_milliseconds => 25000) INTO v_req;
      INSERT INTO exp_etl_fetch (stage_id, detail_url, request_id) VALUES (r.stage_id, r.detail_url, v_req);
      n := n + 1;
    EXCEPTION WHEN others THEN
      INSERT INTO exp_etl_fetch (stage_id, detail_url, parsed, parsed_at, note)
      VALUES (r.stage_id, r.detail_url, true, now(), 'fetch error: ' || SQLERRM);
    END;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('exp_sf_fetch_tick'));
  RETURN jsonb_build_object('requested', n);
END $fn$;

-- 7. parse tick ------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_sf_parse_tick(p_limit int DEFAULT 150)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net, extensions AS $fn$
DECLARE
  r record; v_status int; v_body text; v_f jsonb;
  n int := 0; promoted int := 0; shallow int := 0; failed int := 0; waiting int := 0;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('exp_sf_parse_tick')) THEN
    RETURN jsonb_build_object('skipped','locked');
  END IF;

  FOR r IN
    SELECT f.fetch_id, f.stage_id, f.detail_url, f.request_id, f.requested_at
      FROM exp_etl_fetch f
     WHERE f.parsed = false AND f.request_id IS NOT NULL
     ORDER BY f.requested_at
     LIMIT p_limit
  LOOP
    v_status := NULL; v_body := NULL;
    SELECT status_code, content INTO v_status, v_body
      FROM net._http_response WHERE id = r.request_id;

    IF v_status IS NULL OR v_status <> 200 THEN
      IF r.requested_at < now() - interval '10 minutes' THEN
        UPDATE exp_etl_fetch SET parsed = true, parsed_at = now(), http_status = v_status,
               note = 'no 200 response within 10 minutes' WHERE fetch_id = r.fetch_id;
        UPDATE exp_etl_staging SET resolution_status = 'needs_review',
               rejected_reason = 'malformed' WHERE stage_id = r.stage_id;
        failed := failed + 1;
      ELSE
        waiting := waiting + 1;
      END IF;
      CONTINUE;
    END IF;

    n := n + 1;
    v_f := public.exp_sf_parse(v_body, r.detail_url);

    IF (v_f->>'gate_passed')::boolean THEN
      PERFORM public.exp_sf_apply(r.detail_url, v_f);
      UPDATE exp_etl_staging
         SET field_tier = 'deep', resolution_status = 'created',
             resolved_at = now(),
             payload = coalesce(payload,'{}'::jsonb) || jsonb_build_object('deep', v_f)
       WHERE stage_id = r.stage_id;
      promoted := promoted + 1;
    ELSE
      UPDATE exp_etl_staging
         SET resolution_status = 'shallow',
             payload = coalesce(payload,'{}'::jsonb) || jsonb_build_object(
               'gate_passed', false, 'gate_reasons', v_f->'gate_reasons',
               'field_count', v_f->'field_count')
       WHERE stage_id = r.stage_id;
      shallow := shallow + 1;
    END IF;

    UPDATE exp_etl_fetch SET parsed = true, parsed_at = now(), http_status = 200
     WHERE fetch_id = r.fetch_id;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('exp_sf_parse_tick'));
  RETURN jsonb_build_object('processed', n, 'promoted', promoted,
    'shallow', shallow, 'failed', failed, 'waiting', waiting);
END $fn$;

REVOKE ALL ON FUNCTION public.exp_sf_apply(text, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.exp_sf_fetch_tick(int) FROM public;
REVOKE ALL ON FUNCTION public.exp_sf_parse_tick(int) FROM public;
GRANT EXECUTE ON FUNCTION public.exp_sf_fetch_tick(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.exp_sf_parse_tick(int) TO service_role;

-- 8. field floor config row for visibility ---------------------
INSERT INTO public.exp_etl_field_floors (gcid, min_fields, required_keys)
VALUES ('gcid:insurance_agent', 8, ARRAY['bio','street','city','state','phone'])
ON CONFLICT (gcid) DO NOTHING;

-- 9. cron -----------------------------------------------------
SELECT cron.unschedule(jobid) FROM cron.job
 WHERE jobname IN ('sf-hydrate-fetch','sf-hydrate-parse','etl-deep-hydrate-statefarm');
SELECT cron.schedule('sf-hydrate-fetch', '* * * * *', $$SELECT public.exp_sf_fetch_tick(150)$$);
SELECT cron.schedule('sf-hydrate-parse', '* * * * *', $$SELECT public.exp_sf_parse_tick(200)$$);
