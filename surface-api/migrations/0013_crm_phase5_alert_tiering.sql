-- lovable-cron-fallback-reviewed: due reminders are wall-clock time-based (no row change at due time); user requires ~5-minute delivery; bounded indexed scan.

CREATE OR REPLACE FUNCTION public.exp_open_opps(p_org uuid)
RETURNS TABLE(id uuid, account_id uuid, name text, stage text, created_at timestamptz, is_demo boolean, demo_batch text, owner_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.account_id, p.name, p.stage, p.created_at, p.is_demo, p.demo_batch, exp_resolve_rep(p.owner),
         CASE WHEN p.org_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.org_id::uuid END
    FROM exp_sales_pipeline p
   WHERE coalesce(p.stage,'') NOT IN ('won','lost') AND (p_org IS NULL OR p.org_id = p_org::text)
$$;

CREATE OR REPLACE FUNCTION public.exp_alerts_event_rules(p_org uuid, p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; v_n integer; v_week text := to_char(p_now, 'IYYY-IW');
BEGIN
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'new_claim', 'new_claim', 'New claim: ' || coalesce(c.entity_label,'profile') || ' (' || c.event_type || ')', 'info', o.owner_id,
         'new_claim:' || o.id || ':' || c.id, o.is_demo, o.demo_batch
    FROM exp_open_opps(p_org) o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
   WHERE c.event_type IN ('claimed','engaged','upgraded') AND c.occurred_at > p_now - interval '1 day'
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'exec_engaged', 'exec_engaged', 'Executive engaged: ' || trim(coalesce(ct.first_name,'') || ' ' || coalesce(ct.last_name,'')) || ' · ' || ct.job_title, 'high', o.owner_id,
         'exec_engaged:' || o.id || ':' || oc.id || ':' || to_char(oc.last_touch_at, 'YYYYMMDD'), o.is_demo, o.demo_batch
    FROM exp_open_opps(p_org) o JOIN exp_opportunity_contacts oc ON oc.opportunity_id = o.id JOIN exp_contacts ct ON ct.id = oc.contact_id
   WHERE oc.last_touch_at > p_now - interval '1 day'
     AND ct.job_title ~* '(^|\W)(ceo|cfo|coo|cmo|cto|chief|president|founder|owner|evp|svp|vp|vice president)(\W|$)'
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'multi_location_upgrade', 'multi_location_upgrade', count(DISTINCT c.entity_id) || ' locations upgraded in the last 7 days', 'high', o.owner_id,
         'multi_location_upgrade:' || o.id || ':' || v_week, o.is_demo, o.demo_batch
    FROM exp_open_opps(p_org) o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
   WHERE c.upgraded AND c.occurred_at > p_now - interval '7 days'
   GROUP BY o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch HAVING count(DISTINCT c.entity_id) >= 2
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT s.id, s.account_id, s.name, 'engagement_spike', 'engagement_spike', 'Engagement spike: ' || round(s.recent) || ' this week vs ' || round(coalesce(s.baseline,0), 1) || ' weekly average', 'info', s.owner_id,
         'engagement_spike:' || s.id || ':' || v_week, s.is_demo, s.demo_batch
    FROM (SELECT o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch,
                 sum(coalesce(c.nora_engagement,0)) FILTER (WHERE c.occurred_at > p_now - interval '7 days') AS recent,
                 sum(coalesce(c.nora_engagement,0)) FILTER (WHERE c.occurred_at <= p_now - interval '7 days' AND c.occurred_at > p_now - interval '35 days') / 4.0 AS baseline
            FROM exp_open_opps(p_org) o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
           GROUP BY o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch) s
   WHERE s.recent > 0 AND s.recent >= 2 * greatest(coalesce(s.baseline,0), 1)
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'cluster_activity', 'cluster_activity', count(*) || ' claim events across ' || count(DISTINCT c.entity_id) || ' profiles this week', 'info', o.owner_id,
         'cluster_activity:' || o.id || ':' || v_week, o.is_demo, o.demo_batch
    FROM exp_open_opps(p_org) o JOIN exp_claim_events c ON c.logo_org_id = o.org_id
   WHERE c.occurred_at > p_now - interval '7 days'
   GROUP BY o.id, o.account_id, o.name, o.owner_id, o.is_demo, o.demo_batch HAVING count(*) >= 3 AND count(DISTINCT c.entity_id) >= 2
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.exp_alerts_absence_rules(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; v_n integer; v_week text := to_char(p_now, 'IYYY-IW');
BEGIN
  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_nora_suggested, suggested_task, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'no_seller_activity', 'no_seller_activity', 'No seller activity for 14+ days. NORA suggests a check-in call.', 'warning', o.owner_id,
         'no_seller_activity:' || o.id || ':' || v_week, true,
         jsonb_build_object('title', 'Check-in call with ' || o.name, 'task_type', 'call', 'due_in_days', 1, 'priority', 'high'), o.is_demo, o.demo_batch
    FROM exp_open_opps(NULL) o
   WHERE o.created_at < p_now - interval '14 days'
     AND NOT EXISTS (SELECT 1 FROM exp_activity_events e WHERE e.subject_id = o.id::text AND e.occurred_at > p_now - interval '14 days')
     AND NOT EXISTS (SELECT 1 FROM exp_sales_notes n WHERE n.subject_id = o.id::text AND n.created_at > p_now - interval '14 days')
     AND NOT EXISTS (SELECT 1 FROM exp_sales_tasks t WHERE t.opportunity_id = o.id AND t.created_at > p_now - interval '14 days')
     AND NOT EXISTS (SELECT 1 FROM exp_opportunity_stage_history h WHERE h.opportunity_id = o.id AND h.moved_at > p_now - interval '14 days')
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_nora_suggested, suggested_task, is_demo, demo_batch)
  SELECT o.id, o.account_id, o.name, 'stuck_in_stage', 'stuck_in_stage', 'In ' || o.stage || ' for ' || extract(day FROM p_now - s.since)::int || ' days. NORA suggests a next-step meeting.', 'warning', o.owner_id,
         'stuck_in_stage:' || o.id || ':' || o.stage, true,
         jsonb_build_object('title', 'Book next-step meeting to move ' || o.name || ' out of ' || o.stage, 'task_type', 'meeting', 'due_in_days', 3, 'priority', 'high'), o.is_demo, o.demo_batch
    FROM exp_open_opps(NULL) o
    CROSS JOIN LATERAL (SELECT coalesce(max(h.moved_at), o.created_at) AS since FROM exp_opportunity_stage_history h WHERE h.opportunity_id = o.id AND h.to_stage = o.stage) s
   WHERE s.since < p_now - interval '21 days'
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
  -- score/node growth over time: added here once a time-series source exists.
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.exp_alerts_generate(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN exp_alerts_event_rules(NULL, p_now) + exp_alerts_absence_rules(p_now);
END $$;

REVOKE ALL ON FUNCTION public.exp_alerts_event_rules(uuid, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_alerts_absence_rules(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_open_opps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_alerts_event_rules(uuid, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_alerts_absence_rules(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_open_opps(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exp_alerts_claim_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.logo_org_id IS NOT NULL THEN
    BEGIN PERFORM exp_alerts_event_rules(NEW.logo_org_id, now());
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'alert engine (claim) failed: %', SQLERRM; END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS exp_alerts_on_claim ON public.exp_claim_events;
CREATE TRIGGER exp_alerts_on_claim AFTER INSERT OR UPDATE OF upgraded, event_type ON public.exp_claim_events
  FOR EACH ROW EXECUTE FUNCTION public.exp_alerts_claim_trg();

CREATE OR REPLACE FUNCTION public.exp_alerts_opp_event_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb := to_jsonb(NEW); v_opp text; v_org text;
BEGIN
  IF TG_TABLE_NAME = 'exp_activity_events' THEN
    IF r->>'subject_type' = 'opportunity' THEN v_opp := r->>'subject_id'; END IF;
  ELSE v_opp := r->>'opportunity_id'; END IF;
  IF v_opp IS NULL OR v_opp !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT org_id INTO v_org FROM exp_sales_pipeline WHERE id = v_opp::uuid;
  IF v_org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    BEGIN PERFORM exp_alerts_event_rules(v_org::uuid, now());
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'alert engine (%) failed: %', TG_TABLE_NAME, SQLERRM; END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS exp_alerts_on_activity ON public.exp_activity_events;
CREATE TRIGGER exp_alerts_on_activity AFTER INSERT ON public.exp_activity_events
  FOR EACH ROW EXECUTE FUNCTION public.exp_alerts_opp_event_trg();
DROP TRIGGER IF EXISTS exp_alerts_on_contact_touch ON public.exp_opportunity_contacts;
CREATE TRIGGER exp_alerts_on_contact_touch AFTER INSERT OR UPDATE OF last_touch_at ON public.exp_opportunity_contacts
  FOR EACH ROW EXECUTE FUNCTION public.exp_alerts_opp_event_trg();

ALTER TABLE public.exp_email_outbox DROP CONSTRAINT IF EXISTS exp_email_outbox_kind_check;
ALTER TABLE public.exp_email_outbox ADD CONSTRAINT exp_email_outbox_kind_check CHECK (kind IN ('email','reminder','alert'));
ALTER TABLE public.exp_email_outbox ADD COLUMN IF NOT EXISTS alert_id uuid;

CREATE OR REPLACE FUNCTION public.exp_alert_notify_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text;
BEGIN
  IF NEW.rule = 'task_due' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM exp_integration_google WHERE status = 'connected' AND domain_status = 'verified') THEN RETURN NULL; END IF;
  SELECT email INTO v_email FROM exp_sales_reps WHERE id = NEW.owner_id;
  IF v_email IS NULL THEN RETURN NULL; END IF;
  INSERT INTO exp_email_outbox(opportunity_id, alert_id, kind, from_address, to_addresses, subject, body, status, is_demo, demo_batch)
  VALUES (NEW.opportunity_id, NEW.id, 'alert', v_email, ARRAY[v_email], 'Alert: ' || replace(coalesce(NEW.rule, NEW.alert_type, 'alert'), '_', ' ') || coalesce(' · ' || NEW.logo, ''), coalesce(NEW.body, ''), 'pending', NEW.is_demo, NEW.demo_batch);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RAISE WARNING 'alert notify failed: %', SQLERRM; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS exp_alert_notify ON public.exp_sales_alerts;
CREATE TRIGGER exp_alert_notify AFTER INSERT ON public.exp_sales_alerts
  FOR EACH ROW EXECUTE FUNCTION public.exp_alert_notify_trg();

CREATE OR REPLACE FUNCTION public.exp_task_reminders_tick(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_connected boolean; v_n integer := 0; t record;
BEGIN
  SELECT coalesce(bool_or(status = 'connected' AND domain_status = 'verified'), false) INTO v_connected FROM exp_integration_google;
  FOR t IN SELECT tk.*, r.email AS rep_email, p.name AS opp_name FROM exp_sales_tasks tk
             LEFT JOIN exp_sales_reps r ON r.id = tk.owner_id LEFT JOIN exp_sales_pipeline p ON p.id = tk.opportunity_id
            WHERE NOT coalesce(tk.done,false) AND tk.reminded_at IS NULL AND tk.due_at IS NOT NULL AND tk.due_at <= p_now
            LIMIT 500
  LOOP
    INSERT INTO exp_sales_alerts(opportunity_id, account_id, logo, alert_type, rule, body, severity, owner_id, dedupe_key, is_demo, demo_batch)
    VALUES (t.opportunity_id, t.account_id, t.opp_name, 'task_due', 'task_due', 'Due now: ' || coalesce(t.title,'task'), 'warning', t.owner_id, 'task_due:' || t.id, t.is_demo, t.demo_batch)
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
CREATE INDEX IF NOT EXISTS exp_sales_tasks_due_unreminded_idx ON public.exp_sales_tasks(due_at) WHERE reminded_at IS NULL AND NOT coalesce(done, false);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'exp_sales_alerts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.exp_sales_alerts;
  END IF;
END $$;

SELECT cron.unschedule('exp-crm-alerts-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'exp-crm-alerts-daily');
SELECT cron.schedule('exp-crm-reminders-5min', '*/5 * * * *', $$SELECT public.exp_task_reminders_tick();$$);
SELECT cron.schedule('exp-crm-absence-daily', '0 13 * * *', $$SELECT public.exp_alerts_absence_rules();$$);
