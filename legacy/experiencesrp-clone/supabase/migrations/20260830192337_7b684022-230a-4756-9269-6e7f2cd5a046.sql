-- ============ 1. Access: grants + RLS + policies ============
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'exp_sales_reps','exp_sales_assignments','exp_account_tier','exp_activity_events',
    'exp_price_book','exp_contracts','exp_contract_line_items',
    'exp_contract_signatures','exp_contract_renewals'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff read %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Staff read %s" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff insert %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Staff insert %s" ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff update %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Staff update %s" ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Staff delete %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Staff delete %s" ON public.%I FOR DELETE TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

-- ============ 2. New catalog items referenced by the price book ============
INSERT INTO public.exp_products (product_key, name, description, entity_scope, billing_type, price_monthly, price_monthly_location, price_unit, is_addon, sort, active)
VALUES
  ('boarding','Boarding & Onboarding','One-time boarding, data load and profile activation per seat/location.','both','one_time',49,149,'seat',true,5,true),
  ('tokens','Token Pack','Prepaid AI token package consumed by Nora, VOCE and agents.','both','token',NULL,NULL,'token',true,85,true),
  ('enterprise_first_publishing','Enterprise-First Publishing','Brand-governed publishing to all child locations and professionals.','location','subscription',NULL,299,'month',true,65,true),
  ('voce_connections','VOCE Connections','Voice-of-customer connection per source system.','both','subscription',19,39,'month',true,82,true),
  ('map_rank_tracker','Map Rank Tracker','Grid-based local map rank tracking per location.','location','subscription',NULL,49,'month',true,72,true),
  ('llm_monitor','LLM Monitor','Answer-engine visibility monitoring across LLM surfaces.','both','subscription',39,79,'month',true,74,true)
ON CONFLICT (product_key) DO NOTHING;

-- ============ 3. Price book seeded from the catalog ============
CREATE UNIQUE INDEX IF NOT EXISTS exp_price_book_key_scope_uq ON public.exp_price_book (product_key, scope);

INSERT INTO public.exp_price_book (product_key, scope, unit, list_price, contract_price, billing_type, notes)
SELECT p.product_key, 'professional', COALESCE(p.price_unit,'month'),
       p.price_monthly,
       CASE WHEN p.price_monthly IS NULL THEN NULL ELSE ROUND(p.price_monthly * 0.8, 2) END,
       p.billing_type, 'Seeded from catalog'
FROM public.exp_products p WHERE p.active AND p.entity_scope IN ('both','professional')
ON CONFLICT (product_key, scope) DO NOTHING;

INSERT INTO public.exp_price_book (product_key, scope, unit, list_price, contract_price, billing_type, notes)
SELECT p.product_key, 'location', COALESCE(p.price_unit,'month'),
       p.price_monthly_location,
       CASE WHEN p.price_monthly_location IS NULL THEN NULL ELSE ROUND(p.price_monthly_location * 0.8, 2) END,
       p.billing_type, 'Seeded from catalog'
FROM public.exp_products p WHERE p.active AND p.entity_scope IN ('both','location')
ON CONFLICT (product_key, scope) DO NOTHING;

UPDATE public.exp_price_book SET list_price = 0.02, contract_price = 0.015, unit = 'token'
WHERE product_key IN ('voce','tokens') AND list_price IS NULL;

UPDATE public.exp_price_book SET list_price = 2500, contract_price = 1900, unit = 'month'
WHERE product_key = 'campaigns' AND list_price IS NULL;

