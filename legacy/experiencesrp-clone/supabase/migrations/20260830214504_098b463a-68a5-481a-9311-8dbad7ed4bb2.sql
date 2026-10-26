CREATE TABLE IF NOT EXISTS public.exp_web_consent_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  banner_enabled BOOLEAN NOT NULL DEFAULT true,
  banner_title TEXT NOT NULL DEFAULT 'We respect your privacy',
  banner_message TEXT NOT NULL DEFAULT 'We use necessary cookies to run this site. Analytics and marketing cookies are off unless you turn them on.',
  analytics_default BOOLEAN NOT NULL DEFAULT false,
  marketing_default BOOLEAN NOT NULL DEFAULT false,
  policy_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.exp_web_consent_config TO anon;
GRANT SELECT, INSERT, UPDATE ON public.exp_web_consent_config TO authenticated;
GRANT ALL ON public.exp_web_consent_config TO service_role;
ALTER TABLE public.exp_web_consent_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consent config readable" ON public.exp_web_consent_config FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "consent config staff write" ON public.exp_web_consent_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.exp_web_consent_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- Staff (signed-in console users) manage all website operational tables.
ALTER TABLE public.exp_web_pages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exp_web_pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_pages TO authenticated;
GRANT ALL ON public.exp_web_pages TO service_role;
CREATE POLICY "published pages public" ON public.exp_web_pages FOR SELECT TO anon USING (status = 'published');
CREATE POLICY "pages staff all" ON public.exp_web_pages FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.exp_web_forms ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exp_web_forms TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_forms TO authenticated;
GRANT ALL ON public.exp_web_forms TO service_role;
CREATE POLICY "active forms public" ON public.exp_web_forms FOR SELECT TO anon USING (active IS TRUE);
CREATE POLICY "forms staff all" ON public.exp_web_forms FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.exp_web_leads ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.exp_web_leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_leads TO authenticated;
GRANT ALL ON public.exp_web_leads TO service_role;
CREATE POLICY "public can submit lead" ON public.exp_web_leads FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "leads staff all" ON public.exp_web_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.exp_web_trust_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exp_web_trust_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_trust_items TO authenticated;
GRANT ALL ON public.exp_web_trust_items TO service_role;
CREATE POLICY "trust items public" ON public.exp_web_trust_items FOR SELECT TO anon USING (true);
CREATE POLICY "trust staff all" ON public.exp_web_trust_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.exp_web_consent_events ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.exp_web_consent_events TO anon;
GRANT SELECT, INSERT, DELETE ON public.exp_web_consent_events TO authenticated;
GRANT ALL ON public.exp_web_consent_events TO service_role;
CREATE POLICY "public can record consent" ON public.exp_web_consent_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "consent staff read" ON public.exp_web_consent_events FOR SELECT TO authenticated USING (true);

ALTER TABLE public.exp_web_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exp_web_alerts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_alerts TO authenticated;
GRANT ALL ON public.exp_web_alerts TO service_role;
CREATE POLICY "active alerts public" ON public.exp_web_alerts FOR SELECT TO anon USING (active IS TRUE);
CREATE POLICY "alerts staff all" ON public.exp_web_alerts FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.exp_web_ads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_ads TO authenticated;
GRANT ALL ON public.exp_web_ads TO service_role;
CREATE POLICY "ads staff all" ON public.exp_web_ads FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.exp_web_campaigns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_campaigns TO authenticated;
GRANT ALL ON public.exp_web_campaigns TO service_role;
CREATE POLICY "campaigns staff all" ON public.exp_web_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.exp_web_media ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.exp_web_media TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_web_media TO authenticated;
GRANT ALL ON public.exp_web_media TO service_role;
CREATE POLICY "media public read" ON public.exp_web_media FOR SELECT TO anon USING (true);
CREATE POLICY "media staff all" ON public.exp_web_media FOR ALL TO authenticated USING (true) WITH CHECK (true);