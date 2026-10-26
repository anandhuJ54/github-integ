ALTER TABLE public.exp_web_pages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;

ALTER TABLE public.exp_web_page_templates
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;

CREATE INDEX IF NOT EXISTS exp_web_pages_deleted_at_idx ON public.exp_web_pages (deleted_at);
CREATE INDEX IF NOT EXISTS exp_web_page_templates_deleted_at_idx ON public.exp_web_page_templates (deleted_at);