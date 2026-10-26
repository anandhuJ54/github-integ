-- 1. allow the gate's non-promoting outcomes on staging
ALTER TABLE public.exp_etl_staging
  DROP CONSTRAINT IF EXISTS exp_etl_staging_resolution_status_check;
ALTER TABLE public.exp_etl_staging
  ADD CONSTRAINT exp_etl_staging_resolution_status_check
  CHECK (resolution_status = ANY (ARRAY['pending','matched','created','corroborated','conflicted','rejected','shallow','needs_review']));

-- 2. per-category field-yield floor
CREATE TABLE public.exp_etl_field_floors (
  gcid text PRIMARY KEY,
  min_fields integer NOT NULL DEFAULT 8,
  required_keys text[] NOT NULL DEFAULT '{}',
  min_products integer NOT NULL DEFAULT 0,
  min_licenses integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exp_etl_field_floors TO authenticated;
GRANT ALL ON public.exp_etl_field_floors TO service_role;
ALTER TABLE public.exp_etl_field_floors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "field floors readable by signed-in users"
  ON public.exp_etl_field_floors FOR SELECT TO authenticated USING (true);

INSERT INTO public.exp_etl_field_floors (gcid, min_fields, required_keys, min_products, min_licenses, notes)
VALUES (
  'gcid:insurance_agent', 8,
  ARRAY['bio','street','city','state','phone'],
  3, 1,
  'Insurance agent detail pages expose full JSON-LD + credentials. A record under this floor is an index/listing capture, not a detail capture.'
)
ON CONFLICT (gcid) DO NOTHING;

-- 3. background hydration job control (single-flight lease + counters)
CREATE TABLE public.exp_etl_hydrate_jobs (
  job_key text PRIMARY KEY,
  gcid text NOT NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status = ANY (ARRAY['idle','running','paused','done'])),
  batch_size integer NOT NULL DEFAULT 500,
  lease_until timestamptz,
  processed bigint NOT NULL DEFAULT 0,
  promoted bigint NOT NULL DEFAULT 0,
  shallow bigint NOT NULL DEFAULT 0,
  failed bigint NOT NULL DEFAULT 0,
  last_error text,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exp_etl_hydrate_jobs TO authenticated;
GRANT ALL ON public.exp_etl_hydrate_jobs TO service_role;
ALTER TABLE public.exp_etl_hydrate_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hydrate job progress readable by signed-in users"
  ON public.exp_etl_hydrate_jobs FOR SELECT TO authenticated USING (true);

INSERT INTO public.exp_etl_hydrate_jobs (job_key, gcid, status, batch_size)
VALUES ('statefarm_deep_hydrate', 'gcid:insurance_agent', 'paused', 500)
ON CONFLICT (job_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.exp_etl_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_field_floors_updated_at BEFORE UPDATE ON public.exp_etl_field_floors
  FOR EACH ROW EXECUTE FUNCTION public.exp_etl_touch_updated_at();
CREATE TRIGGER trg_hydrate_jobs_updated_at BEFORE UPDATE ON public.exp_etl_hydrate_jobs
  FOR EACH ROW EXECUTE FUNCTION public.exp_etl_touch_updated_at();