CREATE OR REPLACE FUNCTION public.exp_claim_queue_verification(p_events uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  WITH ins AS (
    INSERT INTO public.exp_verification_requests(claim_event_id, entity_type, entity_id, channel, destination, requested_by)
    SELECT e.id, e.entity_type,
           CASE WHEN e.entity_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN e.entity_id::text::uuid END,
           CASE WHEN e.contact_email IS NOT NULL THEN 'email' ELSE 'sms' END,
           coalesce(e.contact_email, e.contact_phone), auth.uid()
      FROM public.exp_claim_events e
     WHERE e.id = ANY(p_events)
       AND coalesce(e.contact_email, e.contact_phone) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.exp_verification_requests v WHERE v.claim_event_id = e.id AND v.status = 'pending')
    RETURNING id, claim_event_id)
  SELECT count(*) INTO n FROM ins;
  INSERT INTO public.audit_log(user_id, action, entity_type, field_changes)
  VALUES ((SELECT ua.id FROM public.user_accounts ua WHERE ua.id = auth.uid()), 'claim_verification_queued', 'claim_event', jsonb_build_object('requested', cardinality(p_events), 'queued', n, 'actor', auth.uid()));
  RETURN n;
END $$;