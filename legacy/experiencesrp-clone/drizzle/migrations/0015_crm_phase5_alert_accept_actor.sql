-- Accepting a NORA suggestion must not require the actor to have a user_accounts row; actor recorded in the audit payload.
CREATE OR REPLACE FUNCTION public.exp_alert_accept(p_alert uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE a exp_sales_alerts%ROWTYPE; v_task uuid; v_s jsonb; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO a FROM exp_sales_alerts WHERE id = p_alert FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alert not found'; END IF;
  IF a.accepted_task_id IS NOT NULL THEN RETURN a.accepted_task_id; END IF;
  IF NOT a.is_nora_suggested OR a.suggested_task IS NULL THEN RAISE EXCEPTION 'Only NORA suggestions can be accepted into tasks'; END IF;
  v_s := a.suggested_task;
  INSERT INTO exp_sales_tasks(owner_id, opportunity_id, account_id, title, task_type, due_at, priority, source_alert_id, created_by, is_demo, demo_batch)
  VALUES (a.owner_id, a.opportunity_id, a.account_id, v_s->>'title', coalesce(v_s->>'task_type','task'),
          now() + make_interval(days => coalesce((v_s->>'due_in_days')::int, 1)), coalesce(v_s->>'priority','normal'), a.id, v_uid, a.is_demo, a.demo_batch)
  RETURNING id INTO v_task;
  UPDATE exp_sales_alerts SET accepted_task_id = v_task, accepted_by = v_uid, accepted_at = now(), acknowledged = true WHERE id = a.id;
  INSERT INTO audit_log(user_id, action, entity_type, entity_id, field_changes)
  VALUES ((SELECT id FROM user_accounts WHERE id = v_uid), 'nora_suggestion_accepted', 'opportunity', a.opportunity_id,
          jsonb_build_object('alert_id', a.id, 'task_id', v_task, 'actor_user_id', v_uid));
  RETURN v_task;
END $function$;
