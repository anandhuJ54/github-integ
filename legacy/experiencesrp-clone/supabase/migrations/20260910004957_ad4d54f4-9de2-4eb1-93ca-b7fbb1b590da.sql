CREATE TABLE public.exp_web_nav_menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  menu_type text NOT NULL CHECK (menu_type IN ('header','footer')),
  items jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_site text,
  design_tag text NOT NULL DEFAULT 'new',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid
);

CREATE UNIQUE INDEX exp_web_nav_menus_assignment_uniq
  ON public.exp_web_nav_menus (assigned_site, menu_type)
  WHERE assigned_site IS NOT NULL AND deleted_at IS NULL;

GRANT SELECT ON public.exp_web_nav_menus TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_nav_menus TO authenticated;
GRANT ALL ON public.exp_web_nav_menus TO service_role;

ALTER TABLE public.exp_web_nav_menus ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assigned nav menus public" ON public.exp_web_nav_menus
  FOR SELECT TO anon
  USING (assigned_site IS NOT NULL AND deleted_at IS NULL);

CREATE POLICY "staff read nav menus" ON public.exp_web_nav_menus
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "staff write nav menus" ON public.exp_web_nav_menus
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER exp_web_nav_menus_touch
  BEFORE UPDATE ON public.exp_web_nav_menus
  FOR EACH ROW EXECUTE FUNCTION public.exp_etl_touch_updated_at();

