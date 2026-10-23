ALTER TABLE public.exp_products ADD COLUMN IF NOT EXISTS price_monthly_location numeric;

INSERT INTO public.exp_products (product_key,name,description,entity_scope,billing_type,price_monthly,price_monthly_location,price_unit,is_addon,sort,active) VALUES
 ('nora','Nora','AI search-rank agent: expertise graph, schema output and guided actions.','both','subscription',69,99,'month',false,10,true),
 ('listings','Listings','Directory listing distribution and accuracy monitoring.','both','subscription',29,99,'month',false,20,true),
 ('multipost','Multipost','Publish posts across connected surfaces.','both','free_with_nora',0,0,'month',true,30,true),
 ('reviews','Reviews','Review collection, syndication and AI replies.','both','free_with_nora',0,0,'month',true,40,true),
 ('network','Network','Experience.com network distribution and profile syndication.','both','free_with_nora',0,0,'month',true,50,true),
 ('sponsored','Sponsored','Sponsored placement across category and market pages.','both','subscription',59,129,'month',false,60,true),
 ('conversion_agents','Conversion Agents','On-site conversion agents for capture and routing.','both','subscription',69,99,'month',false,70,true),
 ('voce','VOCE','Voice-of-customer experience intelligence, billed by token package.','both','token',NULL,NULL,'token',false,80,true),
 ('campaigns','Campaigns','Managed review and reputation campaigns, contracted.','both','contract',NULL,NULL,'month',false,90,true)
ON CONFLICT (product_key) DO UPDATE SET
 name=EXCLUDED.name, description=EXCLUDED.description, entity_scope=EXCLUDED.entity_scope,
 billing_type=EXCLUDED.billing_type, price_monthly=EXCLUDED.price_monthly,
 price_monthly_location=EXCLUDED.price_monthly_location, price_unit=EXCLUDED.price_unit,
 is_addon=EXCLUDED.is_addon, sort=EXCLUDED.sort, active=EXCLUDED.active;

ALTER TABLE public.exp_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read products" ON public.exp_products;
CREATE POLICY "Staff read products" ON public.exp_products FOR SELECT TO authenticated USING (true);

ALTER TABLE public.exp_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff read entitlements" ON public.exp_entitlements;
CREATE POLICY "Staff read entitlements" ON public.exp_entitlements FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Staff write entitlements" ON public.exp_entitlements;
CREATE POLICY "Staff write entitlements" ON public.exp_entitlements FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Staff update entitlements" ON public.exp_entitlements;
CREATE POLICY "Staff update entitlements" ON public.exp_entitlements FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Staff write audit log" ON public.audit_log;
CREATE POLICY "Staff write audit log" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Staff read audit log" ON public.audit_log;
CREATE POLICY "Staff read audit log" ON public.audit_log FOR SELECT TO authenticated USING (true);

