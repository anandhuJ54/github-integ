ALTER TABLE public.exp_sales_demos
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES public.exp_sales_pipeline(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS objective text,
  ADD COLUMN IF NOT EXISTS agenda text,
  ADD COLUMN IF NOT EXISTS attendees jsonb,
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS follow_up text,
  ADD COLUMN IF NOT EXISTS disposition text;

ALTER TABLE public.exp_opportunity_contacts
  ADD COLUMN IF NOT EXISTS relationship_strength smallint,
  ADD COLUMN IF NOT EXISTS last_touch_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_origin text CHECK (source_origin IN ('claim','manual')),
  ADD COLUMN IF NOT EXISTS champion_detail jsonb;

ALTER TABLE public.exp_contacts
  ADD COLUMN IF NOT EXISTS source_origin text,
  ADD COLUMN IF NOT EXISTS professional_id text;

ALTER TABLE public.exp_sales_notes
  ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS mentions text[];

ALTER TABLE public.exp_sales_pipeline
  ADD COLUMN IF NOT EXISTS created_by text;

ALTER TABLE public.exp_territory_brand
  ADD COLUMN IF NOT EXISTS success_handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS success_handoff_opportunity_id uuid REFERENCES public.exp_sales_pipeline(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.exp_quotes'::regclass AND contype='f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.exp_quotes'::regclass AND attname='opportunity_id')]) THEN
    ALTER TABLE public.exp_quotes ADD CONSTRAINT exp_quotes_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.exp_sales_pipeline(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.exp_opportunity_owner_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.exp_sales_pipeline(id) ON DELETE CASCADE,
  from_owner text, to_owner text, changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_opportunity_owner_history TO authenticated;
GRANT ALL ON public.exp_opportunity_owner_history TO service_role;
ALTER TABLE public.exp_opportunity_owner_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read exp_opportunity_owner_history" ON public.exp_opportunity_owner_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert exp_opportunity_owner_history" ON public.exp_opportunity_owner_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update exp_opportunity_owner_history" ON public.exp_opportunity_owner_history FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Staff delete exp_opportunity_owner_history" ON public.exp_opportunity_owner_history FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.exp_sales_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.exp_sales_pipeline(id) ON DELETE SET NULL,
  account_id uuid, logo text, alert_type text, body text, severity text,
  is_nora_suggested boolean NOT NULL DEFAULT false,
  owner_id uuid, acknowledged boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_sales_alerts TO authenticated;
GRANT ALL ON public.exp_sales_alerts TO service_role;
ALTER TABLE public.exp_sales_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read exp_sales_alerts" ON public.exp_sales_alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert exp_sales_alerts" ON public.exp_sales_alerts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update exp_sales_alerts" ON public.exp_sales_alerts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Staff delete exp_sales_alerts" ON public.exp_sales_alerts FOR DELETE TO authenticated USING (true);

-- Owner change history
CREATE OR REPLACE FUNCTION public.exp_opp_owner_history_trg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner IS DISTINCT FROM OLD.owner THEN
    INSERT INTO exp_opportunity_owner_history(opportunity_id, from_owner, to_owner, changed_by)
    VALUES (NEW.id, OLD.owner, NEW.owner, auth.uid()::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS exp_opp_owner_history ON public.exp_sales_pipeline;
CREATE TRIGGER exp_opp_owner_history AFTER UPDATE OF owner ON public.exp_sales_pipeline
  FOR EACH ROW EXECUTE FUNCTION public.exp_opp_owner_history_trg();

-- Create (or reopen) the one open opportunity for a logo
CREATE OR REPLACE FUNCTION public.exp_opp_create(p_org_id uuid, p_account_id uuid, p_owner text, p_source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_acct uuid := p_account_id; v_claim record; v_contact uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'Logo is required'; END IF;
  IF p_source NOT IN ('sre','nora','seller','campaign') THEN RAISE EXCEPTION 'Unknown source %', p_source; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('exp_opp_create:' || p_org_id::text));
  SELECT id INTO v_id FROM exp_sales_pipeline
   WHERE org_id = p_org_id::text AND coalesce(stage,'') NOT IN ('won','lost')
   ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('id', v_id, 'created', false); END IF;

  SELECT name INTO v_name FROM organizations WHERE id = p_org_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Logo % not found', p_org_id; END IF;
  IF v_acct IS NULL THEN SELECT id INTO v_acct FROM exp_accounts WHERE org_id = p_org_id ORDER BY created_at LIMIT 1; END IF;

  INSERT INTO exp_sales_pipeline(name, org_id, account_id, owner, stage, source_owner, source_channel, created_by, created_at, is_demo)
  VALUES (v_name, p_org_id::text, v_acct, p_owner, 'qualification', p_owner, p_source, auth.uid()::text, now(), false)
  RETURNING id INTO v_id;

  -- Whitespace: catalog products the logo does not already own on an active/won contract
  INSERT INTO exp_opportunity_products(opportunity_id, product, qty, unit_price, amount, is_demo)
  SELECT v_id, pb.product_key, 1, pb.list_price, pb.list_price, false
  FROM (SELECT DISTINCT ON (product_key) product_key, list_price FROM exp_price_book
        WHERE product_key IS NOT NULL AND coalesce(billing_type,'') <> 'free_with_nora'
        ORDER BY product_key, list_price DESC NULLS LAST) pb
  WHERE pb.product_key NOT IN (
    SELECT li.product_key FROM exp_contract_line_items li JOIN exp_contracts c ON c.id = li.contract_id
    WHERE c.org_id = p_org_id::text AND c.status IN ('active','won') AND li.product_key IS NOT NULL);

  -- Primary contact from the logo's claimed profile
  SELECT entity_id, entity_label, contact_email, contact_phone INTO v_claim FROM exp_claim_events
   WHERE logo_org_id = p_org_id AND event_type IN ('claimed','engaged','upgraded')
     AND (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
   ORDER BY occurred_at DESC NULLS LAST LIMIT 1;
  IF FOUND THEN
    INSERT INTO exp_contacts(account_id, first_name, email, phone, source_origin, professional_id, is_demo)
    VALUES (v_acct, v_claim.entity_label, v_claim.contact_email, v_claim.contact_phone, 'claim', v_claim.entity_id, false)
    RETURNING id INTO v_contact;
    INSERT INTO exp_opportunity_contacts(opportunity_id, contact_id, role, is_primary, source_origin, is_demo)
    VALUES (v_id, v_contact, 'primary', true, 'claim', false);
  END IF;
  RETURN jsonb_build_object('id', v_id, 'created', true);
END $$;

-- Advance with gate validation
CREATE OR REPLACE FUNCTION public.exp_opp_advance_stage(p_opp uuid, p_target text, p_captured jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_missing text[]; v_hist uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF p_target IN ('won','lost') THEN RAISE EXCEPTION 'Use close_won / close_lost for %', p_target; END IF;
  IF NOT EXISTS (SELECT 1 FROM exp_pipeline_stages WHERE key = p_target) THEN RAISE EXCEPTION 'Unknown stage %', p_target; END IF;
  SELECT stage INTO v_from FROM exp_sales_pipeline WHERE id = p_opp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found'; END IF;
  IF v_from IN ('won','lost') THEN RAISE EXCEPTION 'Opportunity is closed (%)', v_from; END IF;
  SELECT array_agg(field_label ORDER BY sort) INTO v_missing FROM exp_stage_requirements
   WHERE stage_key = p_target AND required
     AND nullif(btrim(coalesce(p_captured ->> field_label, '')), '') IS NULL;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'Missing required evidence for %: %', p_target, array_to_string(v_missing, '; '); END IF;
  INSERT INTO exp_opportunity_stage_history(opportunity_id, from_stage, to_stage, captured, moved_by, moved_at, is_demo)
  VALUES (p_opp, v_from, p_target, p_captured, auth.uid(), now(), false) RETURNING id INTO v_hist;
  UPDATE exp_sales_pipeline SET stage = p_target, updated_at = now() WHERE id = p_opp;
  RETURN v_hist;
END $$;

-- Close lost: logo stays in territory
CREATE OR REPLACE FUNCTION public.exp_opp_close_lost(p_opp uuid, p_reason text, p_competitor text DEFAULT NULL, p_revisit date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_hist uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  IF nullif(btrim(coalesce(p_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Lost reason is required'; END IF;
  SELECT stage INTO v_from FROM exp_sales_pipeline WHERE id = p_opp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found'; END IF;
  IF v_from IN ('won','lost') THEN RAISE EXCEPTION 'Opportunity is closed (%)', v_from; END IF;
  INSERT INTO exp_opportunity_stage_history(opportunity_id, from_stage, to_stage, captured, moved_by, moved_at, is_demo)
  VALUES (p_opp, v_from, 'lost', jsonb_build_object('Lost reason', p_reason, 'Competitor (if lost to one)', p_competitor, 'Revisit date', p_revisit), auth.uid(), now(), false)
  RETURNING id INTO v_hist;
  UPDATE exp_sales_pipeline SET stage = 'lost', lost_reason = p_reason, win_back = (p_revisit IS NOT NULL), updated_at = now() WHERE id = p_opp;
  RETURN v_hist;
END $$;

-- Close won: the only event that hands the logo off from the new-sales territory (reversible flag)
CREATE OR REPLACE FUNCTION public.exp_opp_close_won(p_opp uuid, p_captured jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_org text; v_hist uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  SELECT stage, org_id INTO v_from, v_org FROM exp_sales_pipeline WHERE id = p_opp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Opportunity not found'; END IF;
  IF v_from IN ('won','lost') THEN RAISE EXCEPTION 'Opportunity is closed (%)', v_from; END IF;
  INSERT INTO exp_opportunity_stage_history(opportunity_id, from_stage, to_stage, captured, moved_by, moved_at, is_demo)
  VALUES (p_opp, v_from, 'won', p_captured, auth.uid(), now(), false) RETURNING id INTO v_hist;
  UPDATE exp_sales_pipeline SET stage = 'won', updated_at = now() WHERE id = p_opp;
  IF v_org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    UPDATE exp_territory_brand SET success_handoff_at = now(), success_handoff_opportunity_id = p_opp
     WHERE org_id = v_org::uuid AND success_handoff_at IS NULL;
  END IF;
  RETURN v_hist;
END $$;

REVOKE ALL ON FUNCTION public.exp_opp_create(uuid,uuid,text,text), public.exp_opp_advance_stage(uuid,text,jsonb), public.exp_opp_close_lost(uuid,text,text,date), public.exp_opp_close_won(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_opp_create(uuid,uuid,text,text), public.exp_opp_advance_stage(uuid,text,jsonb), public.exp_opp_close_lost(uuid,text,text,date), public.exp_opp_close_won(uuid,jsonb) TO authenticated;