INSERT INTO public.exp_web_nav_menus (name, menu_type, assigned_site, design_tag, notes, items) VALUES
('Main site top nav', 'header', 'main_site', 'new', 'The top nav live on the main website today.', '{
  "groups": [
    {"kind":"menu","label":"Products","wide":true,"items":[
      {"label":"Nora","href":"/product/nora","blurb":"Your always-on presence assistant"},
      {"label":"Listings","href":"/product/listings","blurb":"One accurate profile, everywhere"},
      {"label":"Multi-Post","href":"/product/multi-post","blurb":"Publish once, distribute everywhere"},
      {"label":"Campaigns","href":"/product/campaigns","blurb":"Ask the right customers for proof"},
      {"label":"Reviews","href":"/product/reviews","blurb":"Collect, reply, structure as evidence"},
      {"label":"Network","href":"/product/network","blurb":"Distribution across discovery surfaces"},
      {"label":"VOCE Articles","href":"/product/voce-articles","blurb":"Citable, structured expertise"},
      {"label":"Convert Agents","href":"/product/convert-agents","blurb":"Turn discovery into conversation"},
      {"label":"Competitor Analytics","href":"/product/competitor-analytics","blurb":"See and close the gap"},
      {"label":"Inspire Network","href":"/landing-page-inspire-example","blurb":"Experience.com × Inspire Network landing experience"}
    ]},
    {"kind":"menu","label":"Platforms","items":[
      {"label":"Enterprise XMP","href":"/platform/enterprise-xmp","blurb":"Experience management at brand scale"},
      {"label":"Search Rank Platform","href":"/platform/search-rank-platform","blurb":"Nora does it for you"},
      {"label":"VOCE.com","href":"/platform/voce","blurb":"The complete content engine"},
      {"label":"Brandiva.ai","href":"/platform/brandiva","blurb":"Category-aware AI analytics"}
    ]},
    {"kind":"link","label":"Pricing","href":"/#pricing"},
    {"kind":"link","label":"Trust","href":"/trust"}
  ],
  "actions": [
    {"label":"Sign in","href":"/auth","style":"text"},
    {"label":"Start with Nora","href":"/#pricing","style":"primary"}
  ]
}'::jsonb),
('Main site footer', 'footer', 'main_site', 'new', 'The footer live on the main website today.', '{
  "blurb": "The internet is messy. Nora organizes your presence so the proof you''re the best is discoverable — by customers and by AI.",
  "columns": [
    {"title":"Products","links":[
      {"label":"Nora","href":"/product/nora"},
      {"label":"Listings","href":"/product/listings"},
      {"label":"Multi-Post","href":"/product/multi-post"},
      {"label":"Reviews","href":"/product/reviews"},
      {"label":"VOCE Articles","href":"/product/voce-articles"},
      {"label":"Inspire Network","href":"/landing-page-inspire-example"}
    ]},
    {"title":"Platforms","links":[
      {"label":"Enterprise XMP","href":"/platform/enterprise-xmp"},
      {"label":"Search Rank Platform","href":"/platform/search-rank-platform"},
      {"label":"VOCE.com","href":"/platform/voce"},
      {"label":"Brandiva.ai","href":"/platform/brandiva"}
    ]},
    {"title":"Trust","links":[
      {"label":"Trust Center","href":"/trust"},
      {"label":"Terms of Use","href":"/trust/terms-of-use"},
      {"label":"Privacy Notice","href":"/trust/privacy-notice"},
      {"label":"Cookie Policy","href":"/trust/cookie-policy"},
      {"label":"Responsible Disclosure","href":"/trust/responsible-disclosure-policy"},
      {"label":"Sign in","href":"/auth"}
    ]}
  ]
}'::jsonb),
('Master Marketing top nav', 'header', NULL, 'new', 'Matches the Master Marketing Pages project, pointing at the imported designed routes.', '{
  "groups": [
    {"kind":"menu","label":"Products","wide":true,"items":[
      {"label":"Reviews Management","href":"/reviews-management","blurb":"Collect and respond to customer reviews"},
      {"label":"Listings","href":"/listings","blurb":"Accurate business information everywhere"},
      {"label":"Campaigns","href":"/campaigns","blurb":"Request feedback at the right moment"},
      {"label":"Social","href":"/social","blurb":"Publish and measure social presence"},
      {"label":"Insights","href":"/insights","blurb":"Experience analytics and benchmarks"},
      {"label":"Websites","href":"/website-marketing","blurb":"Location and professional web pages"},
      {"label":"Content","href":"/content","blurb":"Content that earns discovery"}
    ]},
    {"kind":"menu","label":"Solutions","items":[
      {"label":"Search Ranking","href":"/search-ranking","blurb":"Rank where customers search"},
      {"label":"AI Visibility","href":"/ai-visibility","blurb":"Be found by AI assistants"},
      {"label":"Customer Stories","href":"/customer-stories","blurb":"Results from real brands"}
    ]},
    {"kind":"link","label":"Watch a demo","href":"/demo"},
    {"kind":"link","label":"Contact us","href":"/contact-us"}
  ],
  "actions": [
    {"label":"Schedule a call","href":"/request-a-demo","style":"text"},
    {"label":"Request a demo","href":"/request-a-demo","style":"primary"}
  ]
}'::jsonb),
('Master Marketing footer', 'footer', NULL, 'new', 'Footer matching the Master Marketing Pages project inventory.', '{
  "blurb": "Experience management for brands that want to be found, trusted, and chosen.",
  "columns": [
    {"title":"Platform","links":[
      {"label":"Reviews Management","href":"/reviews-management"},
      {"label":"Listings","href":"/listings"},
      {"label":"Campaigns","href":"/campaigns"},
      {"label":"Social","href":"/social"},
      {"label":"Insights","href":"/insights"},
      {"label":"Websites","href":"/website-marketing"}
    ]},
    {"title":"Solutions","links":[
      {"label":"Search Ranking","href":"/search-ranking"},
      {"label":"AI Visibility","href":"/ai-visibility"},
      {"label":"Content","href":"/content"},
      {"label":"Customer Stories","href":"/customer-stories"},
      {"label":"KW Mega Camp 2026","href":"/kw-mega-camp-2026"}
    ]},
    {"title":"Company","links":[
      {"label":"Contact us","href":"/contact-us"},
      {"label":"Watch a demo","href":"/demo"},
      {"label":"Request a demo","href":"/request-a-demo"},
      {"label":"Trust Center","href":"/trust"}
    ]}
  ]
}'::jsonb);