ALTER TABLE public.exp_web_pages
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.exp_web_page_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exp_web_pages_template_id_idx ON public.exp_web_pages(template_id);

-- Starter templates captured from representative live pages
WITH admin AS (SELECT 'f27a3d85-4978-4cd2-835f-8a686be6eb0a'::uuid AS uid),
src AS (
  SELECT
    (SELECT p.id FROM public.exp_web_pages p WHERE p.slug = 'reviews' AND p.deleted_at IS NULL LIMIT 1) AS marketing_id,
    (SELECT p.id FROM public.exp_web_pages p WHERE p.slug = 'listings' AND p.deleted_at IS NULL LIMIT 1) AS designed_id,
    (SELECT p.id FROM public.exp_web_pages p WHERE p.page_type = 'trust' AND p.deleted_at IS NULL ORDER BY p.title LIMIT 1) AS trust_id,
    (SELECT p.id FROM public.exp_web_pages p WHERE p.slug = 'home' AND p.deleted_at IS NULL LIMIT 1) AS home_id,
    (SELECT p.id FROM public.exp_web_pages p WHERE p.slug = 'landing-page-inspire-example' AND p.deleted_at IS NULL LIMIT 1) AS landing_id
),
defs(name, key, page_id) AS (
  SELECT 'Marketing feature page', 'marketing_feature', marketing_id FROM src
  UNION ALL SELECT 'Designed marketing page', 'designed_marketing', designed_id FROM src
  UNION ALL SELECT 'Legal & trust document', 'legal_trust', trust_id FROM src
  UNION ALL SELECT 'Home / overview page', 'home_overview', home_id FROM src
  UNION ALL SELECT 'Campaign landing page', 'campaign_landing', landing_id FROM src
)
INSERT INTO public.exp_web_page_templates
  (name, template_kind, source_page_id, source_page_title, body, page_settings, section_indexes, design_tag, created_by, created_by_label)
SELECT
  d.name,
  'page',
  p.id,
  p.title,
  COALESCE(CASE WHEN jsonb_typeof(p.body::jsonb) = 'array' THEN p.body::jsonb ELSE '[]'::jsonb END, '[]'::jsonb),
  jsonb_build_object(
    'page_type', p.page_type,
    'seo_title', p.seo_title,
    'seo_desc', p.seo_desc,
    'design_tag', p.design_tag,
    'code_rendered', COALESCE(p.code_rendered, false),
    'template_key', d.key
  ),
  COALESCE((SELECT array_agg(i - 1 ORDER BY i) FROM generate_subscripts(ARRAY(SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(p.body::jsonb) = 'array' THEN p.body::jsonb ELSE '[]'::jsonb END)), 1) AS i), '{}'::int[]),
  COALESCE(p.design_tag, 'new'),
  (SELECT uid FROM admin),
  'system · starter template'
FROM defs d
JOIN public.exp_web_pages p ON p.id = d.page_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.exp_web_page_templates t
  WHERE t.page_settings->>'template_key' = d.key AND t.deleted_at IS NULL
);

-- Assign existing pages to the matching starter template
WITH t AS (
  SELECT page_settings->>'template_key' AS key, id
  FROM public.exp_web_page_templates
  WHERE page_settings->>'template_key' IS NOT NULL AND deleted_at IS NULL
),
matched AS (
  SELECT p.id AS page_id,
    CASE
      WHEN p.page_type = 'home' THEN 'home_overview'
      WHEN p.page_type = 'trust' THEN 'legal_trust'
      WHEN p.page_type = 'landing' AND COALESCE(p.code_rendered, false)
           AND jsonb_typeof(p.body::jsonb) = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.body::jsonb) b WHERE b->>'type' = 'inspire_landing')
        THEN 'campaign_landing'
      WHEN COALESCE(p.code_rendered, false) AND jsonb_typeof(p.body::jsonb) = 'array' AND jsonb_array_length(p.body::jsonb) > 0
        THEN 'designed_marketing'
      WHEN NOT COALESCE(p.code_rendered, false) AND jsonb_typeof(p.body::jsonb) = 'array' AND jsonb_array_length(p.body::jsonb) > 0
        THEN 'marketing_feature'
      ELSE NULL
    END AS key
  FROM public.exp_web_pages p
  WHERE p.deleted_at IS NULL AND p.template_id IS NULL
)
UPDATE public.exp_web_pages p
SET template_id = t.id
FROM matched m
JOIN t ON t.key = m.key
WHERE p.id = m.page_id AND m.key IS NOT NULL;