-- 0021_claim_gate.sql — NORA claim gate (T0/T1/T2, silent precheck, OTP once, GBP Place ID match).
--
-- ONE connected claim system: extends exp_claim / exp_claim_events / claim_queue /
-- exp_verification_requests / exp_control_grants and the existing exp_claim_adjudicate.
-- No new tables, no new roles (the existing 'owner' role, entity-scoped).
--
-- Entity model: exp_entity is the canonical id; the published record (professionals /
-- organizations) is linked by exp_entity.identity_keys.professional_id / organization_id
-- (existing jsonb column + existing GIN index idx_entity_ikeys). The link is written only by
-- _exp_entity_link_record (via exp_entity_for_record / exp_entity_link_record). Backfill
-- below covers today's only link: professionals.detail_url = identity_keys->>'statefarm_url'.
--
-- Trust tier lives on exp_claim.trust_tier (mirrored to claim_queue.trust_tier for the queue UI).
--   T0 authenticated · T1 identity + email verified · T2 ownership proven.
-- A claim binds (grant) at T1+; harmful actions check exp_claim_tier() >= 2.
--
-- Security: every gate function is SECURITY DEFINER with search_path pinned and an auth check.
-- Functions that ASSERT a tier (start/advance/challenge/verify/grant) are service-role only —
-- the server computes the silent precheck; a browser can never self-assert a tier. Release,
-- adjudicate and tier lookup are callable by signed-in users with ownership / role checks.
-- Additive + idempotent: IF NOT EXISTS columns, widened (superset) CHECKs, CREATE OR REPLACE.
-- Never applied by the agent that wrote it.

-- ───────── 1. Columns on the existing claim objects ─────────
ALTER TABLE public.exp_claim ADD COLUMN IF NOT EXISTS trust_tier smallint NOT NULL DEFAULT 0;
ALTER TABLE public.exp_claim ADD COLUMN IF NOT EXISTS tier_path text;
ALTER TABLE public.exp_claim ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE public.exp_claim ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exp_claim_trust_tier_check') THEN
    ALTER TABLE public.exp_claim ADD CONSTRAINT exp_claim_trust_tier_check CHECK (trust_tier BETWEEN 0 AND 2);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_exp_claim_entity_user ON public.exp_claim (entity_id, user_id, status);

