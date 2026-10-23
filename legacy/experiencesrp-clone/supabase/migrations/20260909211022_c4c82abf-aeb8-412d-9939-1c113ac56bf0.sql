ALTER TABLE public.exp_web_pages
  ADD COLUMN IF NOT EXISTS design_tag text NOT NULL DEFAULT 'old_design';

ALTER TABLE public.exp_web_pages
  DROP CONSTRAINT IF EXISTS exp_web_pages_design_tag_chk;

ALTER TABLE public.exp_web_pages
  ADD CONSTRAINT exp_web_pages_design_tag_chk CHECK (design_tag IN ('old_design','new'));