-- NORA queue #12 — back-commit of NORA OS tables that exist live but had no committed migration.
-- Tables: exp_skill_registry, exp_capability_registry, exp_skill_version, exp_skill_eval,
--         exp_nora_state, exp_nora_weights, exp_build_map, exp_opportunity_feedback.
-- (exp_skill_run is already committed in supabase/migrations/20261011120000_nora_skill_run_log.sql.)
--
-- Reproduced from the live catalog on 2026-10-11 (pg_attribute / pg_attrdef / pg_constraint /
-- pg_indexes / pg_policies / pg_trigger / relacl). Live facts: owner postgres; no CHECK or FK
-- constraints; no triggers; no table or column comments; not in any publication; no dependent
-- views; RLS enabled (not forced) on all eight, one PERMISSIVE FOR ALL policy each to
-- authenticated USING (true) WITH CHECK (true). Table ACLs (ALL to anon / authenticated /
-- service_role, SELECT+INSERT to sandbox_exec) come from the `postgres` default privileges in
-- schema public; the GRANTs below restate them explicitly.
--
-- IDEMPOTENT and a NO-OP against the live database: CREATE TABLE / INDEX IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, policies created only when missing, GRANT is additive,
-- ENABLE RLS is a no-op when already on. Nothing is dropped; no data.
--
-- VERIFICATION (read-only; run against the live DB, every row should show ok = true):
--   with expected(t, cols, nn, defs, idx, pol, rls) as (values
--     ('exp_build_map',11,7,5,1,1,true), ('exp_capability_registry',18,15,12,2,1,true),
--     ('exp_nora_state',9,5,4,1,1,true), ('exp_nora_weights',3,2,0,1,1,true),
--     ('exp_opportunity_feedback',10,6,3,2,1,true), ('exp_skill_eval',9,7,5,2,1,true),
--     ('exp_skill_registry',41,28,26,2,1,true), ('exp_skill_version',8,6,2,2,1,true))
--   select e.t,
--     (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=e.t) cols,
--     (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=e.t and c.is_nullable='NO') nn,
--     (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=e.t and c.column_default is not null) defs,
--     (select count(*) from pg_indexes i where i.schemaname='public' and i.tablename=e.t) idx,
--     (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=e.t) pol,
--     (select relrowsecurity from pg_class where oid=('public.'||e.t)::regclass) rls,
--     ((select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=e.t)=e.cols
--      and (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=e.t and c.is_nullable='NO')=e.nn
--      and (select count(*) from information_schema.columns c where c.table_schema='public' and c.table_name=e.t and c.column_default is not null)=e.defs
--      and (select count(*) from pg_indexes i where i.schemaname='public' and i.tablename=e.t)=e.idx
--      and (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=e.t)=e.pol
--      and (select relrowsecurity from pg_class where oid=('public.'||e.t)::regclass)=e.rls) ok
--   from expected e order by 1;
-- Column-level check (name : type : null-ness : default, in attnum order; every row columns_match = true):
--   with expected(t, sig) as (values
--     ('exp_skill_registry', 'id:uuid:NN:gen_random_uuid()|key:text:NN:|title:text:NN:|summary:text:N:|value_loop:text:N:|owning_surface:text:N:|gap_closed:text:N:|triggers:text[]:NN:''{}''::text[]|reads_state:text[]:NN:''{}''::text[]|tools_used:text[]:NN:''{}''::text[]|autonomy:text:NN:''approve''::text|model_tier:text:NN:''haiku''::text|explanation_template:text:N:|guardrails:text[]:NN:''{}''::text[]|status:text:NN:''draft''::text|version:text:NN:''0.1.0''::text|is_active:boolean:NN:true|created_at:timestamp with time zone:NN:now()|updated_at:timestamp with time zone:NN:now()|entity_types:text[]:NN:''{}''::text[]|requires_entitlement:text:N:|value_prop:text:N:|graph_writes:text[]:NN:''{}''::text[]|affects_lanes:text[]:NN:''{}''::text[]|expected_srs_lift:integer:N:|offer_expected_points:integer:N:|offer_ranking_effect:text:N:|price_ref:text:N:|trial_eligible:boolean:NN:false|decline_mute_days:integer:NN:14|permanently_dismissible:boolean:NN:false|requires_user_approval:boolean:NN:false|charges_money:boolean:NN:false|captures_consent:boolean:NN:false|is_async:boolean:NN:false|estimated_duration:text:N:|produces_report:boolean:NN:false|tracks_results:boolean:NN:false|result_metrics:text[]:NN:''{}''::text[]|report_to_weekly_digest:boolean:NN:false|success_event:text:N:'),
--     ('exp_capability_registry', 'id:uuid:NN:gen_random_uuid()|key:text:NN:|title:text:NN:|owning_surface:text:NN:|description:text:N:|inputs:jsonb:NN:''{}''::jsonb|outputs:jsonb:NN:''{}''::jsonb|reads_state:text[]:NN:''{}''::text[]|entitlement_required:text:N:|side_effects:text[]:NN:''{}''::text[]|idempotent_key:text:N:|dry_run:boolean:NN:true|events_emitted:text[]:NN:''{}''::text[]|transport:text:NN:''direct''::text|status:text:NN:''draft''::text|version:text:NN:''0.1.0''::text|created_at:timestamp with time zone:NN:now()|updated_at:timestamp with time zone:NN:now()'),
--     ('exp_skill_version', 'id:uuid:NN:gen_random_uuid()|skill_key:text:NN:|version:text:NN:|manifest:jsonb:NN:|status:text:NN:|published_by:text:N:|note:text:N:|published_at:timestamp with time zone:NN:now()'),
--     ('exp_skill_eval', 'id:uuid:NN:gen_random_uuid()|skill_key:text:NN:|name:text:NN:|fixture:jsonb:NN:''{}''::jsonb|expected:jsonb:NN:''{}''::jsonb|status:text:NN:''untested''::text|last_run_at:timestamp with time zone:N:|last_result:jsonb:N:|created_at:timestamp with time zone:NN:now()'),
--     ('exp_nora_state', 'entity_ref:text:NN:|entity_type:text:NN:''professional''::text|name:text:N:|title:text:N:|market:text:N:|category:text:N:|state:jsonb:NN:''{}''::jsonb|is_demo:boolean:NN:true|updated_at:timestamp with time zone:NN:now()'),
--     ('exp_nora_weights', 'key:text:NN:|weight:numeric:NN:|note:text:N:'),
--     ('exp_build_map', 'id:uuid:NN:gen_random_uuid()|track:text:NN:''customer''::text|step_no:integer:NN:|title:text:NN:|description:text:N:|state:text:NN:''not_built''::text|emits_event:text:N:|consumes_event:text:N:|notes:text:N:|sort_order:integer:NN:0|created_at:timestamp with time zone:NN:now()'),
--     ('exp_opportunity_feedback', 'id:uuid:NN:gen_random_uuid()|entity_id:text:NN:|entity_type:text:N:|opportunity_key:text:NN:|signal:text:NN:|weight:numeric:NN:''-1''::integer|snooze_until:timestamp with time zone:N:|note:text:N:|actor:text:N:|created_at:timestamp with time zone:NN:now()')
--   ), live as (select c.relname::text t, string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||case when a.attnotnull then 'NN' else 'N' end||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''), '|' order by a.attnum) sig from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relnamespace='public'::regnamespace and c.relkind='r' group by 1)
--   select e.t, (l.sig = e.sig) as columns_match, array_length(string_to_array(l.sig,'|'),1) live_cols, array_length(string_to_array(e.sig,'|'),1) expected_cols from expected e left join live l using (t) order by 1;
-- Constraint / index / policy / trigger check (expected: con 10/10, idx 3/3, pol 8/8, no trg row, mismatches null):
--  with expected(kind, name, def) as (values
--    ('con','exp_skill_registry_pkey','PRIMARY KEY (id)'), ('con','exp_skill_registry_key_key','UNIQUE (key)'),
--    ('con','exp_capability_registry_pkey','PRIMARY KEY (id)'), ('con','exp_capability_registry_key_key','UNIQUE (key)'),
--    ('con','exp_skill_version_pkey','PRIMARY KEY (id)'), ('con','exp_skill_eval_pkey','PRIMARY KEY (id)'),
--    ('con','exp_nora_state_pkey','PRIMARY KEY (entity_ref)'), ('con','exp_nora_weights_pkey','PRIMARY KEY (key)'),
--    ('con','exp_build_map_pkey','PRIMARY KEY (id)'), ('con','exp_opportunity_feedback_pkey','PRIMARY KEY (id)'),
--    ('idx','idx_skillver','CREATE INDEX idx_skillver ON public.exp_skill_version USING btree (skill_key, published_at DESC)'),
--    ('idx','idx_skilleval','CREATE INDEX idx_skilleval ON public.exp_skill_eval USING btree (skill_key)'),
--    ('idx','idx_oppfb_entity','CREATE INDEX idx_oppfb_entity ON public.exp_opportunity_feedback USING btree (entity_id, opportunity_key)'),
--    ('pol','exp_skill_registry.Staff all skill','ALL PERMISSIVE {authenticated} true true'),
--    ('pol','exp_capability_registry.Staff all cap','ALL PERMISSIVE {authenticated} true true'),
--    ('pol','exp_skill_version.Staff all skillver','ALL PERMISSIVE {authenticated} true true'),
--    ('pol','exp_skill_eval.Staff all skilleval','ALL PERMISSIVE {authenticated} true true'),
--    ('pol','exp_nora_state.Staff all norastate','ALL PERMISSIVE {authenticated} true true'),
--    ('pol','exp_nora_weights.Staff all noraweights','ALL PERMISSIVE {authenticated} true true'),
--    ('pol','exp_build_map.Staff all buildmap','ALL PERMISSIVE {authenticated} true true'),
--    ('pol','exp_opportunity_feedback.Staff all oppfb','ALL PERMISSIVE {authenticated} true true')
--  ), tbl as (select unnest(array['exp_skill_registry','exp_capability_registry','exp_skill_version','exp_skill_eval',
--      'exp_nora_state','exp_nora_weights','exp_build_map','exp_opportunity_feedback']) t),
--  live as (
--    select 'con' kind, conname::text name, pg_get_constraintdef(oid) def from pg_constraint where conrelid in (select ('public.'||t)::regclass from tbl)
--    union all select 'idx', indexname, indexdef from pg_indexes where schemaname='public' and tablename in (select t from tbl)
--      and indexname not like '%_pkey' and indexname not like '%_key_key'
--    union all select 'pol', tablename||'.'||policyname, cmd||' '||permissive||' '||roles::text||' '||qual||' '||with_check
--      from pg_policies where schemaname='public' and tablename in (select t from tbl)
--    union all select 'trg', tgname, '' from pg_trigger where not tgisinternal and tgrelid in (select ('public.'||t)::regclass from tbl))
--  select coalesce(e.kind,l.kind) kind, count(*) total, count(*) filter (where e.def = l.def) matched,
--         string_agg(case when e.def is distinct from l.def then coalesce(e.name,l.name) end, ', ') mismatches
--  from expected e full join live l on l.kind=e.kind and l.name=e.name group by 1 order by 1;
-- Result against live on 2026-10-11: counts query ok = true for all 8; column check columns_match = true for all 8
-- (41/18/8/9/9/3/11/10 columns); con 10/10, idx 3/3, pol 8/8, no triggers.

