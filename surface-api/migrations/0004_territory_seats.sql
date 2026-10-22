CREATE TABLE IF NOT EXISTS public.exp_territory_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  territory_id uuid NOT NULL REFERENCES public.exp_territories(id) ON DELETE CASCADE,
  rep_id uuid NOT NULL REFERENCES public.exp_sales_reps(id) ON DELETE CASCADE,
  group_key text,
  lane_role text NOT NULL CHECK (lane_role IN ('SRE','SMB','MM','ENT')),
  is_nora_default boolean NOT NULL DEFAULT false,
  monthly_quota numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (territory_id, rep_id, lane_role)
);
CREATE INDEX IF NOT EXISTS exp_territory_seats_rep_idx ON public.exp_territory_seats(rep_id);
CREATE INDEX IF NOT EXISTS exp_territory_seats_group_idx ON public.exp_territory_seats(group_key);
COMMENT ON TABLE public.exp_territory_seats IS 'Seller seats: many reps per territory, many territories per rep, one row per (territory, rep, lane role) with per-seat quota. NORA default seat flagged.';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_territory_seats TO authenticated;
GRANT ALL ON public.exp_territory_seats TO service_role;
ALTER TABLE public.exp_territory_seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read exp_territory_seats" ON public.exp_territory_seats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff insert exp_territory_seats" ON public.exp_territory_seats FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff update exp_territory_seats" ON public.exp_territory_seats FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff delete exp_territory_seats" ON public.exp_territory_seats FOR DELETE TO authenticated USING (true);