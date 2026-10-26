UPDATE public.exp_voce_article
SET author_entity_id = 'aaaaaaa2-0000-4000-8000-000000000001'::uuid,
    author_entity_type = 'professional',
    author_name = 'Dana Whitfield'
WHERE slug = 'refi-signs-2026' AND is_demo = true AND author_entity_id IS NULL;

UPDATE public.exp_voce_article a
SET author_entity_id = p.id,
    author_entity_type = 'professional',
    author_name = p.display_name
FROM (
  SELECT id, display_name FROM public.professionals
  WHERE gcid = 'gcid:insurance_agency' AND is_demo = true
  ORDER BY created_at
  LIMIT 1
) p
WHERE a.slug = 'bundle-home-auto' AND a.is_demo = true AND a.author_entity_id IS NULL;