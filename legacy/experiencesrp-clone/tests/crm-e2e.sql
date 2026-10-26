-- Module 2 readiness E2E on a removable Jimmy John's demo cluster.
-- Runs the governed lifecycle as a real super admin (auth.uid via request.jwt.claims),
-- asserts each step, tears the seed down, and asserts nothing remains.
-- Any failed assertion raises, which also rolls back every write.
DO $e2e$
DECLARE
  v_batch text := 'crm_e2e_' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS');
  v_seed jsonb; v_org uuid; v_opp uuid; v_opp2 uuid; v_r jsonb; v_rep uuid; v_contact uuid; v_task uuid; v_alert uuid;
  v_stage text; v_cap jsonb; v_n integer; v_failed boolean; v_td jsonb; v_log text[] := '{}';
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '33eccfce-f184-4aa9-bff9-9bb84a50775b', 'role', 'authenticated')::text, true);
  SELECT id INTO v_rep FROM exp_sales_reps WHERE NOT coalesce(is_demo, false) ORDER BY created_at LIMIT 1;

  v_seed := exp_crm_demo_seed(v_batch); v_org := (v_seed->>'org_id')::uuid;
  v_log := v_log || ('seed ' || v_seed::text);

  -- Create Opportunity + one-open-per-logo
  v_r := exp_opp_create(v_org, NULL, v_rep::text, 'seller'); v_opp := (v_r->>'id')::uuid;
  IF NOT (v_r->>'created')::boolean THEN RAISE EXCEPTION 'create: expected created=true'; END IF;
  v_r := exp_opp_create(v_org, NULL, v_rep::text, 'seller');
  IF (v_r->>'created')::boolean OR (v_r->>'id')::uuid <> v_opp THEN RAISE EXCEPTION 'one-open-per-logo violated'; END IF;
  v_log := v_log || 'create + one-open-per-logo OK'::text;

  -- notes / tasks / contacts / champion / demo / email
  INSERT INTO exp_sales_notes(subject_type, subject_id, subject_label, body, pinned, is_demo, demo_batch) VALUES ('opportunity', v_opp::text, 'JJ', 'E2E note', true, true, v_batch);
  INSERT INTO exp_sales_tasks(owner_id, opportunity_id, title, task_type, due_at, priority, is_demo, demo_batch) VALUES (v_rep, v_opp, 'E2E follow-up', 'reminder', now() - interval '1 minute', 'high', true, v_batch) RETURNING id INTO v_task;
  INSERT INTO exp_contacts(first_name, last_name, email, job_title, is_demo, demo_batch) VALUES ('Jimmy', 'Demo', 'ceo@example.com', 'CEO', true, v_batch) RETURNING id INTO v_contact;
  INSERT INTO exp_opportunity_contacts(opportunity_id, contact_id, role, is_champion, last_touch_at, is_demo, demo_batch) VALUES (v_opp, v_contact, 'Champion', true, now(), true, v_batch);
  INSERT INTO exp_sales_demos(opportunity_id, seller_id, booked_at, objective, attendees, meeting_kind, calendar_status, is_demo, demo_batch) VALUES (v_opp, v_rep, now() + interval '2 days', 'E2E demo', '["ceo@example.com"]', 'demo', 'pending', true, v_batch);
  INSERT INTO exp_email_outbox(opportunity_id, from_address, to_addresses, subject, body, status, is_demo, demo_batch) VALUES (v_opp, 'seller@experience.com', ARRAY['ceo@example.com'], 'E2E', 'Hello', 'pending', true, v_batch);
  INSERT INTO exp_activity_events(event_type, subject_type, subject_id, source, value, is_demo, demo_batch) VALUES ('email_queued', 'opportunity', v_opp::text, 'gmail', '{"status":"pending"}', true, v_batch);

  -- Stage gate: empty evidence must be refused
  v_failed := false;
  BEGIN PERFORM exp_opp_advance_stage(v_opp, 'discovery', '{}'::jsonb); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'stage gate allowed empty evidence'; END IF;
  -- Advance through every gate with evidence
  FOREACH v_stage IN ARRAY ARRAY['discovery','design','demo','buy_in','proposal'] LOOP
    SELECT coalesce(jsonb_object_agg(field_label, 'E2E evidence'), '{}') INTO v_cap FROM exp_stage_requirements WHERE stage_key = v_stage AND required;
    PERFORM exp_opp_advance_stage(v_opp, v_stage, v_cap);
  END LOOP;
  IF (SELECT stage FROM exp_sales_pipeline WHERE id = v_opp) <> 'proposal' THEN RAISE EXCEPTION 'not at proposal'; END IF;
  -- Actor: every move records the acting user + role, not a sales-rep row
  IF EXISTS (SELECT 1 FROM exp_opportunity_stage_history WHERE opportunity_id = v_opp AND (moved_by_user IS DISTINCT FROM '33eccfce-f184-4aa9-bff9-9bb84a50775b'::uuid OR moved_by_role <> 'admin'))
    THEN RAISE EXCEPTION 'stage history did not record admin actor'; END IF;
  -- An unauthorized signed-in user (not seller, manager or admin) is refused
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  v_failed := false;
  BEGIN PERFORM exp_opp_advance_stage(v_opp, 'demo', '{}'::jsonb); EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE 'Only the opportunity%'; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'unauthorized actor was not refused'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', '33eccfce-f184-4aa9-bff9-9bb84a50775b', 'role', 'authenticated')::text, true);
  v_log := v_log || 'actor recorded (admin), unauthorized refused'::text;
  INSERT INTO exp_quotes(opportunity_id, name, status, is_demo, demo_batch) VALUES (v_opp, 'E2E quote', 'draft', true, v_batch);
  v_log := v_log || 'gates refused empty, advanced to proposal, quote linked'::text;

  -- Timeline union: every source has a record
  SELECT (SELECT count(*) FROM exp_activity_events WHERE subject_id = v_opp::text) * (SELECT count(*) FROM exp_sales_notes WHERE subject_id = v_opp::text)
       * (SELECT count(*) FROM exp_sales_tasks WHERE opportunity_id = v_opp) * (SELECT count(*) FROM exp_sales_demos WHERE opportunity_id = v_opp)
       * (SELECT count(*) FROM exp_opportunity_stage_history WHERE opportunity_id = v_opp) * (SELECT count(*) FROM exp_claim_events WHERE logo_org_id = v_org) INTO v_n;
  IF v_n = 0 THEN RAISE EXCEPTION 'timeline union missing a source'; END IF;

  -- Alert engine
  PERFORM exp_alerts_generate();
  SELECT count(DISTINCT rule) INTO v_n FROM exp_sales_alerts WHERE opportunity_id = v_opp AND rule IN ('new_claim','exec_engaged','multi_location_upgrade','engagement_spike','cluster_activity');
  IF v_n < 5 THEN RAISE EXCEPTION 'expected 5 live alert rules, got %', v_n; END IF;
  IF EXISTS (SELECT 1 FROM exp_sales_alerts WHERE opportunity_id = v_opp AND owner_id IS DISTINCT FROM v_rep) THEN RAISE EXCEPTION 'alert without the owner'; END IF;
  PERFORM exp_alerts_generate(); -- idempotent
  SELECT count(*) INTO v_n FROM exp_sales_alerts WHERE opportunity_id = v_opp AND rule = 'new_claim';
  IF v_n <> (SELECT count(*) FROM exp_claim_events WHERE logo_org_id = v_org AND event_type IN ('claimed','engaged','upgraded') AND occurred_at > now() - interval '1 day') THEN RAISE EXCEPTION 'dedupe failed: % new_claim alerts', v_n; END IF;
  PERFORM exp_alerts_generate(now() + interval '30 days');
  SELECT id INTO v_alert FROM exp_sales_alerts WHERE opportunity_id = v_opp AND rule = 'stuck_in_stage' AND is_nora_suggested;
  IF v_alert IS NULL THEN RAISE EXCEPTION 'no NORA stuck-in-stage suggestion'; END IF;
  IF EXISTS (SELECT 1 FROM exp_sales_tasks WHERE source_alert_id = v_alert) THEN RAISE EXCEPTION 'suggestion became a task without acceptance'; END IF;
  PERFORM exp_alert_accept(v_alert);
  IF NOT EXISTS (SELECT 1 FROM exp_sales_tasks WHERE source_alert_id = v_alert) THEN RAISE EXCEPTION 'accept did not create task'; END IF;
  v_log := v_log || 'alerts: 5 live rules, owner set, dedupe, NORA accept->task'::text;

  -- Reminders
  PERFORM exp_task_reminders_tick();
  IF (SELECT reminded_at FROM exp_sales_tasks WHERE id = v_task) IS NULL OR NOT EXISTS (SELECT 1 FROM exp_sales_alerts WHERE dedupe_key = 'task_due:' || v_task) THEN RAISE EXCEPTION 'reminder not delivered in-app'; END IF;
  IF EXISTS (SELECT 1 FROM exp_email_outbox WHERE task_id = v_task) AND NOT EXISTS (SELECT 1 FROM exp_integration_google WHERE status = 'connected') THEN RAISE EXCEPTION 'reminder email queued while Google disconnected'; END IF;
  v_log := v_log || 'reminder delivered in-app; no email while disconnected'::text;

  -- Closed Won: territory handoff
  IF (SELECT success_handoff_at FROM exp_territory_brand WHERE org_id = v_org) IS NOT NULL THEN RAISE EXCEPTION 'handoff set before won'; END IF;
  PERFORM exp_opp_close_won(v_opp, '{"Final ACV & term confirmed":"1","Signed contract attached":"e2e"}');
  IF (SELECT success_handoff_at FROM exp_territory_brand WHERE org_id = v_org) IS NULL AND (v_seed->>'territory_id') IS NOT NULL THEN RAISE EXCEPTION 'won did not remove logo from territory'; END IF;
  v_failed := false;
  BEGIN PERFORM exp_opp_advance_stage(v_opp, 'proposal', '{}'); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'closed opp could be advanced'; END IF;

  -- Closed Lost path (new opp allowed once the prior one is closed)
  v_r := exp_opp_create(v_org, NULL, v_rep::text, 'seller'); v_opp2 := (v_r->>'id')::uuid;
  IF NOT (v_r->>'created')::boolean OR v_opp2 = v_opp THEN RAISE EXCEPTION 'could not open new opp after won'; END IF;
  v_failed := false;
  BEGIN PERFORM exp_opp_close_lost(v_opp2, '', NULL, NULL); EXCEPTION WHEN OTHERS THEN v_failed := true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'close lost allowed empty reason'; END IF;
  PERFORM exp_opp_close_lost(v_opp2, 'E2E lost', 'Competitor X', (now() + interval '90 days')::date);
  IF (SELECT stage || ':' || coalesce(lost_reason,'') FROM exp_sales_pipeline WHERE id = v_opp2) <> 'lost:E2E lost' THEN RAISE EXCEPTION 'close lost failed'; END IF;
  v_log := v_log || 'closed won (territory handoff) + closed lost OK'::text;

  -- Teardown and verify nothing remains
  v_td := exp_crm_demo_teardown(v_batch);
  SELECT (SELECT count(*) FROM organizations WHERE slug LIKE '%' || v_batch) + (SELECT count(*) FROM exp_sales_pipeline WHERE id IN (v_opp, v_opp2))
       + (SELECT count(*) FROM exp_claim_events WHERE demo_batch = v_batch) + (SELECT count(*) FROM exp_sales_alerts WHERE opportunity_id IN (v_opp, v_opp2))
       + (SELECT count(*) FROM exp_sales_tasks WHERE opportunity_id IN (v_opp, v_opp2)) + (SELECT count(*) FROM exp_contacts WHERE demo_batch = v_batch) INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'teardown left % rows', v_n; END IF;
  v_log := v_log || ('teardown ' || v_td::text);
  RAISE NOTICE 'E2E PASS %', array_to_string(v_log, ' | ');
END
$e2e$;
