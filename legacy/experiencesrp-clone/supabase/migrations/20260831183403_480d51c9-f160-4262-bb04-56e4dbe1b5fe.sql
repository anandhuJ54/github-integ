CREATE OR REPLACE FUNCTION public.exp_sf_apply(p_url text, p_f jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_brand uuid := 'bbbbbbb1-0000-4000-8000-000000000001';
  v_office uuid; v_pro uuid;
  v_name text := coalesce(p_f->>'name','State Farm Agent');
  v_first text; v_last text; v_slug text;
  v_street text := p_f->>'street'; v_city text := p_f->>'city';
  v_state text := p_f->>'state'; v_zip text := p_f->>'postal_code';
  v_lic jsonb; v_prod jsonb; v_soc jsonb;
  v_plic jsonb; v_langs text[];
BEGIN
  -- HARD RULE: promote AGENTS, LOCATIONS and the BRAND only.
  -- Team-roster staff must never become professional rows.
  IF NOT EXISTS (
    SELECT 1 FROM exp_etl_staging s
     WHERE s.gcid = 'gcid:insurance_agent' AND s.detail_url = p_url
  ) THEN
    RETURN NULL;
  END IF;

  v_first := split_part(v_name, ' ', 1);
  IF position(' ' in v_name) = 0 THEN
    v_last := 'State Farm';
  ELSE
    v_last := coalesce(nullif(btrim(substring(v_name from position(' ' in v_name) + 1)), ''), 'State Farm');
  END IF;

  -- office ---------------------------------------------------------------
  SELECT id INTO v_office FROM organizations
   WHERE parent_org_id = v_brand AND entity_type = 'office'
     AND lower(coalesce(address_street,'')) = lower(coalesce(v_street,''))
     AND lower(coalesce(address_city,''))   = lower(coalesce(v_city,''))
     AND upper(coalesce(address_state,''))  = upper(coalesce(v_state,''))
   LIMIT 1;

  IF v_office IS NULL THEN
    v_slug := 'sf-office-' || substr(md5(lower(coalesce(v_street,'') || '|' || coalesce(v_city,'') || '|' || coalesce(v_state,''))), 1, 16);
    WHILE EXISTS (SELECT 1 FROM organizations WHERE slug = v_slug) LOOP
      v_slug := 'sf-office-' || substr(md5(v_slug || p_url), 1, 16);
    END LOOP;
    INSERT INTO organizations (name, legal_name, slug, entity_type, gcid, parent_org_id,
      phone, address_street, address_city, address_state, address_zip, address_country,
      latitude, longitude, gbp_place_id, schema_type, website_url, logo_url, is_active, is_demo)
    VALUES (v_name || ' — State Farm', p_f->>'legal_name', v_slug,
      'office', 'gcid:insurance_agency', v_brand,
      p_f->>'phone', v_street, v_city, upper(v_state), v_zip, 'US',
      nullif(p_f->>'latitude','')::numeric, nullif(p_f->>'longitude','')::numeric,
      p_f->>'gbp_place_id', 'Organization', p_f->>'website_url', p_f->>'logo', true, false)
    RETURNING id INTO v_office;
  END IF;

  SELECT coalesce(array_agg(x), '{}') INTO v_langs
    FROM jsonb_array_elements_text(coalesce(p_f->'languages','[]'::jsonb)) AS t(x);
  v_plic := coalesce(p_f->'licenses'->0, '{}'::jsonb);

  -- professional (exactly one per staging detail_url) ---------------------
  SELECT id INTO v_pro FROM professionals WHERE detail_url = p_url LIMIT 1;

  IF v_pro IS NULL THEN
    v_slug := 'sf-' || substr(md5(p_url), 1, 20);
    WHILE EXISTS (SELECT 1 FROM professionals WHERE slug = v_slug) LOOP
      v_slug := 'sf-' || substr(md5(v_slug || p_url), 1, 20);
    END LOOP;
    INSERT INTO professionals (first_name, last_name, display_name, slug, detail_url, canonical_url,
      headline, job_title, bio, short_bio, photo_url, cover_photo_url, gcid, phone, website_url,
      address_city, address_state, address_zip, primary_org_id,
      primary_license_number, primary_license_type, primary_license_state,
      gbp_place_id, languages, schema_type, is_active, is_demo)
    VALUES (v_first, v_last, v_name, v_slug, p_url, p_url,
      'State Farm Insurance Agent — ' || coalesce(v_city,'') || ', ' || coalesce(upper(v_state),''),
      'State Farm Agent', p_f->>'bio', p_f->>'description',
      p_f->>'photo_url', p_f->>'cover_photo_url', 'gcid:insurance_agency',
      p_f->>'phone', p_f->>'website_url', v_city, upper(v_state), v_zip, v_office,
      v_plic->>'number', CASE WHEN v_plic ? 'number' THEN 'Insurance Producer License' END,
      v_plic->>'state', p_f->>'gbp_place_id', v_langs, 'InsuranceAgency', true, false)
    RETURNING id INTO v_pro;
  ELSE
    UPDATE professionals SET
      detail_url = p_url, canonical_url = p_url, display_name = v_name,
      first_name = v_first, last_name = v_last,
      headline = 'State Farm Insurance Agent — ' || coalesce(v_city,'') || ', ' || coalesce(upper(v_state),''),
      job_title = 'State Farm Agent', bio = p_f->>'bio', short_bio = p_f->>'description',
      photo_url = p_f->>'photo_url', cover_photo_url = p_f->>'cover_photo_url',
      phone = p_f->>'phone', website_url = p_f->>'website_url',
      address_city = v_city, address_state = upper(v_state), address_zip = v_zip,
      primary_org_id = v_office,
      primary_license_number = v_plic->>'number',
      primary_license_type = CASE WHEN v_plic ? 'number' THEN 'Insurance Producer License' END,
      primary_license_state = v_plic->>'state',
      gbp_place_id = p_f->>'gbp_place_id', languages = v_langs,
      schema_type = 'InsuranceAgency', updated_at = now()
     WHERE id = v_pro;
  END IF;

  -- expertise nodes (lead agent only) ------------------------------------
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

  RETURN v_pro;
END $function$;