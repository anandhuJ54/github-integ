ALTER TABLE public.exp_category_knowledge
  ADD COLUMN IF NOT EXISTS value_props        jsonb,
  ADD COLUMN IF NOT EXISTS search_intents     jsonb,
  ADD COLUMN IF NOT EXISTS conversion_actions jsonb;