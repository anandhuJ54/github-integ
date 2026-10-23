
CREATE POLICY "Public read professionals" ON public.professionals FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY "Public read reviews" ON public.reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read content_items" ON public.content_items FOR SELECT TO anon, authenticated USING (status = 'published');
CREATE POLICY "Public read credentials" ON public.credentials FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read organizations" ON public.organizations FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read search_rank_scores" ON public.search_rank_scores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read aggregate_ratings" ON public.aggregate_ratings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read exp_category_compliance srp" ON public.exp_category_compliance FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read subscriptions srp" ON public.subscriptions FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.professionals TO anon;
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT ON public.content_items TO anon;
GRANT SELECT ON public.credentials TO anon;
GRANT SELECT ON public.organizations TO anon;
GRANT SELECT ON public.search_rank_scores TO anon;
GRANT SELECT ON public.aggregate_ratings TO anon;
GRANT SELECT ON public.exp_category_compliance TO anon;
GRANT SELECT ON public.subscriptions TO anon;
GRANT SELECT ON public.v_professional_profile TO anon, authenticated;