-- ---------------------------------------------------------------- exp_skill_registry
CREATE TABLE IF NOT EXISTS public.exp_skill_registry (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
  key                     text        NOT NULL,
  title                   text        NOT NULL,
  summary                 text,
  value_loop              text,
  owning_surface          text,
  gap_closed              text,
  triggers                text[]      NOT NULL DEFAULT '{}'::text[],
  reads_state             text[]      NOT NULL DEFAULT '{}'::text[],
  tools_used              text[]      NOT NULL DEFAULT '{}'::text[],
  autonomy                text        NOT NULL DEFAULT 'approve'::text,
  model_tier              text        NOT NULL DEFAULT 'haiku'::text,
  explanation_template    text,
  guardrails              text[]      NOT NULL DEFAULT '{}'::text[],
  status                  text        NOT NULL DEFAULT 'draft'::text,
  version                 text        NOT NULL DEFAULT '0.1.0'::text,
  is_active               boolean     NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  entity_types            text[]      NOT NULL DEFAULT '{}'::text[],
  requires_entitlement    text,
  value_prop              text,
  graph_writes            text[]      NOT NULL DEFAULT '{}'::text[],
  affects_lanes           text[]      NOT NULL DEFAULT '{}'::text[],
  expected_srs_lift       integer,
  offer_expected_points   integer,
  offer_ranking_effect    text,
  price_ref               text,
  trial_eligible          boolean     NOT NULL DEFAULT false,
  decline_mute_days       integer     NOT NULL DEFAULT 14,
  permanently_dismissible boolean     NOT NULL DEFAULT false,
  requires_user_approval  boolean     NOT NULL DEFAULT false,
  charges_money           boolean     NOT NULL DEFAULT false,
  captures_consent        boolean     NOT NULL DEFAULT false,
  is_async                boolean     NOT NULL DEFAULT false,
  estimated_duration      text,
  produces_report         boolean     NOT NULL DEFAULT false,
  tracks_results          boolean     NOT NULL DEFAULT false,
  result_metrics          text[]      NOT NULL DEFAULT '{}'::text[],
  report_to_weekly_digest boolean     NOT NULL DEFAULT false,
  success_event           text,
  CONSTRAINT exp_skill_registry_pkey PRIMARY KEY (id),
  CONSTRAINT exp_skill_registry_key_key UNIQUE (key)
);
-- Columns 20-41 were added to the live table after its first version; restate them so an
-- older copy of the table converges (no-op live).
ALTER TABLE public.exp_skill_registry
  ADD COLUMN IF NOT EXISTS entity_types            text[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS requires_entitlement    text,
  ADD COLUMN IF NOT EXISTS value_prop              text,
  ADD COLUMN IF NOT EXISTS graph_writes            text[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS affects_lanes           text[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS expected_srs_lift       integer,
  ADD COLUMN IF NOT EXISTS offer_expected_points   integer,
  ADD COLUMN IF NOT EXISTS offer_ranking_effect    text,
  ADD COLUMN IF NOT EXISTS price_ref               text,
  ADD COLUMN IF NOT EXISTS trial_eligible          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS decline_mute_days       integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS permanently_dismissible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_user_approval  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS charges_money           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS captures_consent        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_async                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_duration      text,
  ADD COLUMN IF NOT EXISTS produces_report         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracks_results          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS result_metrics          text[]  NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS report_to_weekly_digest boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS success_event           text;

-- ---------------------------------------------------------------- exp_capability_registry
CREATE TABLE IF NOT EXISTS public.exp_capability_registry (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  key                  text        NOT NULL,
  title                text        NOT NULL,
  owning_surface       text        NOT NULL,
  description          text,
  inputs               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  outputs              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reads_state          text[]      NOT NULL DEFAULT '{}'::text[],
  entitlement_required text,
  side_effects         text[]      NOT NULL DEFAULT '{}'::text[],
  idempotent_key       text,
  dry_run              boolean     NOT NULL DEFAULT true,
  events_emitted       text[]      NOT NULL DEFAULT '{}'::text[],
  transport            text        NOT NULL DEFAULT 'direct'::text,
  status               text        NOT NULL DEFAULT 'draft'::text,
  version              text        NOT NULL DEFAULT '0.1.0'::text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exp_capability_registry_pkey PRIMARY KEY (id),
  CONSTRAINT exp_capability_registry_key_key UNIQUE (key)
);

-- ---------------------------------------------------------------- exp_skill_version
-- skill_key is free text (no FK to exp_skill_registry live).
CREATE TABLE IF NOT EXISTS public.exp_skill_version (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  skill_key    text        NOT NULL,
  version      text        NOT NULL,
  manifest     jsonb       NOT NULL,
  status       text        NOT NULL,
  published_by text,
  note         text,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exp_skill_version_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_skillver ON public.exp_skill_version USING btree (skill_key, published_at DESC);

-- ---------------------------------------------------------------- exp_skill_eval
CREATE TABLE IF NOT EXISTS public.exp_skill_eval (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  skill_key   text        NOT NULL,
  name        text        NOT NULL,
  fixture     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  expected    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status      text        NOT NULL DEFAULT 'untested'::text,
  last_run_at timestamptz,
  last_result jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exp_skill_eval_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_skilleval ON public.exp_skill_eval USING btree (skill_key);

-- ---------------------------------------------------------------- exp_nora_state
CREATE TABLE IF NOT EXISTS public.exp_nora_state (
  entity_ref  text        NOT NULL,
  entity_type text        NOT NULL DEFAULT 'professional'::text,
  name        text,
  title       text,
  market      text,
  category    text,
  state       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  is_demo     boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exp_nora_state_pkey PRIMARY KEY (entity_ref)
);

-- ---------------------------------------------------------------- exp_nora_weights
CREATE TABLE IF NOT EXISTS public.exp_nora_weights (
  key    text    NOT NULL,
  weight numeric NOT NULL,
  note   text,
  CONSTRAINT exp_nora_weights_pkey PRIMARY KEY (key)
);

-- ---------------------------------------------------------------- exp_build_map
CREATE TABLE IF NOT EXISTS public.exp_build_map (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  track          text        NOT NULL DEFAULT 'customer'::text,
  step_no        integer     NOT NULL,
  title          text        NOT NULL,
  description    text,
  state          text        NOT NULL DEFAULT 'not_built'::text,
  emits_event    text,
  consumes_event text,
  notes          text,
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exp_build_map_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------- exp_opportunity_feedback
-- Live default renders as '-1'::integer on a numeric column; DEFAULT -1 reproduces it.
CREATE TABLE IF NOT EXISTS public.exp_opportunity_feedback (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  entity_id       text        NOT NULL,
  entity_type     text,
  opportunity_key text        NOT NULL,
  signal          text        NOT NULL,
  weight          numeric     NOT NULL DEFAULT -1,
  snooze_until    timestamptz,
  note            text,
  actor           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exp_opportunity_feedback_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_oppfb_entity ON public.exp_opportunity_feedback USING btree (entity_id, opportunity_key);

-- ---------------------------------------------------------------- RLS, policies, grants
ALTER TABLE public.exp_skill_registry       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_capability_registry  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_skill_version        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_skill_eval           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_nora_state           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_nora_weights         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_build_map            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exp_opportunity_feedback ENABLE ROW LEVEL SECURITY;

-- One PERMISSIVE FOR ALL policy per table, to authenticated, USING (true) WITH CHECK (true).
-- Created only when missing, so a re-run never drops or alters a live policy.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('exp_skill_registry',       'Staff all skill'),
    ('exp_capability_registry',  'Staff all cap'),
    ('exp_skill_version',        'Staff all skillver'),
    ('exp_skill_eval',           'Staff all skilleval'),
    ('exp_nora_state',           'Staff all norastate'),
    ('exp_nora_weights',         'Staff all noraweights'),
    ('exp_build_map',            'Staff all buildmap'),
    ('exp_opportunity_feedback', 'Staff all oppfb')
  ) AS v(tbl, pol)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
      WHERE polname = r.pol AND polrelid = format('public.%I', r.tbl)::regclass
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        r.pol, r.tbl);
    END IF;
  END LOOP;
END $$;

-- Live ACLs (from default privileges of role postgres in schema public). GRANT is additive.
GRANT ALL ON TABLE
  public.exp_skill_registry, public.exp_capability_registry, public.exp_skill_version,
  public.exp_skill_eval, public.exp_nora_state, public.exp_nora_weights,
  public.exp_build_map, public.exp_opportunity_feedback
  TO anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    GRANT SELECT, INSERT ON TABLE
      public.exp_skill_registry, public.exp_capability_registry, public.exp_skill_version,
      public.exp_skill_eval, public.exp_nora_state, public.exp_nora_weights,
      public.exp_build_map, public.exp_opportunity_feedback
      TO sandbox_exec;
  END IF;
END $$;