-- ============ 4. Contract -> entitlements provisioning ============
CREATE OR REPLACE FUNCTION public.exp_contract_provision(p_contract uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.exp_contracts;
  subject text;
  n integer := 0;
BEGIN
  SELECT * INTO c FROM public.exp_contracts WHERE id = p_contract;
  IF c.id IS NULL THEN RETURN 0; END IF;
  subject := COALESCE(c.account_id, c.org_id);
  IF subject IS NULL THEN RETURN 0; END IF;

  INSERT INTO public.exp_entitlements (subject_type, subject_id, product_key, state, source, tokens_included, config, granted_by)
  SELECT 'organization', subject, li.product_key,
         CASE WHEN c.status = 'active' THEN 'active' ELSE 'entitled_unconfigured' END,
         'contract',
         CASE WHEN li.product_key IN ('voce','tokens') THEN COALESCE(c.token_package, li.qty::int, 0) ELSE 0 END,
         jsonb_build_object('contract_id', c.id, 'qty', li.qty, 'unit_price', li.unit_price, 'term', li.term),
         COALESCE(c.created_by, 'contract-provisioning')
  FROM public.exp_contract_line_items li
  WHERE li.contract_id = c.id AND li.product_key IS NOT NULL
  ON CONFLICT (subject_type, subject_id, product_key) DO UPDATE
    SET state = EXCLUDED.state,
        source = 'contract',
        tokens_included = GREATEST(public.exp_entitlements.tokens_included, EXCLUDED.tokens_included),
        config = EXCLUDED.config;

  SELECT count(*) INTO n FROM public.exp_contract_line_items WHERE contract_id = c.id AND product_key IS NOT NULL;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.exp_contract_provision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_contract_provision(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exp_contract_provision_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.exp_contract_provision(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS exp_contracts_provision ON public.exp_contracts;
CREATE TRIGGER exp_contracts_provision
AFTER INSERT OR UPDATE OF status ON public.exp_contracts
FOR EACH ROW EXECUTE FUNCTION public.exp_contract_provision_trg();

-- ============ 5. Insurance sales group ============
INSERT INTO public.exp_sales_reps (id, name, email, role, group_key) VALUES
  ('c1000000-0000-4000-8000-000000000001','Renee Alvarez','renee.alvarez@experience.com','srx','insurance'),
  ('c1000000-0000-4000-8000-000000000002','Marcus Webb','marcus.webb@experience.com','srx','insurance'),
  ('c1000000-0000-4000-8000-000000000003','Dana Kim','dana.kim@experience.com','smb','insurance'),
  ('c1000000-0000-4000-8000-000000000004','Luis Ortega','luis.ortega@experience.com','smb','insurance'),
  ('c1000000-0000-4000-8000-000000000005','Priya Raman','priya.raman@experience.com','mid_market','insurance'),
  ('c1000000-0000-4000-8000-000000000006','Tom Bellamy','tom.bellamy@experience.com','enterprise','insurance')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exp_sales_assignments (rep_id, group_key, assignment_type, target_ref) VALUES
  ('c1000000-0000-4000-8000-000000000001','insurance','individual_share','1/3'),
  ('c1000000-0000-4000-8000-000000000001','insurance','logo','State Farm'),
  ('c1000000-0000-4000-8000-000000000002','insurance','individual_share','1/3'),
  ('c1000000-0000-4000-8000-000000000002','insurance','logo','Demo Mortgage Co'),
  ('c1000000-0000-4000-8000-000000000003','insurance','account','aaaaaaa1-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000004','insurance','individual_share','1/3'),
  ('c1000000-0000-4000-8000-000000000005','insurance','account','11111111-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000005','insurance','logo','New American Funding'),
  ('c1000000-0000-4000-8000-000000000006','insurance','account','bbbbbbb1-0000-4000-8000-000000000001'),
  ('c1000000-0000-4000-8000-000000000006','insurance','logo','State Farm')
ON CONFLICT DO NOTHING;

-- ============ 6. Account tiers from derivable agent counts ============
INSERT INTO public.exp_account_tier (account_id, agent_count, tier, group_key)
SELECT root.id::text,
       cnt.agents,
       CASE WHEN cnt.agents >= 1000 THEN 'ent'
            WHEN cnt.agents >= 101 THEN 'mm'
            WHEN cnt.agents >= 5 THEN 'smb'
            ELSE 'individual' END,
       'insurance'
FROM public.organizations root
CROSS JOIN LATERAL (
  SELECT count(*)::int AS agents
  FROM public.professionals p
  WHERE p.primary_org_id IN (
    WITH RECURSIVE t AS (
      SELECT id FROM public.organizations WHERE id = root.id
      UNION ALL
      SELECT o.id FROM public.organizations o JOIN t ON o.parent_org_id = t.id
    ) SELECT id FROM t
  )
) cnt
WHERE root.parent_org_id IS NULL
ON CONFLICT (account_id) DO UPDATE SET agent_count = EXCLUDED.agent_count, tier = EXCLUDED.tier, updated_at = now();

-- State Farm's true audience comes from the ETL entity universe, not the sampled rows.
UPDATE public.exp_account_tier
SET agent_count = GREATEST(agent_count, (SELECT count(*)::int FROM public.exp_entity WHERE display_name ILIKE '%state farm%')),
    tier = 'ent'
WHERE account_id = 'bbbbbbb1-0000-4000-8000-000000000001';

-- ============ 7. Activity events over the last 30 days ============
WITH sf AS (
  SELECT p.id, p.display_name, o.name AS office, 'State Farm'::text AS logo,
         COALESCE(o.address_city || ', ' || o.address_state, 'Unknown') AS loc,
         row_number() OVER (ORDER BY p.id) AS rn
  FROM public.professionals p
  JOIN public.organizations o ON o.id = p.primary_org_id
  WHERE o.name ILIKE 'State Farm%' OR o.parent_org_id IN (
    SELECT id FROM public.organizations WHERE parent_org_id = 'bbbbbbb1-0000-4000-8000-000000000001'
  )
  LIMIT 180
), dm AS (
  SELECT p.id, p.display_name, o.name AS office, 'Demo Mortgage Co'::text AS logo,
         COALESCE(o.address_city || ', ' || o.address_state, 'Unknown') AS loc,
         180 + row_number() OVER (ORDER BY p.id) AS rn
  FROM public.professionals p
  JOIN public.organizations o ON o.id = p.primary_org_id
  WHERE o.id IN (
    WITH RECURSIVE t AS (
      SELECT id FROM public.organizations WHERE id = 'aaaaaaa1-0000-4000-8000-000000000001'
      UNION ALL SELECT o2.id FROM public.organizations o2 JOIN t ON o2.parent_org_id = t.id
    ) SELECT id FROM t
  )
), pool AS (SELECT * FROM sf UNION ALL SELECT * FROM dm)
INSERT INTO public.exp_activity_events (event_type, subject_type, subject_id, account_id, logo, location, actor, value, occurred_at)
SELECT
  CASE (pool.rn % 10)
    WHEN 0 THEN 'claim_failed'
    WHEN 1 THEN 'claim_created'
    WHEN 2 THEN 'nora_engagement'
    WHEN 3 THEN 'nora_engagement'
    WHEN 4 THEN 'claim_created'
    WHEN 5 THEN 'upgrade'
    WHEN 6 THEN 'nora_engagement'
    WHEN 7 THEN 'claim_failed'
    WHEN 8 THEN 'nora_engagement'
    ELSE 'downgrade' END,
  'professional', pool.id::text,
  CASE WHEN pool.logo = 'State Farm' THEN 'bbbbbbb1-0000-4000-8000-000000000001' ELSE 'aaaaaaa1-0000-4000-8000-000000000001' END,
  pool.logo, pool.loc, pool.office,
  jsonb_build_object(
    'display_name', pool.display_name,
    'sessions', (pool.rn % 7) + 1,
    'plan', CASE WHEN pool.rn % 10 = 5 THEN 'nora_pro' WHEN pool.rn % 10 = 9 THEN 'free' ELSE 'free' END,
    'reason', CASE WHEN pool.rn % 10 IN (0,7) THEN 'identity_mismatch' ELSE NULL END
  ),
  now() - ((pool.rn % 30) || ' days')::interval - ((pool.rn % 11) || ' hours')::interval
FROM pool;

-- a second engagement wave so "engaged in 30d, not upgraded" has depth
INSERT INTO public.exp_activity_events (event_type, subject_type, subject_id, account_id, logo, location, actor, value, occurred_at)
SELECT 'nora_engagement', e.subject_type, e.subject_id, e.account_id, e.logo, e.location, e.actor,
       jsonb_build_object('sessions', 2, 'surface', 'nora_chat'),
       e.occurred_at + interval '3 days'
FROM public.exp_activity_events e
WHERE e.event_type = 'nora_engagement' AND e.occurred_at < now() - interval '4 days';

-- ============ 8. Sample enterprise contract with CPQ artifacts ============
INSERT INTO public.exp_contracts (id, org_id, account_id, name, status, start_date, end_date, terms, token_package, mrr, created_by)
VALUES ('dddddddd-0000-4000-8000-000000000001','bbbbbbb1-0000-4000-8000-000000000001','bbbbbbb1-0000-4000-8000-000000000001',
        'State Farm — 2026 Enterprise Agreement','draft', current_date - 10, current_date + 80,
        jsonb_build_object('payment_terms','net_30','auto_renew',true), 250000, 0, 'tom.bellamy@experience.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exp_contract_line_items (contract_id, product_key, qty, unit_price, term, notes) VALUES
  ('dddddddd-0000-4000-8000-000000000001','nora',1200,55,'monthly','Enterprise seat pricing'),
  ('dddddddd-0000-4000-8000-000000000001','listings',900,79,'monthly','Location listings'),
  ('dddddddd-0000-4000-8000-000000000001','enterprise_first_publishing',900,239,'monthly','Brand-governed publishing'),
  ('dddddddd-0000-4000-8000-000000000001','map_rank_tracker',900,39,'monthly','Grid tracking'),
  ('dddddddd-0000-4000-8000-000000000001','tokens',250000,0.015,'annual','Prepaid token package'),
  ('dddddddd-0000-4000-8000-000000000001','boarding',1200,39,'one_time','Boarding per seat')
ON CONFLICT DO NOTHING;

UPDATE public.exp_contracts c
SET mrr = (SELECT COALESCE(SUM(li.qty * li.unit_price),0) FROM public.exp_contract_line_items li
           WHERE li.contract_id = c.id AND COALESCE(li.term,'monthly') = 'monthly')
WHERE c.id = 'dddddddd-0000-4000-8000-000000000001';

INSERT INTO public.exp_contract_signatures (contract_id, signer_name, signer_email, status)
VALUES ('dddddddd-0000-4000-8000-000000000001','Alicia Grant','alicia.grant@statefarm.com','sent')
ON CONFLICT DO NOTHING;

INSERT INTO public.exp_contract_renewals (contract_id, renewal_date, reminder_state, notes)
VALUES ('dddddddd-0000-4000-8000-000000000001', current_date + 80, 'scheduled','Auto-renew; 60-day notice window')
ON CONFLICT DO NOTHING;

INSERT INTO public.exp_contract_renewals (contract_id, renewal_date, reminder_state, notes)
SELECT id, COALESCE(end_date, current_date + 45), 'scheduled', 'Seeded renewal checkpoint'
FROM public.exp_contracts WHERE id <> 'dddddddd-0000-4000-8000-000000000001'
ON CONFLICT DO NOTHING;

-- existing active contracts get line items so provisioning has something to read
INSERT INTO public.exp_contract_line_items (contract_id, product_key, qty, unit_price, term, notes)
SELECT c.id, v.product_key, v.qty, v.unit_price, 'monthly', 'Seeded from contract MRR'
FROM public.exp_contracts c
CROSS JOIN (VALUES ('nora',20,69::numeric),('listings',20,29::numeric),('reviews',20,0::numeric)) AS v(product_key, qty, unit_price)
WHERE c.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM public.exp_contract_line_items li WHERE li.contract_id = c.id);

-- provision entitlements for every active contract, and activate the sample enterprise deal
UPDATE public.exp_contracts SET status = 'active' WHERE id = 'dddddddd-0000-4000-8000-000000000001';
SELECT public.exp_contract_provision(id) FROM public.exp_contracts WHERE status = 'active';