INSERT INTO public.organizations (id,name,slug,gcid,entity_type,hierarchy_depth,parent_org_id,address_city,address_state,is_active,claimed)
VALUES ('aaaaaaa1-0000-4000-8000-000000000001','Demo Mortgage Co','demo-mortgage-co','gcid:mortgage_broker','enterprise',0,NULL,'Des Moines','IA',true,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id,name,slug,gcid,entity_type,hierarchy_depth,parent_org_id,address_city,address_state,is_active) VALUES
 ('aaaaaaa1-0000-4000-8000-000000000010','Demo Mortgage Co — Midwest Region','demo-mortgage-midwest','gcid:mortgage_broker','firm',1,'aaaaaaa1-0000-4000-8000-000000000001','Chicago','IL',true),
 ('aaaaaaa1-0000-4000-8000-000000000011','Demo Mortgage Co — West Region','demo-mortgage-west','gcid:mortgage_broker','firm',1,'aaaaaaa1-0000-4000-8000-000000000001','Phoenix','AZ',true),
 ('aaaaaaa1-0000-4000-8000-000000000020','Demo Mortgage Co — Davenport Branch','demo-mortgage-davenport','gcid:mortgage_broker','office',2,'aaaaaaa1-0000-4000-8000-000000000010','Davenport','IA',true),
 ('aaaaaaa1-0000-4000-8000-000000000021','Demo Mortgage Co — Naperville Branch','demo-mortgage-naperville','gcid:mortgage_broker','office',2,'aaaaaaa1-0000-4000-8000-000000000010','Naperville','IL',true),
 ('aaaaaaa1-0000-4000-8000-000000000022','Demo Mortgage Co — Tempe Branch','demo-mortgage-tempe','gcid:mortgage_broker','office',2,'aaaaaaa1-0000-4000-8000-000000000011','Tempe','AZ',true),
 ('aaaaaaa1-0000-4000-8000-000000000023','Demo Mortgage Co — Boise Branch','demo-mortgage-boise','gcid:mortgage_broker','office',2,'aaaaaaa1-0000-4000-8000-000000000011','Boise','ID',true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.professionals (id,first_name,last_name,display_name,slug,gcid,job_title,address_city,address_state,primary_org_id,is_active,claimed,search_rank_score) VALUES
 ('aaaaaaa2-0000-4000-8000-000000000001','Dana','Whitfield','Dana Whitfield','demo-dana-whitfield','gcid:mortgage_broker','Loan Officer','Davenport','IA','aaaaaaa1-0000-4000-8000-000000000020',true,false,NULL),
 ('aaaaaaa2-0000-4000-8000-000000000002','Marcus','Alvarez','Marcus Alvarez','demo-marcus-alvarez','gcid:mortgage_broker','Senior Loan Officer','Davenport','IA','aaaaaaa1-0000-4000-8000-000000000020',true,false,NULL),
 ('aaaaaaa2-0000-4000-8000-000000000003','Priya','Raman','Priya Raman','demo-priya-raman','gcid:mortgage_broker','Loan Officer','Naperville','IL','aaaaaaa1-0000-4000-8000-000000000021',true,false,NULL),
 ('aaaaaaa2-0000-4000-8000-000000000004','Tom','Beckett','Tom Beckett','demo-tom-beckett','gcid:mortgage_broker','Branch Manager','Tempe','AZ','aaaaaaa1-0000-4000-8000-000000000022',true,false,NULL),
 ('aaaaaaa2-0000-4000-8000-000000000005','Elena','Fischer','Elena Fischer','demo-elena-fischer','gcid:mortgage_broker','Loan Officer','Tempe','AZ','aaaaaaa1-0000-4000-8000-000000000022',true,false,NULL),
 ('aaaaaaa2-0000-4000-8000-000000000006','Jordan','Pike','Jordan Pike','demo-jordan-pike','gcid:mortgage_broker','Loan Officer','Boise','ID','aaaaaaa1-0000-4000-8000-000000000023',true,false,NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exp_entitlements (subject_type,subject_id,product_key,state,source,tokens_included)
VALUES ('organization','aaaaaaa1-0000-4000-8000-000000000001','nora','active','seed',0),
       ('organization','aaaaaaa1-0000-4000-8000-000000000001','reviews','active','seed',0),
       ('organization','aaaaaaa1-0000-4000-8000-000000000001','listings','entitled_unconfigured','seed',0),
       ('organization','aaaaaaa1-0000-4000-8000-000000000001','voce','entitled_unconfigured','seed',25000)
ON CONFLICT (subject_type,subject_id,product_key) DO NOTHING;

INSERT INTO public.organizations (id,name,slug,gcid,entity_type,hierarchy_depth,parent_org_id,address_city,address_state,is_active,claimed)
VALUES ('bbbbbbb1-0000-4000-8000-000000000001','State Farm','state-farm','gcid:insurance_agency','brand',0,NULL,'Bloomington','IL',true,true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id,name,slug,gcid,entity_type,hierarchy_depth,parent_org_id,is_active) VALUES
 ('bbbbbbb1-0000-4000-8000-000000000010','State Farm — Central Region','state-farm-central','gcid:insurance_agency','firm',1,'bbbbbbb1-0000-4000-8000-000000000001',true),
 ('bbbbbbb1-0000-4000-8000-000000000011','State Farm — East Region','state-farm-east','gcid:insurance_agency','firm',1,'bbbbbbb1-0000-4000-8000-000000000001',true),
 ('bbbbbbb1-0000-4000-8000-000000000012','State Farm — West Region','state-farm-west','gcid:insurance_agency','firm',1,'bbbbbbb1-0000-4000-8000-000000000001',true),
 ('bbbbbbb1-0000-4000-8000-000000000013','State Farm — South Region','state-farm-south','gcid:insurance_agency','firm',1,'bbbbbbb1-0000-4000-8000-000000000001',true)
ON CONFLICT (id) DO NOTHING;

WITH sample AS (
  SELECT e.entity_id, e.display_name,
         row_number() OVER (ORDER BY e.display_name) AS rn
  FROM public.exp_entity e
  WHERE e.entity_type = 'location' AND e.display_name ILIKE '%state farm%'
  ORDER BY e.display_name
  LIMIT 300
), ins_branch AS (
  INSERT INTO public.organizations (id,name,slug,gcid,entity_type,hierarchy_depth,parent_org_id,is_active)
  SELECT s.entity_id, s.display_name, 'sf-' || substr(s.entity_id::text,1,8),
         'gcid:insurance_agency','office',2,
         (ARRAY['bbbbbbb1-0000-4000-8000-000000000010','bbbbbbb1-0000-4000-8000-000000000011',
                'bbbbbbb1-0000-4000-8000-000000000012','bbbbbbb1-0000-4000-8000-000000000013']::uuid[])[(s.rn % 4) + 1],
         true
  FROM sample s
  ON CONFLICT (id) DO NOTHING
  RETURNING id, name
)
INSERT INTO public.professionals (first_name,last_name,display_name,slug,gcid,job_title,primary_org_id,is_active,claimed,search_rank_score)
SELECT
  split_part(trim(split_part(b.name,'—',1)),' ',1),
  coalesce(nullif(split_part(trim(split_part(b.name,'—',1)),' ',2),''),'Agent'),
  trim(split_part(b.name,'—',1)),
  'sf-agent-' || substr(b.id::text,1,8),
  'gcid:insurance_agency','Insurance Agent',b.id,true,false,NULL
FROM ins_branch b
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.exp_entitlements (subject_type,subject_id,product_key,state,source)
VALUES ('organization','bbbbbbb1-0000-4000-8000-000000000001','nora','active','seed'),
       ('organization','bbbbbbb1-0000-4000-8000-000000000001','listings','active','seed'),
       ('organization','bbbbbbb1-0000-4000-8000-000000000001','reviews','active','seed'),
       ('organization','bbbbbbb1-0000-4000-8000-000000000001','network','active','seed')
ON CONFLICT (subject_type,subject_id,product_key) DO NOTHING;

INSERT INTO public.exp_contracts (org_id,account_id,name,status,start_date,mrr,token_package)
SELECT 'aaaaaaa1-0000-4000-8000-000000000001','aaaaaaa1-0000-4000-8000-000000000001','Demo Mortgage Co — Enterprise','active',current_date - 60,4140,25000
WHERE NOT EXISTS (SELECT 1 FROM public.exp_contracts WHERE name='Demo Mortgage Co — Enterprise');

INSERT INTO public.exp_contracts (org_id,account_id,name,status,start_date,mrr,token_package)
SELECT 'bbbbbbb1-0000-4000-8000-000000000001','bbbbbbb1-0000-4000-8000-000000000001','State Farm — Network Agreement','active',current_date - 120,148500,0
WHERE NOT EXISTS (SELECT 1 FROM public.exp_contracts WHERE name='State Farm — Network Agreement');