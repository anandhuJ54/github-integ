CREATE TABLE public.exp_web_page_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  template_kind text NOT NULL CHECK (template_kind IN ('page', 'section')),
  source_page_id uuid REFERENCES public.exp_web_pages(id) ON DELETE SET NULL,
  source_page_title text,
  body jsonb NOT NULL DEFAULT '[]'::jsonb,
  page_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  section_indexes integer[] NOT NULL DEFAULT '{}'::integer[],
  design_tag text NOT NULL DEFAULT 'new' CHECK (design_tag IN ('old_design', 'new')),
  created_by uuid NOT NULL,
  created_by_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_page_templates TO authenticated;
GRANT ALL ON public.exp_web_page_templates TO service_role;

ALTER TABLE public.exp_web_page_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CMS staff can view templates"
ON public.exp_web_page_templates
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "CMS editors can create templates"
ON public.exp_web_page_templates
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND public.exp_ctrl_has_role(ARRAY['super_admin', 'architect'])
);

CREATE POLICY "CMS editors can update templates"
ON public.exp_web_page_templates
FOR UPDATE
TO authenticated
USING (public.exp_ctrl_has_role(ARRAY['super_admin', 'architect']))
WITH CHECK (public.exp_ctrl_has_role(ARRAY['super_admin', 'architect']));

CREATE POLICY "CMS editors can delete templates"
ON public.exp_web_page_templates
FOR DELETE
TO authenticated
USING (public.exp_ctrl_has_role(ARRAY['super_admin', 'architect']));

CREATE OR REPLACE FUNCTION public.exp_touch_web_page_template_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER exp_web_page_templates_touch_updated_at
BEFORE UPDATE ON public.exp_web_page_templates
FOR EACH ROW
EXECUTE FUNCTION public.exp_touch_web_page_template_updated_at();