-- NORA external integrations (Google sign-in + Business Profile, Google Places, Apify).
-- Same model as exp_integration_google: holds vault/secret reference NAMES only, never secret values.
-- mode = 'stub' until a super admin switches it to 'live' after the referenced secrets exist.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS public.exp_integration_settings (
  key text PRIMARY KEY CHECK (key IN ('google_business_profile','google_places','apify')),
  mode text NOT NULL DEFAULT 'stub' CHECK (mode IN ('stub','live')),
  secret_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.exp_integration_settings IS 'Platform integrations used by NORA (claim gate, Place ID match, map-rank and LLM-citation monitors). Secret reference NAMES only; values live in the vault-backed environment.';

GRANT SELECT ON public.exp_integration_settings TO authenticated;
GRANT ALL ON public.exp_integration_settings TO service_role;
ALTER TABLE public.exp_integration_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'exp_integration_settings' AND policyname = 'Super admins read integration settings') THEN
    CREATE POLICY "Super admins read integration settings" ON public.exp_integration_settings FOR SELECT TO authenticated USING (public.exp_ctrl_has_role(ARRAY['super_admin']));
  END IF;
END $$;

INSERT INTO public.exp_integration_settings (key, secret_refs, settings) VALUES
  ('google_business_profile', '{"clientId":"GOOGLE_BP_OAUTH_CLIENT_ID","clientSecret":"GOOGLE_BP_OAUTH_CLIENT_SECRET"}'::jsonb, '{}'::jsonb),
  ('google_places', '{"apiKey":"GOOGLE_PLACES_API_KEY"}'::jsonb, '{}'::jsonb),
  ('apify', '{"apiToken":"APIFY_API_TOKEN"}'::jsonb, '{"mapRankActorId":"","llmCitationActorId":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;
