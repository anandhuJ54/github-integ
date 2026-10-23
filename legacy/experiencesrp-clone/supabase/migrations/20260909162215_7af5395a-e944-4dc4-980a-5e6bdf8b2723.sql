-- Public serving: active sponsored slots for a category + zip (cap 3 enforced in SQL)
CREATE OR REPLACE FUNCTION public.public_sponsored_slots(p_gcid text, p_geo text)
RETURNS TABLE (
  slot_id uuid,
  slot_position int,
  advertiser_name text,
  advertiser_org_id uuid,
  doc_entity_type text,
  doc_slug text,
  doc_name text,
  doc_title text,
  doc_city text,
  doc_state text,
  doc_zip text,
  doc_rating numeric,
  doc_review_count int,
  doc_rank_score int,
  doc_completeness_pct int,
  doc_photo_url text,
  doc_claimed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.position,
         COALESCE(s.advertiser_name, d.name) AS advertiser_name,
         s.advertiser_org_id,
         d.entity_type, d.slug, d.name, d.title, d.city, d.state, d.zip,
         d.rating, d.review_count, d.rank_score, d.completeness_pct, d.photo_url, d.claimed
  FROM public.exp_sponsored_slots s
  LEFT JOIN public.search_documents d ON d.entity_id = s.advertiser_org_id
  WHERE s.status = 'active'
    AND p_gcid IS NOT NULL AND s.gcid = p_gcid
    AND (p_geo IS NULL OR s.geo_value = p_geo)
    AND (s.starts_on IS NULL OR s.starts_on <= CURRENT_DATE)
    AND (s.ends_on IS NULL OR s.ends_on >= CURRENT_DATE)
  ORDER BY s.position
  LIMIT 3;
$$;

-- Public serving: best-matching ad units for a context, category and geo
CREATE OR REPLACE FUNCTION public.public_ad_units(p_context text, p_gcid text, p_geo text)
RETURNS TABLE (
  id uuid,
  name text,
  context text,
  target_gcid text,
  target_geo text,
  creative jsonb,
  specificity int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.name, a.context, a.target_gcid, a.target_geo, a.creative,
         (CASE WHEN a.target_gcid = p_gcid THEN 2 ELSE 0 END
          + CASE WHEN a.target_geo IS NOT NULL AND a.target_geo = p_geo THEN 1 ELSE 0 END) AS specificity
  FROM public.exp_web_ads a
  WHERE a.status = 'active'
    AND a.context = p_context
    AND (a.target_gcid IS NULL OR a.target_gcid = 'default' OR a.target_gcid = p_gcid)
    AND (a.target_geo IS NULL OR a.target_geo = p_geo)
    AND (a.starts_on IS NULL OR a.starts_on <= CURRENT_DATE)
    AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)
  ORDER BY specificity DESC, a.created_at;
$$;

-- Light, honest impression accounting: one upsert per public page render
CREATE OR REPLACE FUNCTION public.public_page_view_ping(
  p_gcid text,
  p_geo_value text,
  p_claim_cta boolean DEFAULT false,
  p_geo_type text DEFAULT 'zip'
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_gcid IS NULL OR p_gcid = '' OR p_geo_value IS NULL OR p_geo_value = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.exp_page_views_rollup
    (gcid, geo_type, geo_value, day, page_views, unique_visitors, claim_cta_views, claims, is_demo)
  VALUES
    (p_gcid, COALESCE(p_geo_type, 'zip'), p_geo_value, CURRENT_DATE, 1, 0,
     CASE WHEN p_claim_cta THEN 1 ELSE 0 END, 0, false)
  ON CONFLICT (gcid, geo_type, geo_value, day) DO UPDATE
    SET page_views = public.exp_page_views_rollup.page_views + 1,
        claim_cta_views = public.exp_page_views_rollup.claim_cta_views
          + CASE WHEN p_claim_cta THEN 1 ELSE 0 END;
END;
$$;

REVOKE ALL ON FUNCTION public.public_sponsored_slots(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_ad_units(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_page_view_ping(text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_sponsored_slots(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_ad_units(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_page_view_ping(text, text, boolean, text) TO anon, authenticated, service_role;