ALTER TABLE public.claim_queue ADD COLUMN IF NOT EXISTS trust_tier smallint;
ALTER TABLE public.claim_queue ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES public.exp_claim(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_queue_claim ON public.claim_queue (claim_id);
ALTER TABLE public.claim_queue DROP CONSTRAINT IF EXISTS claim_queue_status_check;
ALTER TABLE public.claim_queue ADD CONSTRAINT claim_queue_status_check CHECK (status = ANY (ARRAY[
  'pending','auto_approved','manual_review','approved','rejected','conflict','released']));

ALTER TABLE public.exp_claim_events ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES public.exp_claim(claim_id);
CREATE INDEX IF NOT EXISTS idx_exp_claim_events_claim ON public.exp_claim_events (claim_id);

-- OTP challenge rides on the existing verification-request row. code_hash is an HMAC keyed by a
-- server secret, so the readable row never reveals the code.
ALTER TABLE public.exp_verification_requests ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES public.exp_claim(claim_id);
ALTER TABLE public.exp_verification_requests ADD COLUMN IF NOT EXISTS code_hash text;
ALTER TABLE public.exp_verification_requests ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.exp_verification_requests ADD COLUMN IF NOT EXISTS attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE public.exp_verification_requests ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_verif_req_claim ON public.exp_verification_requests (claim_id);
ALTER TABLE public.exp_verification_requests DROP CONSTRAINT IF EXISTS exp_verification_requests_status_check;
ALTER TABLE public.exp_verification_requests ADD CONSTRAINT exp_verification_requests_status_check
  CHECK (status = ANY (ARRAY['pending','sent','failed','cancelled','verified','expired']));

-- OTP emails go through the existing exp_outbox (drained by m4_outbox_drain). Its blanket
-- staff policy would expose the code in body_html to any signed-in user, so claim OTP rows are
-- carved out (service role / definer functions only). Every other row keeps today's access.
DROP POLICY IF EXISTS staff_all_exp_outbox ON public.exp_outbox;
CREATE POLICY staff_all_exp_outbox ON public.exp_outbox FOR ALL TO authenticated
  USING (entity_type IS DISTINCT FROM 'claim_otp') WITH CHECK (entity_type IS DISTINCT FROM 'claim_otp');

-- Existing verified claims were staff-adjudicated → ownership proven.
UPDATE public.exp_claim SET trust_tier = 2, tier_path = 'legacy_verified'
 WHERE status = 'verified' AND trust_tier = 0;

-- ───────── 2. professionals/organizations ↔ exp_entity link ─────────
-- Backfill today's link (19,726 entity rows). Each entity matches exactly one professional.
UPDATE public.exp_entity e
   SET identity_keys = e.identity_keys || jsonb_build_object('professional_id', p.id::text),
       updated_at = now()
  FROM public.professionals p
 WHERE e.entity_type = 'professional'
   AND e.identity_keys ->> 'statefarm_url' = p.detail_url
   AND p.detail_url IS NOT NULL
   AND NOT (e.identity_keys ? 'professional_id');

CREATE OR REPLACE FUNCTION public.exp_claim_gate_is_service()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(auth.role(), '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public._exp_entity_link_record(p_entity uuid, p_record_type text, p_record_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text; v_cur text;
BEGIN
  v_key := CASE p_record_type WHEN 'professional' THEN 'professional_id'
                              WHEN 'organization' THEN 'organization_id' END;
  IF v_key IS NULL THEN RAISE EXCEPTION 'unknown record type %', p_record_type; END IF;
  SELECT identity_keys ->> v_key INTO v_cur FROM exp_entity WHERE entity_id = p_entity FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'entity % not found', p_entity; END IF;
  IF v_cur IS NOT NULL AND v_cur <> p_record_id::text THEN
    RAISE EXCEPTION 'entity % is already linked to % %', p_entity, p_record_type, v_cur;
  END IF;
  IF v_cur IS NULL THEN
    UPDATE exp_entity SET identity_keys = identity_keys || jsonb_build_object(v_key, p_record_id::text),
                          updated_at = now()
     WHERE entity_id = p_entity;
  END IF;
END $$;

-- Resolve (and optionally create) the canonical exp_entity for a published record.
CREATE OR REPLACE FUNCTION public._exp_entity_for_record(p_record_type text, p_record_id uuid, p_create boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text; v_entity uuid; v_name text; v_detail text; v_place text; r record;
BEGIN
  v_key := CASE p_record_type WHEN 'professional' THEN 'professional_id'
                              WHEN 'organization' THEN 'organization_id' END;
  IF v_key IS NULL THEN RAISE EXCEPTION 'unknown record type %', p_record_type; END IF;

  SELECT entity_id INTO v_entity FROM exp_entity
   WHERE identity_keys @> jsonb_build_object(v_key, p_record_id::text) AND status <> 'merged'
   ORDER BY CASE claim_state WHEN 'verified' THEN 0 WHEN 'claimed' THEN 1 WHEN 'claim_pending' THEN 2 ELSE 3 END,
            created_at, entity_id
   LIMIT 1;
  IF v_entity IS NOT NULL THEN RETURN v_entity; END IF;

  IF p_record_type = 'professional' THEN
    SELECT coalesce(display_name, concat_ws(' ', first_name, last_name)), detail_url, gbp_place_id
      INTO v_name, v_detail, v_place FROM professionals WHERE id = p_record_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'professional % not found', p_record_id; END IF;
    IF v_detail IS NOT NULL THEN
      FOR r IN SELECT entity_id FROM exp_entity
                WHERE entity_type = 'professional' AND identity_keys ->> 'statefarm_url' = v_detail
                  AND NOT (identity_keys ? v_key) LOOP
        PERFORM _exp_entity_link_record(r.entity_id, p_record_type, p_record_id);
      END LOOP;
    END IF;
  ELSE
    SELECT name, gbp_place_id INTO v_name, v_place FROM organizations WHERE id = p_record_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'organization % not found', p_record_id; END IF;
    IF v_place IS NOT NULL THEN
      FOR r IN SELECT entity_id FROM exp_entity
                WHERE entity_type IN ('location','brand') AND identity_keys ->> 'gbp_place_id' = v_place
                  AND NOT (identity_keys ? v_key) LOOP
        PERFORM _exp_entity_link_record(r.entity_id, p_record_type, p_record_id);
      END LOOP;
    END IF;
  END IF;

  SELECT entity_id INTO v_entity FROM exp_entity
   WHERE identity_keys @> jsonb_build_object(v_key, p_record_id::text) AND status <> 'merged'
   ORDER BY CASE claim_state WHEN 'verified' THEN 0 WHEN 'claimed' THEN 1 WHEN 'claim_pending' THEN 2 ELSE 3 END,
            created_at, entity_id
   LIMIT 1;
  IF v_entity IS NOT NULL OR NOT p_create THEN RETURN v_entity; END IF;

  INSERT INTO exp_entity (entity_type, display_name, status, claim_state, identity_keys, source, confidence)
  VALUES (CASE p_record_type WHEN 'professional' THEN 'professional' ELSE 'location' END,
          v_name, 'resolved', 'unclaimed',
          jsonb_strip_nulls(jsonb_build_object(v_key, p_record_id::text, 'gbp_place_id', v_place)),
          'claim_gate', 0.5)
  RETURNING entity_id INTO v_entity;
  RETURN v_entity;
END $$;

CREATE OR REPLACE FUNCTION public.exp_entity_for_record(p_record_type text, p_record_id uuid, p_create boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (exp_claim_gate_is_service() OR exp_ctrl_has_role(ARRAY['super_admin','architect'])) THEN
    RAISE EXCEPTION 'insufficient grant' USING ERRCODE = '42501';
  END IF;
  RETURN _exp_entity_for_record(p_record_type, p_record_id, p_create);
END $$;

CREATE OR REPLACE FUNCTION public.exp_entity_link_record(p_entity uuid, p_record_type text, p_record_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (exp_claim_gate_is_service() OR exp_ctrl_has_role(ARRAY['super_admin','architect'])) THEN
    RAISE EXCEPTION 'insufficient grant' USING ERRCODE = '42501';
  END IF;
  PERFORM _exp_entity_link_record(p_entity, p_record_type, p_record_id);
END $$;

-- The published record behind an entity: (record_type, record_id).
CREATE OR REPLACE FUNCTION public._exp_entity_record(p_entity uuid, OUT record_type text, OUT record_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN identity_keys ? 'professional_id' THEN 'professional'
              WHEN identity_keys ? 'organization_id' THEN 'organization' END,
         coalesce(identity_keys ->> 'professional_id', identity_keys ->> 'organization_id')::uuid
    FROM exp_entity WHERE entity_id = p_entity;
$$;

-- ───────── 3. Claim events (the funnel log) ─────────
CREATE OR REPLACE FUNCTION public._exp_claim_event(p_claim uuid, p_event text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entity uuid; v_type text; v_rec uuid; v_label text; v_email text; v_state text; v_gcid text; v_id uuid;
BEGIN
  SELECT entity_id INTO v_entity FROM exp_claim WHERE claim_id = p_claim;
  SELECT record_type, record_id INTO v_type, v_rec FROM _exp_entity_record(v_entity);
  IF v_type = 'professional' THEN
    SELECT coalesce(display_name, concat_ws(' ', first_name, last_name)), email, address_state, gcid
      INTO v_label, v_email, v_state, v_gcid FROM professionals WHERE id = v_rec;
  ELSIF v_type = 'organization' THEN
    SELECT name, email, address_state, gcid INTO v_label, v_email, v_state, v_gcid FROM organizations WHERE id = v_rec;
  END IF;
  INSERT INTO exp_claim_events (entity_type, entity_id, entity_label, group_key, event_type,
                                contact_email, is_demo, state, claim_id)
  VALUES (coalesce(v_type, 'entity'), coalesce(v_rec, v_entity)::text, v_label,
          nullif(regexp_replace(coalesce(v_gcid, ''), '^gcid:', ''), ''), p_event, v_email, false, v_state, p_claim)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ───────── 4. Gate: start / advance ─────────
CREATE OR REPLACE FUNCTION public.exp_claim_gate_start(
  p_actor uuid, p_record_type text, p_record_id uuid,
  p_tier smallint DEFAULT 0, p_path text DEFAULT NULL,
  p_confidence smallint DEFAULT 0, p_signals jsonb DEFAULT '{}'::jsonb,
  p_claimant_email text DEFAULT NULL, p_claimant_name text DEFAULT NULL,
  p_method text DEFAULT 'google_oauth')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entity uuid; v_claim uuid; v_tier smallint; v_queue uuid; v_claimed boolean; v_owner uuid;
        v_active boolean; v_created boolean := false;
BEGIN
  IF NOT exp_claim_gate_is_service() THEN RAISE EXCEPTION 'claim gate: service role required' USING ERRCODE = '42501'; END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'claim gate: actor required'; END IF;
  IF p_tier IS NULL OR p_tier NOT BETWEEN 0 AND 2 THEN RAISE EXCEPTION 'invalid trust tier %', p_tier; END IF;

  IF p_record_type = 'professional' THEN
    SELECT coalesce(claimed, false), user_id, coalesce(is_active, true) INTO v_claimed, v_owner, v_active
      FROM professionals WHERE id = p_record_id FOR UPDATE;
  ELSIF p_record_type = 'organization' THEN
    SELECT coalesce(claimed, false), NULL::uuid, coalesce(is_active, true) INTO v_claimed, v_owner, v_active
      FROM organizations WHERE id = p_record_id FOR UPDATE;
  ELSE RAISE EXCEPTION 'unknown record type %', p_record_type; END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'record_not_found'); END IF;
  IF NOT v_active THEN RETURN jsonb_build_object('status', 'record_inactive'); END IF;
  -- Single-pro office: a claim always opens on the professional (the TS loader already swaps; this
  -- makes the database enforce it), and an already-claimed location counts as claimed.
  IF p_record_type = 'organization' AND exp_office_mode('organization', p_record_id)->>'mode' = 'single_pro' THEN
    RAISE EXCEPTION 'claim gate: single-pro office % is claimed through its professional %', p_record_id,
      exp_office_mode('organization', p_record_id)->>'professional_id';
  END IF;
  IF p_record_type = 'professional' AND exp_office_mode('professional', p_record_id)->>'mode' = 'single_pro' THEN
    v_claimed := v_claimed OR coalesce((SELECT o.claimed FROM organizations o
                                         WHERE o.id = (exp_office_mode('professional', p_record_id)->>'location_id')::uuid), false);
  END IF;

  v_entity := _exp_entity_for_record(p_record_type, p_record_id, true);
  PERFORM 1 FROM exp_entity WHERE entity_id = v_entity FOR UPDATE;

  SELECT claim_id INTO v_claim FROM exp_claim
   WHERE entity_id = v_entity AND status = 'verified' AND user_id = p_actor LIMIT 1;
  IF v_claim IS NOT NULL OR (v_claimed AND v_owner = p_actor) THEN
    RETURN jsonb_build_object('status', 'already_owner', 'entity_id', v_entity, 'claim_id', v_claim);
  END IF;
  IF v_claimed OR EXISTS (SELECT 1 FROM exp_claim WHERE entity_id = v_entity AND status = 'verified') THEN
    RETURN jsonb_build_object('status', 'claimed_by_other', 'entity_id', v_entity);
  END IF;

  SELECT claim_id, trust_tier INTO v_claim, v_tier FROM exp_claim
   WHERE entity_id = v_entity AND user_id = p_actor AND status = 'pending'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF v_claim IS NULL THEN
    INSERT INTO exp_claim (entity_id, user_id, evidence, trust_tier, tier_path)
    VALUES (v_entity, p_actor,
            jsonb_build_object('signals', p_signals, 'confidence', p_confidence,
                               'record_type', p_record_type, 'record_id', p_record_id),
            p_tier, CASE WHEN p_tier > 0 THEN p_path END)
    RETURNING claim_id INTO v_claim;
    v_tier := p_tier;
    v_created := true;
    PERFORM _exp_claim_event(v_claim, 'attempted');
    INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
    VALUES (p_actor, 'claimant', 'claim_requested', v_claim::text,
            jsonb_build_object('entity', v_entity, 'tier', p_tier, 'path', p_path));
  ELSE
    UPDATE exp_claim
       SET evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('signals', p_signals, 'confidence', p_confidence),
           trust_tier = greatest(trust_tier, p_tier),
           tier_path = CASE WHEN p_tier > trust_tier THEN p_path ELSE tier_path END,
           updated_at = now()
     WHERE claim_id = v_claim;
    v_tier := greatest(v_tier, p_tier);
  END IF;

  UPDATE exp_entity SET claim_state = 'claim_pending', updated_at = now()
   WHERE entity_id = v_entity AND claim_state IN ('unclaimed', 'invited');

  SELECT id INTO v_queue FROM claim_queue WHERE claim_id = v_claim LIMIT 1;
  IF v_queue IS NULL THEN
    INSERT INTO claim_queue (entity_type, entity_id, claimant_user_id, claimant_email, claimant_name,
                             confidence_score, confidence_signals, match_method, status, trust_tier, claim_id)
    VALUES (p_record_type, p_record_id, p_actor, lower(p_claimant_email), nullif(p_claimant_name, ''),
            p_confidence, coalesce(p_signals, '{}'::jsonb), p_method, 'pending', v_tier, v_claim)
    RETURNING id INTO v_queue;
  ELSE
    UPDATE claim_queue SET confidence_score = p_confidence, confidence_signals = coalesce(p_signals, '{}'::jsonb),
                           trust_tier = v_tier, updated_at = now()
     WHERE id = v_queue;
  END IF;

  RETURN jsonb_build_object('status', 'pending', 'claim_id', v_claim, 'entity_id', v_entity,
                            'queue_id', v_queue, 'trust_tier', v_tier, 'created', v_created);
END $$;

-- Raise a pending claim's tier (never lowers) and/or route its queue row.
CREATE OR REPLACE FUNCTION public.exp_claim_gate_advance(
  p_actor uuid, p_claim uuid, p_tier smallint, p_path text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb, p_queue_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r exp_claim%ROWTYPE; v_tier smallint;
BEGIN
  IF NOT exp_claim_gate_is_service() THEN RAISE EXCEPTION 'claim gate: service role required' USING ERRCODE = '42501'; END IF;
  IF p_tier IS NULL OR p_tier NOT BETWEEN 0 AND 2 THEN RAISE EXCEPTION 'invalid trust tier %', p_tier; END IF;
  IF p_queue_status IS NOT NULL AND p_queue_status NOT IN ('pending', 'manual_review') THEN
    RAISE EXCEPTION 'advance may only route to pending / manual_review';
  END IF;
  SELECT * INTO r FROM exp_claim WHERE claim_id = p_claim FOR UPDATE;
  IF NOT FOUND OR r.user_id <> p_actor THEN RAISE EXCEPTION 'claim not found for this user'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'claim not pending (%)', r.status; END IF;
  v_tier := greatest(r.trust_tier, p_tier);
  UPDATE exp_claim
     SET trust_tier = v_tier,
         tier_path = CASE WHEN p_tier > r.trust_tier THEN p_path ELSE tier_path END,
         evidence = coalesce(evidence, '{}'::jsonb) || coalesce(p_evidence, '{}'::jsonb),
         updated_at = now()
   WHERE claim_id = p_claim;
  UPDATE claim_queue SET trust_tier = v_tier, status = coalesce(p_queue_status, status), updated_at = now()
   WHERE claim_id = p_claim AND status IN ('pending', 'manual_review');
  IF p_tier > r.trust_tier THEN
    INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
    VALUES (p_actor, 'claimant', 'claim_tier_advanced', p_claim::text,
            jsonb_build_object('from', r.trust_tier, 'to', v_tier, 'path', p_path));
  END IF;
  RETURN jsonb_build_object('claim_id', p_claim, 'trust_tier', v_tier, 'entity_id', r.entity_id);
END $$;

-- ───────── 5. Gate: OTP challenge (once per claim) ─────────
CREATE OR REPLACE FUNCTION public.exp_claim_gate_challenge(
  p_actor uuid, p_claim uuid, p_code_hash text, p_subject text, p_body_html text,
  p_ttl_minutes integer DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r exp_claim%ROWTYPE; v_type text; v_rec uuid; v_dest text; v_name text; v_key text; v_event uuid; v_req uuid;
BEGIN
  IF NOT exp_claim_gate_is_service() THEN RAISE EXCEPTION 'claim gate: service role required' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_code_hash, '') = '' THEN RAISE EXCEPTION 'code hash required'; END IF;
  SELECT * INTO r FROM exp_claim WHERE claim_id = p_claim FOR UPDATE;
  IF NOT FOUND OR r.user_id <> p_actor THEN RAISE EXCEPTION 'claim not found for this user'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'claim not pending (%)', r.status; END IF;
  IF EXISTS (SELECT 1 FROM exp_verification_requests WHERE claim_id = p_claim) THEN
    RETURN jsonb_build_object('status', 'already_issued');
  END IF;

  SELECT record_type, record_id INTO v_type, v_rec FROM _exp_entity_record(r.entity_id);
  IF v_type = 'professional' THEN
    SELECT lower(nullif(btrim(email), '')), coalesce(display_name, concat_ws(' ', first_name, last_name))
      INTO v_dest, v_name FROM professionals WHERE id = v_rec;
  ELSIF v_type = 'organization' THEN
    SELECT lower(nullif(btrim(email), '')), name INTO v_dest, v_name FROM organizations WHERE id = v_rec;
  END IF;
  IF v_dest IS NULL THEN RETURN jsonb_build_object('status', 'no_channel'); END IF;

  SELECT value INTO v_key FROM exp_app_config WHERE key = 'sendgrid_api_key';
  IF coalesce(v_key, '') = '' THEN RETURN jsonb_build_object('status', 'not_configured'); END IF;

  SELECT id INTO v_event FROM exp_claim_events WHERE claim_id = p_claim ORDER BY occurred_at LIMIT 1;
  IF v_event IS NULL THEN v_event := _exp_claim_event(p_claim, 'attempted'); END IF;

  INSERT INTO exp_verification_requests (claim_event_id, entity_type, entity_id, channel, destination, status,
                                         requested_by, claim_id, code_hash, expires_at, attempts)
  VALUES (v_event, v_type, v_rec, 'email', v_dest, 'sent', p_actor, p_claim, p_code_hash,
          now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))), 0)
  RETURNING id INTO v_req;
  INSERT INTO exp_outbox (to_email, to_name, template, subject, body_html, payload, entity_type, entity_id,
                          scheduled_for, status, is_demo)
  VALUES (v_dest, v_name, 'claim_otp', p_subject, p_body_html,
          jsonb_build_object('claim_id', p_claim, 'request_id', v_req), 'claim_otp', p_claim, now(), 'queued', false);
  INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
  VALUES (p_actor, 'claimant', 'claim_challenge_sent', p_claim::text, jsonb_build_object('request', v_req, 'channel', 'email'));
  RETURN jsonb_build_object('status', 'sent', 'request_id', v_req, 'destination', v_dest);
END $$;

CREATE OR REPLACE FUNCTION public.exp_claim_gate_verify_otp(p_actor uuid, p_claim uuid, p_code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r exp_claim%ROWTYPE; v exp_verification_requests%ROWTYPE; v_tier smallint;
BEGIN
  IF NOT exp_claim_gate_is_service() THEN RAISE EXCEPTION 'claim gate: service role required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM exp_claim WHERE claim_id = p_claim FOR UPDATE;
  IF NOT FOUND OR r.user_id <> p_actor THEN RAISE EXCEPTION 'claim not found for this user'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'claim not pending (%)', r.status; END IF;
  SELECT * INTO v FROM exp_verification_requests WHERE claim_id = p_claim AND status = 'sent'
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'none'); END IF;
  IF v.expires_at <= now() THEN
    UPDATE exp_verification_requests SET status = 'expired' WHERE id = v.id;
    UPDATE claim_queue SET status = 'manual_review', updated_at = now() WHERE claim_id = p_claim AND status = 'pending';
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;
  IF v.attempts >= 5 THEN
    UPDATE exp_verification_requests SET status = 'failed' WHERE id = v.id;
    UPDATE claim_queue SET status = 'manual_review', updated_at = now() WHERE claim_id = p_claim AND status = 'pending';
    RETURN jsonb_build_object('outcome', 'locked');
  END IF;
  IF v.code_hash = p_code_hash THEN
    UPDATE exp_verification_requests SET status = 'verified', verified_at = now(), attempts = attempts + 1 WHERE id = v.id;
    v_tier := greatest(r.trust_tier, 1);
    UPDATE exp_claim SET trust_tier = v_tier,
                         tier_path = CASE WHEN r.trust_tier < 1 THEN 'otp_email' ELSE tier_path END,
                         evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('verified_channel', 'email'),
                         updated_at = now()
     WHERE claim_id = p_claim;
    UPDATE claim_queue SET trust_tier = v_tier, updated_at = now() WHERE claim_id = p_claim;
    INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
    VALUES (p_actor, 'claimant', 'claim_challenge_verified', p_claim::text, jsonb_build_object('tier', v_tier));
    RETURN jsonb_build_object('outcome', 'verified', 'trust_tier', v_tier);
  END IF;
  UPDATE exp_verification_requests
     SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE status END
   WHERE id = v.id;
  IF v.attempts + 1 >= 5 THEN
    UPDATE claim_queue SET status = 'manual_review', updated_at = now() WHERE claim_id = p_claim AND status = 'pending';
    RETURN jsonb_build_object('outcome', 'locked');
  END IF;
  RETURN jsonb_build_object('outcome', 'mismatch', 'attempts_left', 5 - (v.attempts + 1));
END $$;

-- ───────── 6. Gate: grant (bind account ↔ entity at the earned tier) ─────────
-- Writes BOTH sides atomically: exp_claim + exp_entity + owner grant (entity scope) +
-- professionals/organizations.claimed + claim_queue + exp_claim_events + audit.
CREATE OR REPLACE FUNCTION public._exp_claim_grant_core(p_claim uuid, p_acting_role text, p_reviewer uuid, p_queue_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r exp_claim%ROWTYPE; v_type text; v_rec uuid; v_conf smallint; n integer;
        v_office jsonb; v_loc uuid; v_loc_entity uuid;
BEGIN
  SELECT * INTO r FROM exp_claim WHERE claim_id = p_claim FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'claim not pending (%)', r.status; END IF;
  IF r.trust_tier < 1 THEN RAISE EXCEPTION 'claim gate: T1 required to grant (claim is T%)', r.trust_tier; END IF;
  PERFORM 1 FROM exp_entity WHERE entity_id = r.entity_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM exp_claim WHERE entity_id = r.entity_id AND status = 'verified' AND claim_id <> p_claim) THEN
    RAISE EXCEPTION 'entity already has a verified owner';
  END IF;
  SELECT record_type, record_id INTO v_type, v_rec FROM _exp_entity_record(r.entity_id);
  SELECT confidence_score INTO v_conf FROM claim_queue WHERE claim_id = p_claim LIMIT 1;

  UPDATE exp_claim SET status = 'verified', verified_at = now(), updated_at = now() WHERE claim_id = p_claim;
  UPDATE exp_entity SET claim_state = CASE WHEN r.trust_tier >= 2 THEN 'verified' ELSE 'claimed' END,
                        last_verified_at = now(), updated_at = now()
   WHERE entity_id = r.entity_id;
  INSERT INTO exp_control_grants (user_id, role, scope_type, scope_id)
  VALUES (r.user_id, 'owner', 'entity', r.entity_id::text)
  ON CONFLICT (user_id, role, scope_type, scope_id) DO NOTHING;

  IF v_type = 'professional' THEN
    UPDATE professionals
       SET claimed = true, claimed_at = now(), user_id = r.user_id,
           claim_method = coalesce(r.tier_path, p_acting_role), claim_confidence = v_conf
     WHERE id = v_rec AND (NOT coalesce(claimed, false) OR user_id = r.user_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN RAISE EXCEPTION 'published record is already claimed by another account'; END IF;
    INSERT INTO onboarding_progress (user_id, entity_type, entity_id, current_step, steps_completed, is_complete)
    VALUES (r.user_id, 'professional', v_rec, 1, ARRAY['claim'], false)
    ON CONFLICT DO NOTHING;
  ELSIF v_type = 'organization' THEN
    UPDATE organizations SET claimed = true, claimed_at = now() WHERE id = v_rec;
  END IF;

  -- Single-pro office (exp_office_mode, 0027): the grant covers BOTH records. The claim is on the
  -- professional; the location (listings / Place ID / NAP) is marked claimed and the owner also gets
  -- an entity-scoped 'owner' grant on the location's exp_entity, so T2 listing actions (change_nap,
  -- publish) on the location pass the same tier. The location's exp_entity carries the same claim_state.
  IF v_type = 'professional' THEN
    v_office := exp_office_mode('professional', v_rec);
    IF v_office->>'mode' = 'single_pro' THEN
      v_loc := (v_office->>'location_id')::uuid;
      UPDATE organizations SET claimed = true, claimed_at = now() WHERE id = v_loc;
      v_loc_entity := _exp_entity_for_record('organization', v_loc, true);
      PERFORM 1 FROM exp_entity WHERE entity_id = v_loc_entity FOR UPDATE;
      UPDATE exp_entity SET claim_state = CASE WHEN r.trust_tier >= 2 THEN 'verified' ELSE 'claimed' END,
                            last_verified_at = now(), updated_at = now()
       WHERE entity_id = v_loc_entity;
      INSERT INTO exp_control_grants (user_id, role, scope_type, scope_id)
      VALUES (r.user_id, 'owner', 'entity', v_loc_entity::text)
      ON CONFLICT (user_id, role, scope_type, scope_id) DO NOTHING;
    END IF;
  END IF;

  UPDATE claim_queue SET status = p_queue_status, trust_tier = r.trust_tier, reviewed_at = now(),
                         reviewed_by = p_reviewer, updated_at = now()
   WHERE claim_id = p_claim;
  -- Competing open claims on the same entity surface as conflicts (never silently granted).
  UPDATE claim_queue q SET status = 'conflict', updated_at = now()
    FROM exp_claim c
   WHERE q.claim_id = c.claim_id AND c.entity_id = r.entity_id AND c.claim_id <> p_claim
     AND c.status = 'pending' AND q.status IN ('pending', 'manual_review');

  PERFORM _exp_claim_event(p_claim, 'claimed');
  INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
  VALUES (coalesce(p_reviewer, r.user_id), p_acting_role, 'claim_granted', p_claim::text,
          jsonb_build_object('entity', r.entity_id, 'tier', r.trust_tier, 'path', r.tier_path,
                             'record_type', v_type, 'record_id', v_rec,
                             'location_id', v_loc, 'location_entity', v_loc_entity));
  RETURN jsonb_build_object('status', 'granted', 'claim_id', p_claim, 'entity_id', r.entity_id,
                            'trust_tier', r.trust_tier, 'record_type', v_type, 'record_id', v_rec,
                            'location_id', v_loc, 'location_entity_id', v_loc_entity);
END $$;

CREATE OR REPLACE FUNCTION public.exp_claim_gate_grant(p_actor uuid, p_claim uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT exp_claim_gate_is_service() THEN RAISE EXCEPTION 'claim gate: service role required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM exp_claim WHERE claim_id = p_claim AND user_id = p_actor) THEN
    RAISE EXCEPTION 'claim not found for this user';
  END IF;
  RETURN _exp_claim_grant_core(p_claim, 'claimant', NULL, 'auto_approved');
END $$;

-- ───────── 7. Gate: release / reset (one tap, reversible) ─────────
-- Owner (or a super admin) releases; a pending claim is simply cancelled. Owner-verified facts
-- in the graph are untouched (open decision in the skills registry §5.2 claim.release).
CREATE OR REPLACE FUNCTION public.exp_claim_gate_release(p_claim uuid, p_reason text DEFAULT NULL, p_actor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_service boolean := exp_claim_gate_is_service(); v_actor uuid; r exp_claim%ROWTYPE; v_type text; v_rec uuid;
        v_office jsonb; v_loc uuid; v_loc_entity uuid;
BEGIN
  v_actor := CASE WHEN v_service THEN p_actor ELSE auth.uid() END;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM exp_claim WHERE claim_id = p_claim FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim not found'; END IF;
  IF r.user_id <> v_actor AND NOT (NOT v_service AND exp_ctrl_has_role(ARRAY['super_admin'])) THEN
    RAISE EXCEPTION 'only the claim owner or a super admin can release this claim' USING ERRCODE = '42501';
  END IF;
  IF r.status NOT IN ('pending', 'verified') THEN
    RETURN jsonb_build_object('status', 'noop', 'claim_status', r.status);
  END IF;
  PERFORM 1 FROM exp_entity WHERE entity_id = r.entity_id FOR UPDATE;
  SELECT record_type, record_id INTO v_type, v_rec FROM _exp_entity_record(r.entity_id);

  UPDATE exp_claim SET status = 'revoked', released_at = now(), updated_at = now(),
                       evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('release_reason', p_reason, 'released_by', v_actor)
   WHERE claim_id = p_claim;
  DELETE FROM exp_control_grants
   WHERE user_id = r.user_id AND role = 'owner' AND scope_type = 'entity' AND scope_id = r.entity_id::text;
  IF r.status = 'verified' THEN
    IF v_type = 'professional' THEN
      UPDATE professionals SET claimed = false, claimed_at = NULL, user_id = NULL, claim_method = NULL, claim_confidence = NULL
       WHERE id = v_rec AND user_id = r.user_id;
    ELSIF v_type = 'organization' THEN
      UPDATE organizations SET claimed = false, claimed_at = NULL WHERE id = v_rec;
    END IF;
  END IF;
  -- Single-pro office: release the location side the grant bound (grant + claimed + claim_state).
  IF v_type = 'professional' THEN
    v_office := exp_office_mode('professional', v_rec);
    IF v_office->>'mode' = 'single_pro' THEN
      v_loc := (v_office->>'location_id')::uuid;
      v_loc_entity := _exp_entity_for_record('organization', v_loc, false);
      IF v_loc_entity IS NOT NULL THEN
        DELETE FROM exp_control_grants
         WHERE user_id = r.user_id AND role = 'owner' AND scope_type = 'entity' AND scope_id = v_loc_entity::text;
        UPDATE exp_entity SET claim_state = 'unclaimed', updated_at = now()
         WHERE entity_id = v_loc_entity AND r.status = 'verified'
           AND NOT EXISTS (SELECT 1 FROM exp_claim WHERE entity_id = v_loc_entity AND status IN ('pending', 'verified'));
      END IF;
      IF r.status = 'verified' THEN
        UPDATE organizations SET claimed = false, claimed_at = NULL WHERE id = v_loc;
      END IF;
    END IF;
  END IF;
  UPDATE exp_entity
     SET claim_state = CASE WHEN EXISTS (SELECT 1 FROM exp_claim WHERE entity_id = r.entity_id AND status = 'pending')
                            THEN 'claim_pending' ELSE 'unclaimed' END,
         updated_at = now()
   WHERE entity_id = r.entity_id
     AND NOT EXISTS (SELECT 1 FROM exp_claim WHERE entity_id = r.entity_id AND status = 'verified');
  UPDATE exp_verification_requests SET status = 'cancelled' WHERE claim_id = p_claim AND status IN ('pending', 'sent');
  UPDATE claim_queue SET status = 'released', review_notes = coalesce(p_reason, review_notes), updated_at = now()
   WHERE claim_id = p_claim;
  PERFORM _exp_claim_event(p_claim, 'released');
  INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
  VALUES (v_actor, CASE WHEN r.user_id = v_actor THEN 'claimant' ELSE 'super_admin' END, 'claim_released', p_claim::text,
          jsonb_build_object('entity', r.entity_id, 'was', r.status, 'reason', p_reason));
  RETURN jsonb_build_object('status', 'released', 'claim_id', p_claim, 'entity_id', r.entity_id, 'was', r.status);
END $$;

-- ───────── 8. Staff adjudication (existing function, now writes both sides) ─────────
CREATE OR REPLACE FUNCTION public._exp_claim_adjudicate_core(p_claim uuid, p_approve boolean, p_note text, p_reviewer uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entity uuid; v_res jsonb;
BEGIN
  SELECT entity_id INTO v_entity FROM exp_claim WHERE claim_id = p_claim AND status = 'pending' FOR UPDATE;
  IF v_entity IS NULL THEN RAISE EXCEPTION 'claim not found or not pending'; END IF;
  IF p_approve THEN
    -- Human review of ownership evidence is an ownership proof → T2.
    UPDATE exp_claim SET trust_tier = 2, tier_path = 'staff_review', updated_at = now() WHERE claim_id = p_claim;
    v_res := _exp_claim_grant_core(p_claim, 'architect', p_reviewer, 'approved');
    UPDATE claim_queue SET review_notes = p_note WHERE claim_id = p_claim;
  ELSE
    UPDATE exp_claim SET status = 'rejected', updated_at = now() WHERE claim_id = p_claim;
    UPDATE exp_entity SET claim_state = 'unclaimed', updated_at = now() WHERE entity_id = v_entity
      AND NOT EXISTS (SELECT 1 FROM exp_claim c2 WHERE c2.entity_id = v_entity AND c2.status IN ('pending', 'verified'));
    UPDATE exp_verification_requests SET status = 'cancelled' WHERE claim_id = p_claim AND status IN ('pending', 'sent');
    UPDATE claim_queue SET status = 'rejected', review_notes = p_note, reviewed_at = now(), reviewed_by = p_reviewer, updated_at = now()
     WHERE claim_id = p_claim;
    v_res := jsonb_build_object('status', 'rejected', 'claim_id', p_claim, 'entity_id', v_entity);
  END IF;
  INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
  VALUES (p_reviewer, 'architect', CASE WHEN p_approve THEN 'claim_approved' ELSE 'claim_rejected' END, p_claim::text,
          jsonb_build_object('entity', v_entity, 'note', p_note));
  RETURN v_res;
END $$;

CREATE OR REPLACE FUNCTION public.exp_claim_adjudicate(p_claim uuid, p_approve boolean, p_note text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN RAISE EXCEPTION 'insufficient grant'; END IF;
  PERFORM _exp_claim_adjudicate_core(p_claim, p_approve, p_note, auth.uid());
END $$;

-- Queue-row entry point for /claims (claim_queue ids). Legacy rows without an exp_claim get one.
CREATE OR REPLACE FUNCTION public.exp_claim_queue_adjudicate(p_queue uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q claim_queue%ROWTYPE; v_entity uuid; v_claim uuid;
BEGIN
  IF NOT exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN RAISE EXCEPTION 'insufficient grant' USING ERRCODE = '42501'; END IF;
  SELECT * INTO q FROM claim_queue WHERE id = p_queue FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'queue row not found'; END IF;
  IF q.status NOT IN ('pending', 'manual_review', 'conflict') THEN RAISE EXCEPTION 'queue row is %', q.status; END IF;
  v_claim := q.claim_id;
  IF v_claim IS NULL THEN
    IF NOT p_approve THEN
      UPDATE claim_queue SET status = 'rejected', review_notes = p_note, reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
       WHERE id = p_queue;
      INSERT INTO exp_admin_audit (user_id, acting_role, action, target, details)
      VALUES (auth.uid(), 'architect', 'claim_rejected', p_queue::text, jsonb_build_object('queue', p_queue, 'note', p_note));
      RETURN jsonb_build_object('status', 'rejected', 'queue_id', p_queue);
    END IF;
    IF q.claimant_user_id IS NULL THEN RAISE EXCEPTION 'queue row has no claimant'; END IF;
    v_entity := _exp_entity_for_record(q.entity_type, q.entity_id, true);
    SELECT claim_id INTO v_claim FROM exp_claim
     WHERE entity_id = v_entity AND user_id = q.claimant_user_id AND status = 'pending' LIMIT 1;
    IF v_claim IS NULL THEN
      INSERT INTO exp_claim (entity_id, user_id, evidence, trust_tier)
      VALUES (v_entity, q.claimant_user_id,
              jsonb_build_object('signals', q.confidence_signals, 'confidence', q.confidence_score,
                                 'record_type', q.entity_type, 'record_id', q.entity_id, 'queue_id', p_queue), 0)
      RETURNING claim_id INTO v_claim;
    END IF;
    UPDATE claim_queue SET claim_id = v_claim WHERE id = p_queue;
  END IF;
  RETURN _exp_claim_adjudicate_core(v_claim, p_approve, p_note, auth.uid());
END $$;

-- ───────── 9. Tier lookup for harmful-action checks ─────────
-- Returns the caller's tier on an entity (NULL = no binding). Others' tiers: staff / service only.
CREATE OR REPLACE FUNCTION public.exp_claim_tier(p_entity uuid, p_user uuid DEFAULT NULL)
RETURNS smallint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid := coalesce(p_user, auth.uid()); v_tier smallint;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  IF v_user IS DISTINCT FROM auth.uid() AND NOT (exp_claim_gate_is_service() OR exp_ctrl_has_role(ARRAY['super_admin','architect'])) THEN
    RAISE EXCEPTION 'insufficient grant' USING ERRCODE = '42501';
  END IF;
  SELECT trust_tier INTO v_tier FROM exp_claim WHERE entity_id = p_entity AND user_id = v_user AND status = 'verified' LIMIT 1;
  -- Single-pro office: the location's entity carries no claim of its own; its tier is the tier of the
  -- verified claim on the office's professional (exp_office_mode, 0027).
  IF v_tier IS NULL THEN
    SELECT c.trust_tier INTO v_tier
      FROM _exp_entity_record(p_entity) er
      CROSS JOIN LATERAL exp_office_mode(er.record_type, er.record_id) om
      -- read-only lookup (exp_claim_tier is STABLE; _exp_entity_for_record may write links)
      JOIN exp_entity pe ON pe.identity_keys @> jsonb_build_object('professional_id', om->>'professional_id')
                        AND pe.status <> 'merged'
      JOIN exp_claim c ON c.entity_id = pe.entity_id
     WHERE er.record_type = 'organization' AND om->>'mode' = 'single_pro'
       AND c.user_id = v_user AND c.status = 'verified'
     LIMIT 1;
  END IF;
  RETURN v_tier;
END $$;

-- ───────── 10. Privileges ─────────
REVOKE ALL ON FUNCTION public.exp_claim_gate_is_service() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_claim_gate_is_service() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._exp_entity_link_record(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._exp_entity_for_record(text, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._exp_entity_record(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._exp_claim_event(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._exp_claim_grant_core(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._exp_claim_adjudicate_core(uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.exp_claim_gate_start(uuid, text, uuid, smallint, text, smallint, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exp_claim_gate_advance(uuid, uuid, smallint, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exp_claim_gate_challenge(uuid, uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exp_claim_gate_verify_otp(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exp_claim_gate_grant(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exp_claim_gate_start(uuid, text, uuid, smallint, text, smallint, jsonb, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_gate_advance(uuid, uuid, smallint, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_gate_challenge(uuid, uuid, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_gate_verify_otp(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_gate_grant(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.exp_entity_for_record(text, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_entity_link_record(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_claim_gate_release(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_claim_adjudicate(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_claim_queue_adjudicate(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_claim_tier(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_entity_for_record(text, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_entity_link_record(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_gate_release(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_adjudicate(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_queue_adjudicate(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_claim_tier(uuid, uuid) TO authenticated, service_role;

-- ───────── 11. Registry: capabilities + the claim skills that now have an implementation ─────────
INSERT INTO public.exp_capability_registry
  (key, title, owning_surface, description, reads_state, side_effects, dry_run, events_emitted, transport, status, version)
VALUES
  ('claim_precheck', 'Claim silent precheck', 'Claim',
   'Scores ownership from signals already held: OAuth email vs on-file email / website domain, name, the category brief''s credential key vs the published licence, GBP Place ID match, existing claims. Read-only.',
   ARRAY['professionals','organizations','exp_entity','exp_claim','category_brief'], ARRAY[]::text[], true,
   ARRAY['precheck.scored'], 'direct', 'published', '1.0.0'),
  ('claim_gate_write', 'Claim gate: start / advance', 'Claim',
   'exp_claim_gate_start / exp_claim_gate_advance: opens or raises a claim at the earned trust tier (exp_claim + claim_queue + exp_claim_events).',
   ARRAY['exp_claim','claim_queue'], ARRAY['claim_write'], false, ARRAY['claim.started'], 'direct', 'published', '1.0.0'),
  ('otp_verify', 'Verify a claim OTP', 'Claim',
   'exp_claim_gate_verify_otp: checks the HMAC of the code, expiry and attempts; success raises the claim to T1.',
   ARRAY['exp_verification_requests'], ARRAY['claim_write'], false, ARRAY['claim.challenge_verified'], 'direct', 'published', '1.0.0'),
  ('claim_bind', 'Bind account to entity', 'Claim',
   'exp_claim_gate_grant: binds at T1+ — exp_claim verified, exp_entity claim_state, owner grant (entity scope), professionals/organizations.claimed.',
   ARRAY['exp_claim'], ARRAY['claim_write','grant_write'], false, ARRAY['claim.granted'], 'direct', 'published', '1.0.0'),
  ('claim_unbind', 'Release a claim', 'Claim',
   'exp_claim_gate_release: one-tap reversible unclaim / reset; removes the owner grant and unclaims the published record.',
   ARRAY['exp_claim'], ARRAY['claim_write','grant_write'], false, ARRAY['claim.released'], 'direct', 'published', '1.0.0')
ON CONFLICT (key) DO UPDATE SET
  title = EXCLUDED.title, owning_surface = EXCLUDED.owning_surface, description = EXCLUDED.description,
  reads_state = EXCLUDED.reads_state, side_effects = EXCLUDED.side_effects, dry_run = EXCLUDED.dry_run,
  events_emitted = EXCLUDED.events_emitted, status = EXCLUDED.status, version = EXCLUDED.version, updated_at = now();

-- Skills: point tools_used at the implemented capabilities and publish (live runs require it).
-- otp_send / gbp_list_locations are existing registry keys, now implemented in code.
UPDATE public.exp_skill_registry SET tools_used = ARRAY['claim_gate_write'], status = 'published', version = '1.0.0', updated_at = now()
 WHERE key = 'claim_initiate';
UPDATE public.exp_skill_registry SET tools_used = ARRAY['gbp_list_locations','claim_precheck'], status = 'published', version = '1.0.0', updated_at = now()
 WHERE key = 'claim_silent_precheck';
UPDATE public.exp_skill_registry SET tools_used = ARRAY['otp_send'], status = 'published', version = '1.0.0', updated_at = now()
 WHERE key = 'claim_challenge';
UPDATE public.exp_skill_registry SET tools_used = ARRAY['otp_verify'], status = 'published', version = '1.0.0', updated_at = now()
 WHERE key = 'claim_verify_email';
UPDATE public.exp_skill_registry SET tools_used = ARRAY['claim_bind'], status = 'published', version = '1.0.0', updated_at = now()
 WHERE key = 'claim_grant';
UPDATE public.exp_skill_registry SET tools_used = ARRAY['claim_unbind'], status = 'published', version = '1.0.0', updated_at = now()
 WHERE key = 'claim_release';
