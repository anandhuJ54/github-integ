
-- Allow authenticated users to create and view their own claims
GRANT SELECT, INSERT ON public.claim_queue TO authenticated;
GRANT ALL ON public.claim_queue TO service_role;

CREATE POLICY "Users can view their own claims"
  ON public.claim_queue FOR SELECT TO authenticated
  USING (claimant_user_id = auth.uid());

CREATE POLICY "Users can submit claims"
  ON public.claim_queue FOR INSERT TO authenticated
  WITH CHECK (claimant_user_id = auth.uid());

-- Onboarding progress: users manage their own
GRANT SELECT, INSERT, UPDATE ON public.onboarding_progress TO authenticated;
GRANT ALL ON public.onboarding_progress TO service_role;

CREATE POLICY "Users can view own onboarding"
  ON public.onboarding_progress FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own onboarding"
  ON public.onboarding_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own onboarding"
  ON public.onboarding_progress FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
