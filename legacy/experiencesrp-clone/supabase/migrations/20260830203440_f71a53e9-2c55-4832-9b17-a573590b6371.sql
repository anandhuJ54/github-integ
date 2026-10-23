-- Comp plans: commissions computed on NET margin, never gross.
CREATE TABLE IF NOT EXISTS public.exp_comp_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL,
  rate_pct numeric NOT NULL DEFAULT 0,
  basis text NOT NULL DEFAULT 'net',
  active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_comp_plans TO authenticated;
GRANT ALL ON public.exp_comp_plans TO service_role;
ALTER TABLE public.exp_comp_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comp plans readable by console users" ON public.exp_comp_plans;
CREATE POLICY "comp plans readable by console users" ON public.exp_comp_plans
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "comp plans writable by console users" ON public.exp_comp_plans;
CREATE POLICY "comp plans writable by console users" ON public.exp_comp_plans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Deal-level margin rollup + rep attribution + margin approval routing.
ALTER TABLE public.exp_contracts
  ADD COLUMN IF NOT EXISTS sold_by uuid REFERENCES public.exp_sales_reps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS net numeric,
  ADD COLUMN IF NOT EXISTS cost numeric,
  ADD COLUMN IF NOT EXISTS margin_pct numeric,
  ADD COLUMN IF NOT EXISTS approval_state text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_note text;

CREATE INDEX IF NOT EXISTS exp_contracts_sold_by_idx ON public.exp_contracts (sold_by);

-- Seed default plans, one per seller role, all on NET basis.
INSERT INTO public.exp_comp_plans (name, role, rate_pct, basis, notes)
SELECT v.name, v.role, v.rate, 'net', 'Commission on net margin; deals below the price-book floor margin pay $0.'
FROM (VALUES
  ('SRE net plan', 'srx', 0.08),
  ('SMB net plan', 'smb', 0.10),
  ('Mid-Market net plan', 'mid_market', 0.09),
  ('Enterprise net plan', 'enterprise', 0.07)
) AS v(name, role, rate)
WHERE NOT EXISTS (SELECT 1 FROM public.exp_comp_plans p WHERE p.role = v.role AND p.active);