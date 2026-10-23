-- Stage moves record the acting signed-in user and their role; actor no longer has to be a sales-rep row.
ALTER TABLE public.exp_opportunity_stage_history ADD COLUMN IF NOT EXISTS moved_by_user uuid;
ALTER TABLE public.exp_opportunity_stage_history ADD COLUMN IF NOT EXISTS moved_by_role text;
COMMENT ON COLUMN public.exp_opportunity_stage_history.moved_by IS 'Sales-rep row of the actor when the actor is a rep (nullable). Acting user is moved_by_user.';
COMMENT ON COLUMN public.exp_opportunity_stage_history.moved_by_user IS 'auth user who moved the stage';
COMMENT ON COLUMN public.exp_opportunity_stage_history.moved_by_role IS 'admin | manager | seller at time of move';

-- Who is acting on this opportunity, and may they move it? NULL role = not authorized.
CREATE OR REPLACE FUNCTION public.exp_crm_actor(p_opp uuid)
RETURNS TABLE(user_id uuid, rep_id uuid, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text; v_rep exp_sales_reps%ROWTYPE; v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN QUERY SELECT NULL::uuid, NULL::uuid, NULL::text; RETURN; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid;
  IF v_email IS NOT NULL THEN SELECT * INTO v_rep FROM exp_sales_reps WHERE lower(email) = v_email ORDER BY is_demo NULLS FIRST, created_at LIMIT 1; END IF;
  SELECT exp_resolve_rep(owner) INTO v_owner FROM exp_sales_pipeline WHERE id = p_opp;
  RETURN QUERY SELECT v_uid, v_rep.id,
    CASE
      WHEN exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN 'admin'
      WHEN exp_ctrl_has_role(ARRAY['sales_manager']) OR coalesce(v_rep.role,'') ~* 'manager|lead|director|vp' THEN 'manager'
      WHEN v_rep.id IS NOT NULL AND v_rep.id = v_owner THEN 'seller'
    END;
END $$;
REVOKE ALL ON FUNCTION public.exp_crm_actor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_crm_actor(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exp_opp_advance_stage(p_opp uuid, p_target text, p_captured jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_missing text[]; v_hist uuid; a record; v_demo boolean; v_batch text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_target IN ('won','lost') THEN RAISE EXCEPTION 'Use close_won / close_lost for %', p_target; END IF;
  IF NOT EXISTS (SELECT 1 FROM exp_pipeline_stages WHERE key = p_target) THEN RAISE EXCEPTION 'Unknown stage %', p_target; END IF;
  SELECT stage, is_demo, demo_batch INTO v_from, v_demo, v_batch FROM exp_sales_pipeline WHERE id = p_opp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found'; END IF;
  SELECT * INTO a FROM exp_crm_actor(p_opp);
  IF a.role IS NULL THEN RAISE EXCEPTION 'Only the opportunity''s seller, a sales manager or an admin can move this deal'; END IF;
  IF v_from IN ('won','lost') THEN RAISE EXCEPTION 'Opportunity is closed (%)', v_from; END IF;
  SELECT array_agg(field_label ORDER BY sort) INTO v_missing FROM exp_stage_requirements
   WHERE stage_key = p_target AND required
     AND nullif(btrim(coalesce(p_captured ->> field_label, '')), '') IS NULL;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Missing required evidence for %: %', p_target, array_to_string(v_missing, '; '); END IF;
  INSERT INTO exp_opportunity_stage_history(opportunity_id, from_stage, to_stage, captured, moved_by, moved_by_user, moved_by_role, moved_at, is_demo, demo_batch)
  VALUES (p_opp, v_from, p_target, p_captured, a.rep_id, a.user_id, a.role, now(), coalesce(v_demo,false), v_batch) RETURNING id INTO v_hist;
  UPDATE exp_sales_pipeline SET stage = p_target, updated_at = now() WHERE id = p_opp;
  RETURN v_hist;
END $$;

CREATE OR REPLACE FUNCTION public.exp_opp_close_lost(p_opp uuid, p_reason text, p_competitor text DEFAULT NULL, p_revisit date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_hist uuid; a record; v_demo boolean; v_batch text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF nullif(btrim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Lost reason is required'; END IF;
  SELECT stage, is_demo, demo_batch INTO v_from, v_demo, v_batch FROM exp_sales_pipeline WHERE id = p_opp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found'; END IF;
  SELECT * INTO a FROM exp_crm_actor(p_opp);
  IF a.role IS NULL THEN RAISE EXCEPTION 'Only the opportunity''s seller, a sales manager or an admin can close this deal'; END IF;
  IF v_from IN ('won','lost') THEN RAISE EXCEPTION 'Opportunity is closed (%)', v_from; END IF;
  INSERT INTO exp_opportunity_stage_history(opportunity_id, from_stage, to_stage, captured, moved_by, moved_by_user, moved_by_role, moved_at, is_demo, demo_batch)
  VALUES (p_opp, v_from, 'lost', jsonb_build_object('Lost reason', p_reason, 'Competitor (if lost to one)', p_competitor, 'Revisit date', p_revisit), a.rep_id, a.user_id, a.role, now(), coalesce(v_demo,false), v_batch)
  RETURNING id INTO v_hist;
  UPDATE exp_sales_pipeline SET stage = 'lost', lost_reason = p_reason, win_back = (p_revisit IS NOT NULL), updated_at = now() WHERE id = p_opp;
  RETURN v_hist;
END $$;

CREATE OR REPLACE FUNCTION public.exp_opp_close_won(p_opp uuid, p_captured jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_org text; v_hist uuid; a record; v_demo boolean; v_batch text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT stage, org_id, is_demo, demo_batch INTO v_from, v_org, v_demo, v_batch FROM exp_sales_pipeline WHERE id = p_opp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found'; END IF;
  SELECT * INTO a FROM exp_crm_actor(p_opp);
  IF a.role IS NULL THEN RAISE EXCEPTION 'Only the opportunity''s seller, a sales manager or an admin can close this deal'; END IF;
  IF v_from IN ('won','lost') THEN RAISE EXCEPTION 'Opportunity is closed (%)', v_from; END IF;
  INSERT INTO exp_opportunity_stage_history(opportunity_id, from_stage, to_stage, captured, moved_by, moved_by_user, moved_by_role, moved_at, is_demo, demo_batch)
  VALUES (p_opp, v_from, 'won', p_captured, a.rep_id, a.user_id, a.role, now(), coalesce(v_demo,false), v_batch) RETURNING id INTO v_hist;
  UPDATE exp_sales_pipeline SET stage = 'won', updated_at = now() WHERE id = p_opp;
  IF v_org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE exp_territory_brand SET success_handoff_at = now(), success_handoff_opportunity_id = p_opp
     WHERE org_id = v_org::uuid AND success_handoff_at IS NULL;
  END IF;
  RETURN v_hist;
END $$;
