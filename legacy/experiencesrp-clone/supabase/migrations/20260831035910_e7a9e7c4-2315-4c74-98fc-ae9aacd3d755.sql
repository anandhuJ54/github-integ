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
      FROM regexp_matches(p_html, '<script[^>]*?application/ld\+json[^>]*?>(.*?)</script>', 'gs') AS x
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
             'credential-value"[^>]*?data-credential-type="([^"]*)"[^>]*?>([^<]*)<', 'g') AS x
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
              FROM regexp_matches(sec, '-oneX-body--primary"[^>]*?>([^<]*)<', 'g') AS x) q
     WHERE v IS NOT NULL;
    tz := substring(sec from 'data-abbr="([^"]+)"');
  END IF;

  SELECT coalesce(array_agg(v ORDER BY ord), '{}') INTO about
    FROM (
      SELECT v, min(o) AS ord FROM (
        SELECT public.exp_sf_strip(li[1]) AS v, row_number() OVER () AS o
          FROM regexp_matches(p_html, '<ul class="about-me-list">(.*?)</ul>', 'gs') AS ul,
               regexp_matches(ul[1], '<li[^>]*?>(.*?)</li>', 'gs') AS li
      ) z WHERE v IS NOT NULL GROUP BY v
    ) q;

  v_photo := substring(p_html from '(https://[^"'']*/formalColorFull\.jpg)');
  v_cover := substring(p_html from '(https://[^"'']*/informalColorFull\.jpg)');
  v_place := substring(p_html from '[?&](?:placeid|query_place_id)=([A-Za-z0-9_-]+)');
  v_site  := substring(p_html from 'redirect-url-[0-9]+"[^>]*?href="([^"]+)"');
  IF v_site IS NULL THEN
    v_site := substring(p_html from 'href="([^"]+)"[^>]*?id="[^"]*redirect-url-[0-9]+"');
  END IF;

  v_name := public.exp_sf_strip(substring(coalesce(agency->>'name','') from '^(.*?)\s*-\s*State Farm'));
  IF v_name IS NULL THEN v_name := public.exp_sf_strip(agency->'founder'->>'name'); END IF;
  IF v_name IS NULL THEN v_name := public.exp_sf_strip(agency->>'name'); END IF;

  v_bio := CASE WHEN array_length(about,1) > 0 THEN array_to_string(about, ' · ') ELSE v_desc END;

  FOR chunk IN
    SELECT t FROM regexp_split_to_table(p_html, '<div id="team-member-') WITH ORDINALITY AS s(t, ord)
     WHERE ord > 1
  LOOP
    tm_name := public.exp_sf_strip(substring(chunk from 'team-member__name"[^>]*?>([^<]*)<'));
    IF tm_name IS NULL OR lower(tm_name) = ANY (seen) THEN CONTINUE; END IF;
    seen := array_append(seen, lower(tm_name));
    tm_role  := public.exp_sf_strip(substring(chunk from 'team-member__job-title"[^>]*?>([^<]*)<'));
    tm_lic   := public.exp_sf_strip(substring(chunk from 'team-member__credential"[^>]*?>([^<]*)<'));
    tm_photo := substring(chunk from '<img[^>]*?team-member__photo[^>]*?src="([^"]+)"');
    team := team || jsonb_build_object('name', tm_name, 'role', tm_role,
                                       'license', tm_lic, 'photo_url', tm_photo);
  END LOOP;

  IF jsonb_array_length(products) < 3 THEN
    reasons := array_append(reasons, 'fewer than 3 products'::text); END IF;
  IF v_desc IS NULL AND v_bio IS NULL THEN
    reasons := array_append(reasons, 'no description/bio'::text); END IF;
  IF public.exp_sf_strip(v_addr->>'streetAddress') IS NULL
     OR public.exp_sf_strip(v_addr->>'addressLocality') IS NULL
     OR public.exp_sf_strip(v_addr->>'addressRegion') IS NULL THEN
    reasons := array_append(reasons, 'incomplete address'::text); END IF;
  IF public.exp_sf_strip(agency->>'telephone') IS NULL THEN
    reasons := array_append(reasons, 'no phone'::text); END IF;
  IF jsonb_array_length(licenses) < 1 THEN
    reasons := array_append(reasons, 'no license'::text); END IF;
  IF agency IS NULL THEN
    reasons := ARRAY['no JSON-LD agency object on detail page']::text[]; END IF;

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

  SELECT count(*) INTO n FROM jsonb_each(res) AS e(k, v)
   WHERE k NOT IN ('detail_url','gate_passed','gate_reasons')
     AND v IS NOT NULL AND v <> 'null'::jsonb AND v::text <> '""'
     AND NOT (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0);

  RETURN res || jsonb_build_object('field_count', n);
END $fn$;

-- re-queue the pages wrongly flagged by the pattern bug
DELETE FROM public.exp_etl_fetch f
 USING public.exp_etl_staging s
 WHERE f.stage_id = s.stage_id AND s.resolution_status = 'shallow';

UPDATE public.exp_etl_staging
   SET resolution_status = 'pending',
       payload = payload - 'gate_passed' - 'gate_reasons'
 WHERE gcid = 'gcid:insurance_agent' AND resolution_status = 'shallow';
