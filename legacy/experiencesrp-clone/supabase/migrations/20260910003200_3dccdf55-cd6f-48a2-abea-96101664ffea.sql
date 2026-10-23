ALTER TABLE public.exp_web_pages
  ADD COLUMN IF NOT EXISTS route_path text,
  ADD COLUMN IF NOT EXISTS code_rendered boolean NOT NULL DEFAULT false;

UPDATE public.exp_web_pages
SET route_path = '/' || slug, code_rendered = true
WHERE slug IN (
  'reviews-management','listings','campaigns','insights','social','search-ranking',
  'website-marketing','demo','request-a-demo','404','contact-us','ai-visibility',
  'content','customer-stories','kw-mega-camp-2026','landing-page-inspire-example','find'
);

UPDATE public.exp_web_pages SET route_path = '/trust', code_rendered = true WHERE slug = 'trust';