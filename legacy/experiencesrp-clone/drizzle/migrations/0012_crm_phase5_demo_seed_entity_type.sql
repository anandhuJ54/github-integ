CREATE OR REPLACE FUNCTION public.exp_crm_demo_seed(p_batch text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_loc1 uuid; v_loc2 uuid; v_terr uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT exp_ctrl_has_role(ARRAY['super_admin']) THEN RAISE EXCEPTION 'Super admin required'; END IF;
  IF p_batch IS NULL OR p_batch !~ '^crm_e2e_[a-z0-9_]+$' THEN RAISE EXCEPTION 'Batch must match crm_e2e_*'; END IF;
  INSERT INTO organizations(name, slug, is_demo, entity_type) VALUES ('Jimmy John''s (Demo)', 'jimmy-johns-demo-' || p_batch, true, 'brand') RETURNING id INTO v_org;
  INSERT INTO organizations(name, slug, is_demo, entity_type, parent_org_id) VALUES ('Jimmy John''s (Demo) · Champaign', 'jimmy-johns-demo-champaign-' || p_batch, true, 'location', v_org) RETURNING id INTO v_loc1;
  INSERT INTO organizations(name, slug, is_demo, entity_type, parent_org_id) VALUES ('Jimmy John''s (Demo) · Urbana', 'jimmy-johns-demo-urbana-' || p_batch, true, 'location', v_org) RETURNING id INTO v_loc2;
  INSERT INTO exp_claim_events(entity_type, entity_id, entity_label, logo_org_id, event_type, upgraded, nora_engagement, occurred_at, is_demo, demo_batch) VALUES
    ('location', v_loc1, 'Champaign', v_org, 'claimed', true, 5, now() - interval '2 hours', true, p_batch),
    ('location', v_loc2, 'Urbana', v_org, 'upgraded', true, 7, now() - interval '3 hours', true, p_batch),
    ('location', v_loc1, 'Champaign', v_org, 'engaged', false, 4, now() - interval '20 hours', true, p_batch);
  SELECT id INTO v_terr FROM exp_territories ORDER BY created_at LIMIT 1;
  IF v_terr IS NOT NULL THEN INSERT INTO exp_territory_brand(territory_id, org_id, lane) VALUES (v_terr, v_org, 'location'); END IF;
  RETURN jsonb_build_object('org_id', v_org, 'locations', jsonb_build_array(v_loc1, v_loc2), 'territory_id', v_terr);
END $$;