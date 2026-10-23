ALTER TABLE public.exp_claim_events ADD COLUMN IF NOT EXISTS contact_updated_at timestamptz;
ALTER TABLE public.exp_claim_events ADD COLUMN IF NOT EXISTS contact_updated_by uuid;

CREATE TABLE IF NOT EXISTS public.exp_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_event_id uuid NOT NULL REFERENCES public.exp_claim_events(id) ON DELETE CASCADE,
  entity_type text,
  entity_id uuid,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
  destination text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','cancelled')),
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exp_verification_requests_event_idx ON public.exp_verification_requests(claim_event_id);
COMMENT ON TABLE public.exp_verification_requests IS 'Claim verification outbox. Rows are queued (pending); no transport sends them yet.';
GRANT SELECT ON public.exp_verification_requests TO authenticated;
GRANT ALL ON public.exp_verification_requests TO service_role;
ALTER TABLE public.exp_verification_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read exp_verification_requests" ON public.exp_verification_requests FOR SELECT TO authenticated USING (true);

-- Governed contact change on a claim record. Claimed rows need an explicit override from a super_admin.
CREATE OR REPLACE FUNCTION public.exp_claim_set_contact(p_event uuid, p_phone text, p_email text, p_claimed_override boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.exp_claim_events%ROWTYPE; v_claimed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT * INTO r FROM public.exp_claim_events WHERE id = p_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim record not found'; END IF;
  v_claimed := r.event_type IN ('claimed','engaged','upgraded');
  IF v_claimed AND NOT (p_claimed_override AND public.exp_ctrl_has_role(ARRAY['super_admin'])) THEN
    RAISE EXCEPTION 'Profile is claimed: contact change needs the claimed-override flag from a super admin';
  END IF;
  UPDATE public.exp_claim_events
     SET contact_phone = NULLIF(btrim(p_phone), ''), contact_email = NULLIF(lower(btrim(p_email)), ''),
         contact_updated_at = now(), contact_updated_by = auth.uid()
   WHERE id = p_event;
  INSERT INTO public.audit_log(user_id, action, entity_type, entity_id, field_changes)
  VALUES (auth.uid(), 'claim_contact_change', coalesce(r.entity_type, 'claim_event'), p_event,
    jsonb_build_object('phone', jsonb_build_object('old', r.contact_phone, 'new', NULLIF(btrim(p_phone), '')),
                       'email', jsonb_build_object('old', r.contact_email, 'new', NULLIF(lower(btrim(p_email)), '')),
                       'claimed_override', v_claimed));
  RETURN jsonb_build_object('id', p_event, 'claimed_override', v_claimed);
END $$;
REVOKE ALL ON FUNCTION public.exp_claim_set_contact(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_claim_set_contact(uuid, text, text, boolean) TO authenticated;

-- Enqueue verification (no transport): one pending row per event, skipping events already pending.
CREATE OR REPLACE FUNCTION public.exp_claim_queue_verification(p_events uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  WITH ins AS (
    INSERT INTO public.exp_verification_requests(claim_event_id, entity_type, entity_id, channel, destination, requested_by)
    SELECT e.id, e.entity_type, e.entity_id,
           CASE WHEN e.contact_email IS NOT NULL THEN 'email' ELSE 'sms' END,
           coalesce(e.contact_email, e.contact_phone), auth.uid()
      FROM public.exp_claim_events e
     WHERE e.id = ANY(p_events)
       AND coalesce(e.contact_email, e.contact_phone) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.exp_verification_requests v WHERE v.claim_event_id = e.id AND v.status = 'pending')
    RETURNING id, claim_event_id)
  SELECT count(*) INTO n FROM ins;
  INSERT INTO public.audit_log(user_id, action, entity_type, field_changes)
  VALUES (auth.uid(), 'claim_verification_queued', 'claim_event', jsonb_build_object('requested', cardinality(p_events), 'queued', n));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.exp_claim_queue_verification(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_claim_queue_verification(uuid[]) TO authenticated;