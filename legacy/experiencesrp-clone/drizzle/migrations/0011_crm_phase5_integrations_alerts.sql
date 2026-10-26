-- Module 2 Phase 5: Google Workspace integration (vault references only), outbox, calendar state, alert engine, reminders, removable demo seed.

CREATE TABLE public.exp_integration_google (
  id text PRIMARY KEY DEFAULT 'workspace' CHECK (id = 'workspace'),
  status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','awaiting_admin_authorize','connected','error')),
  domain text NOT NULL DEFAULT 'experience.com',
  domain_status text NOT NULL DEFAULT 'unverified' CHECK (domain_status IN ('unverified','pending_verification','verified')),
  domain_verification_token text,
  verified_at timestamptz,
  connected_by uuid,
  connected_by_email text,
  connected_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  requested_scopes text[] NOT NULL DEFAULT ARRAY[
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly'],
  delegation_mode text NOT NULL DEFAULT 'domain_wide' CHECK (delegation_mode IN ('domain_wide')),
  client_id_ref text NOT NULL DEFAULT 'GOOGLE_OAUTH_CLIENT_ID',
  client_secret_ref text NOT NULL DEFAULT 'GOOGLE_OAUTH_CLIENT_SECRET',
  service_account_ref text NOT NULL DEFAULT 'GOOGLE_SA_KEY_JSON',
  refresh_token_vault_id uuid,
  oauth_state text,
  oauth_state_expires_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.exp_integration_google IS 'Company-wide Google Workspace connection. Holds vault/secret reference NAMES only, never secret values.';
GRANT SELECT ON public.exp_integration_google TO authenticated;
GRANT ALL ON public.exp_integration_google TO service_role;
ALTER TABLE public.exp_integration_google ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admins read google integration" ON public.exp_integration_google FOR SELECT TO authenticated USING (public.exp_ctrl_has_role(ARRAY['super_admin']));

-- Refresh tokens go to the vault; callable by the server (service role) only.
CREATE OR REPLACE FUNCTION public.exp_google_vault_put(p_existing uuid, p_secret text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_id uuid;
BEGIN
  IF p_existing IS NOT NULL AND EXISTS (SELECT 1 FROM vault.secrets WHERE id = p_existing) THEN
    PERFORM vault.update_secret(p_existing, p_secret);
    RETURN p_existing;
  END IF;
  SELECT vault.create_secret(p_secret, 'google_workspace_refresh_token_' || gen_random_uuid()::text, 'Google Workspace org-wide refresh token') INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.exp_google_vault_put(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exp_google_vault_put(uuid, text) TO service_role;

CREATE TABLE public.exp_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.exp_sales_pipeline(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.exp_sales_tasks(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'email' CHECK (kind IN ('email','reminder')),
  from_address text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  provider_message_id text,
  error text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  demo_batch text
);
GRANT SELECT, INSERT ON public.exp_email_outbox TO authenticated;
GRANT ALL ON public.exp_email_outbox TO service_role;
ALTER TABLE public.exp_email_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read outbox" ON public.exp_email_outbox FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff queue outbox as pending" ON public.exp_email_outbox FOR INSERT TO authenticated WITH CHECK (status = 'pending' AND provider_message_id IS NULL AND sent_at IS NULL);
CREATE INDEX exp_email_outbox_status_idx ON public.exp_email_outbox(status, created_at);

ALTER TABLE public.exp_sales_demos
  ADD COLUMN IF NOT EXISTS meeting_kind text DEFAULT 'demo',
  ADD COLUMN IF NOT EXISTS calendar_status text DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS calendar_event_id text,
  ADD COLUMN IF NOT EXISTS calendar_error text,
  ADD COLUMN IF NOT EXISTS duration_minutes integer DEFAULT 30;

ALTER TABLE public.exp_sales_tasks
  ADD COLUMN IF NOT EXISTS reminded_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_alert_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.exp_sales_alerts
  ADD COLUMN IF NOT EXISTS rule text,
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS suggested_task jsonb,
  ADD COLUMN IF NOT EXISTS accepted_task_id uuid,
  ADD COLUMN IF NOT EXISTS accepted_by uuid,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_batch text;
CREATE UNIQUE INDEX IF NOT EXISTS exp_sales_alerts_dedupe_key_uidx ON public.exp_sales_alerts(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Resolve an opportunity owner (rep id or rep name) to a rep id.
CREATE OR REPLACE FUNCTION public.exp_resolve_rep(p_owner text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM exp_sales_reps WHERE id::text = p_owner OR name = p_owner ORDER BY (id::text = p_owner) DESC LIMIT 1
$$;

-- Alert engine. Every alert has an owner (the opportunity owner rep). Dedupe keys make it idempotent.
CREATE OR REPLACE FUNCTION public.exp_alerts_generate(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; v_n integer; v_week text := to_char(p_now, 'IYYY-IW');
BEGIN
  -- open opportunities with a logo
  CREATE TEMP TABLE IF NOT EXISTS _opps ON COMMIT DROP AS SELECT 1 AS x WHERE false;
  DROP TABLE IF EXISTS _opps;
  CREATE TEMP TABLE _opps ON COMMIT DROP AS
    SELECT p.id, p.account_id, p.name, p.stage, p.created_at, p.is_demo, p.demo_batch, exp_resolve_rep(p.owner) AS owner_id,
           CASE WHEN p.org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.org_id::uuid END AS org_id
      FROM exp_sales_pipeline p WHERE coalesce(p.stage,'') NOT IN ('won','lost');

  -- 1. new claim in the logo (last 24h)
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'new_claim', 'new_claim', 'New claim: ' || coalesce(c.entity_label,'profile') || ' (' || c.event_type || ')', 'info', o.owner_id,
         'new_claim:' || o.id || ':' || c.id, o.is_demo, o.demo_batch
    FROM _opps o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
   WHERE c.event_type IN ('claimed','engaged','upgraded') AND c.occurred_at > p_now - interval '1 day'
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- 2. exec-level contact engaged (last touch in 24h)
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'exec_engaged', 'exec_engaged', 'Executive engaged: ' || trim(coalesce(ct.first_name,'') || ' ' || coalesce(ct.last_name,'')) || ' · ' || ct.job_title, 'high', o.owner_id,
         'exec_engaged:' || o.id || ':' || oc.id || ':' || to_char(oc.last_touch_at, 'YYYYMMDD'), o.is_demo, o.demo_batch
    FROM _opps o JOIN exp_opportunity_contacts oc ON oc.opportunity_id = o.id JOIN exp_contacts ct ON ct.id = oc.contact_id
   WHERE oc.last_touch_at > p_now - interval '1 day'
     AND ct.job_title ~* '(^|\W)(ceo|cfo|coo|cmo|cto|chief|president|founder|owner|evp|svp|vp|vice president)(\W|$)'
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- 3. multi-location upgrade (>=2 distinct upgraded profiles in 7d)
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'multi_location_upgrade', 'multi_location_upgrade', count(DISTINCT c.entity_id) || ' locations upgraded in the last 7 days', 'high', o.owner_id,
         'multi_location_upgrade:' || o.id || ':' || v_week, o.is_demo, o.demo_batch
    FROM _opps o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
   WHERE c.upgraded AND c.occurred_at > p_now - interval '7 days'
   GROUP BY o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch HAVING count(DISTINCT c.entity_id) >= 2
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- 4. engagement spike (NORA engagement 7d >= 2x the prior 28d weekly average, and > 0)
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT s.id, s.account_id, s.name, 'engagement_spike', 'engagement_spike', 'Engagement spike: ' || round(s.recent) || ' this week vs ' || round(s.baseline, 1) || ' weekly average', 'info', s.owner_id,
         'engagement_spike:' || s.id || ':' || v_week, s.is_demo, s.demo_batch
    FROM (SELECT o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch,
                 sum(coalesce(c.nora_engagement,0)) FILTER (WHERE c.occurred_at > p_now - interval '7 days') AS recent,
                 sum(coalesce(c.nora_engagement,0)) FILTER (WHERE c.occurred_at <= p_now - interval '7 days' AND c.occurred_at > p_now - interval '35 days') / 4.0 AS baseline
            FROM _opps o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
           GROUP BY o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch) s
   WHERE s.recent > 0 AND s.recent >= 2 * greatest(coalesce(s.baseline,0), 1)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- 5. cluster activity (>=3 claim events across >=2 profiles in 7d)
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'cluster_activity', 'cluster_activity', count(*) || ' claim events across ' || count(DISTINCT c.entity_id) || ' profiles this week', 'info', o.owner_id,
         'cluster_activity:' || o.id || ':' || v_week, o.is_demo, o.demo_batch
    FROM _opps o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
   WHERE c.occurred_at > p_now - interval '7 days'
   GROUP BY o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch HAVING count(*) >= 3 AND count(DISTINCT c.entity_id) >= 2
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- 6. no seller activity for 14 days (NORA suggestion)
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_nora_suggested, suggested_task, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'no_seller_activity', 'no_seller_activity', 'No seller activity for 14+ days. NORA suggests a check-in call.', 'warning', o.owner_id,
         'no_seller_activity:' || o.id || ':' || v_week, true,
         jsonb_build_object('title', 'Check-in call with ' || o.name, 'task_type', 'call', 'due_in_days', 1, 'priority', 'high'), o.is_demo, o.demo_batch
    FROM _opps o
   WHERE o.created_at < p_now - interval '14 days'
     AND NOT EXISTS (SELECT 1 FROM exp_activity_events e WHERE e.subject_id = o.id::text AND e.occurred_at > p_now - interval '14 days')
     AND NOT EXISTS (SELECT 1 FROM exp_sales_notes n WHERE n.subject_id = o.id::text AND n.created_at > p_now - interval '14 days')
     AND NOT EXISTS (SELECT 1 FROM exp_sales_tasks t WHERE t.opportunity_id = o.id AND t.created_at > p_now - interval '14 days')
     AND NOT EXISTS (SELECT 1 FROM exp_opportunity_stage_history h WHERE h.opportunity_id = o.id AND h.moved_at > p_now - interval '14 days')
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- 7. stuck in stage for 21 days (NORA suggestion)
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_nora_suggested, suggested_task, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'stuck_in_stage', 'stuck_in_stage', 'In ' || o.stage || ' for ' || extract(day FROM p_now - s.since)::int || ' days. NORA suggests a next-step meeting.', 'warning', o.owner_id,
         'stuck_in_stage:' || o.id || ':' || o.stage, true,
         jsonb_build_object('title', 'Book next-step meeting to move ' || o.name || ' out of ' || o.stage, 'task_type', 'meeting', 'due_in_days', 3, 'priority', 'high'), o.is_demo, o.demo_batch
    FROM _opps o
    CROSS JOIN LATERAL (SELECT coalesce(max(h.moved_at), o.created_at) AS since FROM exp_opportunity_stage_history h WHERE h.opportunity_id = o.id AND h.to_stage = o.stage) s
   WHERE s.since < p_now - interval '21 days'
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- score/node growth and login spikes: no time-series source exists yet; intentionally not generated.
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.exp_alerts_generate(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_alerts_generate(timestamptz) TO authenticated, service_role;

-- Human acceptance of a NORA suggestion creates a real task.
CREATE OR REPLACE FUNCTION public.exp_alert_accept(p_alert uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a exp_sales_alerts%ROWTYPE; v_task uuid; v_s jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO a FROM exp_sales_alerts WHERE id = p_alert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alert not found'; END IF;
  IF a.accepted_task_id IS NOT NULL THEN RETURN a.accepted_task_id; END IF;
  IF NOT a.is_nora_suggested OR a.suggested_task IS NULL THEN RAISE EXCEPTION 'Only NORA suggestions can be accepted into tasks'; END IF;
  v_s := a.suggested_task;
  INSERT INTO exp_sales_tasks(owner_id, opportunity_id, account_id, title, task_type, due_at, priority, source_alert_id, created_by, is_demo, demo_batch)
  VALUES (a.owner_id, a.opportunity_id, a.account_id, v_s->>'title', coalesce(v_s->>'task_type','task'),
          now() + make_interval(days => coalesce((v_s->>'due_in_days')::int, 1)), coalesce(v_s->>'priority','normal'), a.id, auth.uid(), a.is_demo, a.demo_batch)
  RETURNING id INTO v_task;
  UPDATE exp_sales_alerts SET accepted_task_id = v_task, accepted_by = auth.uid(), accepted_at = now(), acknowledged = true WHERE id = a.id;
  INSERT INTO audit_log(user_id, action, entity_type, entity_id, field_changes)
  VALUES (auth.uid(), 'nora_suggestion_accepted', 'opportunity', a.opportunity_id, jsonb_build_object('alert_id', a.id, 'task_id', v_task));
  RETURN v_task;
END $$;
REVOKE ALL ON FUNCTION public.exp_alert_accept(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_alert_accept(uuid) TO authenticated;

-- Reminder delivery: in-app alert always; Gmail outbox row when Google is connected.
CREATE OR REPLACE FUNCTION public.exp_task_reminders_tick(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_connected boolean; v_n integer := 0; t record;
BEGIN
  SELECT coalesce(bool_or(status = 'connected'), false) INTO v_connected FROM exp_integration_google;
  FOR t IN SELECT tk.*, r.email AS rep_email, p.name AS opp_name FROM exp_sales_tasks tk
             LEFT JOIN exp_sales_reps r ON r.id = tk.owner_id LEFT JOIN exp_sales_pipeline p ON p.id = tk.opportunity_id
            WHERE NOT coalesce(tk.done,false) AND tk.reminded_at IS NULL AND tk.due_at IS NOT NULL AND tk.due_at <= p_now + interval '1 day'
  LOOP
    INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
    VALUES (t.opportunity_id, t.account_id, t.opp_name, 'task_due', 'task_due', 'Due ' || to_char(t.due_at, 'Mon DD HH24:MI') || ' UTC: ' || coalesce(t.title,'task'), CASE WHEN t.due_at < p_now THEN 'warning' ELSE 'info' END, t.owner_id, 'task_due:' || t.id, t.is_demo, t.demo_batch)
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
    IF v_connected AND t.rep_email IS NOT NULL THEN
      INSERT INTO exp_email_outbox(opportunity_id, task_id, kind, from_address, to_addresses, subject, body, status, created_by, is_demo, demo_batch)
      VALUES (t.opportunity_id, t.id, 'reminder', t.rep_email, ARRAY[t.rep_email], 'Reminder: ' || coalesce(t.title,'task'), 'Due ' || t.due_at::text || coalesce(' · ' || t.opp_name, ''), 'pending', NULL, t.is_demo, t.demo_batch);
    END IF;
    UPDATE exp_sales_tasks SET reminded_at = p_now WHERE id = t.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.exp_task_reminders_tick(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_task_reminders_tick(timestamptz) TO authenticated, service_role;

-- Removable demo seed (Jimmy John's demo cluster) + teardown, tagged by demo_batch.
CREATE OR REPLACE FUNCTION public.exp_crm_demo_seed(p_batch text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_loc1 uuid; v_loc2 uuid; v_terr uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT exp_ctrl_has_role(ARRAY['super_admin']) THEN RAISE EXCEPTION 'Super admin required'; END IF;
  IF p_batch IS NULL OR p_batch !~ '^crm_e2e_[a-z0-9_]+$' THEN RAISE EXCEPTION 'Batch must match crm_e2e_*'; END IF;
  INSERT INTO organizations(name, slug, is_demo, entity_type) VALUES ('Jimmy John''s (Demo)', 'jimmy-johns-demo-' || p_batch, true, 'organization') RETURNING id INTO v_org;
  INSERT INTO organizations(name, slug, is_demo, entity_type, parent_org_id) VALUES ('Jimmy John''s (Demo) · Champaign', 'jimmy-johns-demo-champaign-' || p_batch, true, 'location', v_org) RETURNING id INTO v_loc1;
  INSERT INTO organizations(name, slug, is_demo, entity_type, parent_org_id) VALUES ('Jimmy John''s (Demo) · Urbana', 'jimmy-johns-demo-urbana-' || p_batch, true, 'location', v_org) RETURNING id INTO v_loc2;
  INSERT INTO exp_claim_events(entity_type, entity_id, entity_label, logo_org_id, event_type, upgraded, nora_engagement, occurred_at, is_demo, demo_batch) VALUES
    ('location', v_loc1, 'Champaign', v_org, 'claimed', true, 5, now() - interval '2 hours', true, p_batch),
    ('location', v_loc2, 'Urbana', v_org, 'upgraded', true, 7, now() - interval '3 hours', true, p_batch),
    ('location', v_loc1, 'Champaign', v_org, 'engaged', false, 4, now() - interval '1 day', true, p_batch);
  SELECT id INTO v_terr FROM exp_territories ORDER BY created_at LIMIT 1;
  IF v_terr IS NOT NULL THEN INSERT INTO exp_territory_brand(territory_id, org_id, lane) VALUES (v_terr, v_org, 'location'); END IF;
  RETURN jsonb_build_object('org_id', v_org, 'locations', jsonb_build_array(v_loc1, v_loc2), 'territory_id', v_terr);
END $$;
REVOKE ALL ON FUNCTION public.exp_crm_demo_seed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_crm_demo_seed(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.exp_crm_demo_teardown(p_batch text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_orgs uuid[]; v_opps uuid[]; v_out jsonb := '{}'; v_n integer;
BEGIN
  IF p_batch IS NULL OR p_batch !~ '^crm_e2e_[a-z0-9_]+$' THEN RAISE EXCEPTION 'Batch must match crm_e2e_*'; END IF;
  SELECT array_agg(id) INTO v_orgs FROM organizations WHERE is_demo AND slug LIKE 'jimmy-johns-demo-%' || p_batch;
  SELECT array_agg(id) INTO v_opps FROM exp_sales_pipeline WHERE org_id = ANY(SELECT unnest(v_orgs)::text);
  v_opps := coalesce(v_opps, '{}'); v_orgs := coalesce(v_orgs, '{}');
  DELETE FROM exp_sales_alerts WHERE opportunity_id = ANY(v_opps) OR demo_batch = p_batch; GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('alerts', v_n);
  DELETE FROM exp_email_outbox WHERE opportunity_id = ANY(v_opps); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('outbox', v_n);
  DELETE FROM exp_sales_tasks WHERE opportunity_id = ANY(v_opps); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('tasks', v_n);
  DELETE FROM exp_sales_demos WHERE opportunity_id = ANY(v_opps); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('demos', v_n);
  DELETE FROM exp_sales_notes WHERE subject_id = ANY(SELECT unnest(v_opps)::text); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('notes', v_n);
  DELETE FROM exp_activity_events WHERE subject_id = ANY(SELECT unnest(v_opps)::text); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('activity', v_n);
  DELETE FROM exp_contacts WHERE id IN (SELECT contact_id FROM exp_opportunity_contacts WHERE opportunity_id = ANY(v_opps));
  DELETE FROM exp_opportunity_contacts WHERE opportunity_id = ANY(v_opps);
  DELETE FROM exp_opportunity_products WHERE opportunity_id = ANY(v_opps);
  DELETE FROM exp_quotes WHERE opportunity_id = ANY(v_opps); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('quotes', v_n);
  DELETE FROM exp_opportunity_stage_history WHERE opportunity_id = ANY(v_opps);
  DELETE FROM exp_opportunity_owner_history WHERE opportunity_id = ANY(v_opps);
  DELETE FROM exp_opportunity_files WHERE opportunity_id = ANY(v_opps);
  DELETE FROM exp_sales_pipeline WHERE id = ANY(v_opps); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('opportunities', v_n);
  DELETE FROM exp_claim_events WHERE demo_batch = p_batch OR logo_org_id = ANY(v_orgs); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('claims', v_n);
  DELETE FROM exp_territory_brand WHERE org_id = ANY(v_orgs);
  DELETE FROM exp_accounts WHERE org_id = ANY(v_orgs);
  DELETE FROM organizations WHERE id = ANY(v_orgs) AND parent_org_id IS NOT NULL;
  DELETE FROM organizations WHERE id = ANY(v_orgs); GET DIAGNOSTICS v_n = ROW_COUNT; v_out := v_out || jsonb_build_object('organizations_root', v_n);
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.exp_crm_demo_teardown(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_crm_demo_teardown(text) TO authenticated, service_role;

-- Daily alert engine + reminders (once per day, 13:00 UTC).
SELECT cron.schedule('exp-crm-alerts-daily', '0 13 * * *', $$SELECT public.exp_alerts_generate(); SELECT public.exp_task_reminders_tick();$$);
