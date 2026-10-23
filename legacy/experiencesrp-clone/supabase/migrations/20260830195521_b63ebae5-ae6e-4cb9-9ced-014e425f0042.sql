ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.professionals ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

UPDATE public.organizations o SET is_demo = true
WHERE o.name ILIKE 'Demo Mortgage Co%'
   OR o.parent_org_id IN (SELECT id FROM public.organizations WHERE name ILIKE 'Demo Mortgage Co%');

UPDATE public.organizations o SET is_demo = true
WHERE o.parent_org_id IN (SELECT id FROM public.organizations WHERE is_demo);

UPDATE public.professionals p SET is_demo = true
WHERE p.primary_org_id IN (SELECT id FROM public.organizations WHERE is_demo);

CREATE INDEX IF NOT EXISTS organizations_is_demo_idx ON public.organizations (is_demo);
CREATE INDEX IF NOT EXISTS professionals_is_demo_idx ON public.professionals (is_demo);