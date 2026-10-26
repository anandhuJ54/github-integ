ALTER TABLE public.exp_claim_events ADD COLUMN IF NOT EXISTS state text;

DO $$
DECLARE
  r record;
  i int;
  states text[] := ARRAY['CA','TX','FL','NY','IL','PA','OH','GA','NC','MI','NJ','VA','WA','AZ','MA','TN','IN','MO','MD','WI','CO','MN','SC','AL','LA','KY','OR','OK','CT','UT','NV','IA','AR','MS','KS','NM','NE','ID','WV','HI'];
  st text; base timestamptz; label text; ph text; em text;
  h int; claimed bool; engaged bool; upgraded bool; lapsed bool; eng int; lag int;
BEGIN
  DELETE FROM public.exp_claim_events WHERE is_demo = true AND entity_label LIKE 'Funnel %';

  FOR r IN SELECT id, group_key, role FROM public.exp_sales_reps LOOP
    FOR i IN 1..44 LOOP
      h := ('x' || substr(md5(r.id::text || i::text), 1, 8))::bit(32)::int;
      h := abs(h);
      st := states[1 + (h % array_length(states,1))];
      base := now() - make_interval(days => (h / 7) % 88);
      label := 'Funnel ' || upper(substr(md5(r.id::text || i::text), 1, 6));
      ph := '(' || (200 + (h % 700))::text || ') 555-' || lpad(((h / 3) % 10000)::text, 4, '0');
      em := 'contact' || i::text || '.' || substr(md5(r.id::text), 1, 4) || '@example.com';
      claimed := (h % 100) < 62;
      engaged := claimed AND ((h / 11) % 100) < 74;
      eng := 20 + ((h / 13) % 80);
      upgraded := engaged AND ((h / 17) % 100) < 38;
      lapsed := engaged AND NOT upgraded AND ((h / 19) % 100) < 45;
      lag := 6 + ((h / 23) % 26);

      INSERT INTO public.exp_claim_events
        (entity_type, entity_label, group_key, seller_id, event_type, nora_engagement, upgraded, contact_phone, contact_email, state, is_demo, occurred_at)
      VALUES ('professional', label, r.group_key, r.id, 'attempted', 0, false, ph, em, st, true, base);

      IF claimed THEN
        INSERT INTO public.exp_claim_events
          (entity_type, entity_label, group_key, seller_id, event_type, nora_engagement, upgraded, contact_phone, contact_email, state, is_demo, occurred_at)
        VALUES ('professional', label, r.group_key, r.id, 'claimed', 0, false, ph, em, st, true, base + interval '1 day');
      END IF;

      IF engaged THEN
        INSERT INTO public.exp_claim_events
          (entity_type, entity_label, group_key, seller_id, event_type, nora_engagement, upgraded, contact_phone, contact_email, state, is_demo, occurred_at)
        VALUES ('professional', label, r.group_key, r.id, 'engaged', eng, false, ph, em, st, true, base + interval '4 days');
      END IF;

      IF upgraded AND base + make_interval(days => lag + 4) < now() THEN
        INSERT INTO public.exp_claim_events
          (entity_type, entity_label, group_key, seller_id, event_type, nora_engagement, upgraded, contact_phone, contact_email, state, is_demo, occurred_at)
        VALUES ('professional', label, r.group_key, r.id, 'upgraded', eng, true, ph, em, st, true, base + make_interval(days => lag + 4));
      ELSIF lapsed AND base + interval '34 days' < now() THEN
        INSERT INTO public.exp_claim_events
          (entity_type, entity_label, group_key, seller_id, event_type, nora_engagement, upgraded, contact_phone, contact_email, state, is_demo, occurred_at)
        VALUES ('professional', label, r.group_key, r.id, 'lapsed_no_upgrade', eng, false, ph, em, st, true, base + interval '34 days');
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- prior-month revenue history (demo)
INSERT INTO public.exp_revenue_components (seller_id, group_key, source, amount, period_start, is_demo)
SELECT rc.seller_id, rc.group_key, rc.source,
       round(rc.amount * m.factor),
       (date_trunc('month', rc.period_start) - make_interval(months => m.back))::date,
       true
FROM public.exp_revenue_components rc
CROSS JOIN (VALUES (1, 0.88), (2, 0.79)) AS m(back, factor)
WHERE rc.period_start = '2026-08-01'
  AND NOT EXISTS (
    SELECT 1 FROM public.exp_revenue_components x
    WHERE x.seller_id = rc.seller_id AND x.source = rc.source
      AND x.period_start = (date_trunc('month', rc.period_start) - make_interval(months => m.back))::date
  );

-- brand adoption (demo) for brands mapped to territories
INSERT INTO public.exp_brand_adoption (org_id, group_key, active_users, engaged_users, referral_marketing, referral_regional, referral_location, is_demo)
SELECT tb.org_id, t.group_key,
       greatest(1, round(t.office_count * 0.34))::int,
       greatest(1, round(t.office_count * 0.19))::int,
       'corporate.marketing@example.com', 'regional.manager@example.com', 'location.manager@example.com',
       true
FROM public.exp_territory_brand tb
JOIN public.exp_territories t ON t.id = tb.territory_id
WHERE NOT EXISTS (SELECT 1 FROM public.exp_brand_adoption a WHERE a.org_id = tb.org_id);

UPDATE public.exp_territories SET seller_id = 'c1000000-0000-4000-8000-000000000006'
WHERE label = 'Insurance_Agency_ENT_1' AND seller_id IS NULL;
UPDATE public.exp_territories SET seller_id = 'c1000000-0000-4000-8000-000000000001'
WHERE label = 'Insurance_Agency_SRE_1' AND seller_id IS NULL;