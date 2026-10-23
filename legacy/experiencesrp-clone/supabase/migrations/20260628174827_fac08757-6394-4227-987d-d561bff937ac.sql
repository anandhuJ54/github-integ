ALTER TABLE public.gbp_categories
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','excluded')),
  ADD COLUMN IF NOT EXISTS supports_single_pro_office BOOLEAN NOT NULL DEFAULT FALSE;