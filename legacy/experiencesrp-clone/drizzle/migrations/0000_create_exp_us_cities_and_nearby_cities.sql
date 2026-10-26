CREATE TABLE IF NOT EXISTS public.exp_us_cities (
  id BIGSERIAL PRIMARY KEY,
  city TEXT NOT NULL,
  state_abbr TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  population INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS exp_us_cities_city_state_key
  ON public.exp_us_cities (lower(city), upper(state_abbr));
CREATE INDEX IF NOT EXISTS exp_us_cities_latlng_idx ON public.exp_us_cities (lat, lng);
CREATE INDEX IF NOT EXISTS exp_us_cities_state_idx ON public.exp_us_cities (upper(state_abbr));

GRANT SELECT ON public.exp_us_cities TO anon, authenticated;
GRANT ALL ON public.exp_us_cities TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.exp_us_cities_id_seq TO service_role;

ALTER TABLE public.exp_us_cities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "us cities are public reference data" ON public.exp_us_cities;
CREATE POLICY "us cities are public reference data"
  ON public.exp_us_cities FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.exp_haversine_miles(
  a_lat DOUBLE PRECISION, a_lng DOUBLE PRECISION,
  b_lat DOUBLE PRECISION, b_lng DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 7917.5 * asin(
    least(1, sqrt(
      power(sin(radians(b_lat - a_lat) / 2), 2) +
      cos(radians(a_lat)) * cos(radians(b_lat)) *
      power(sin(radians(b_lng - a_lng) / 2), 2)
    ))
  );
$$;

CREATE OR REPLACE FUNCTION public.nearby_cities(
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_limit INTEGER DEFAULT 8,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL
) RETURNS TABLE (
  city TEXT,
  state_abbr TEXT,
  label TEXT,
  distance_miles DOUBLE PRECISION,
  population INTEGER,
  profile_count BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lat DOUBLE PRECISION := p_lat;
  v_lng DOUBLE PRECISION := p_lng;
  v_limit INTEGER := greatest(1, least(coalesce(p_limit, 8), 40));
BEGIN
  IF v_lat IS NULL OR v_lng IS NULL THEN
    SELECT c.lat, c.lng INTO v_lat, v_lng
    FROM public.exp_us_cities c
    WHERE lower(c.city) = lower(coalesce(p_city, ''))
      AND (p_state IS NULL OR upper(c.state_abbr) = upper(p_state))
    ORDER BY c.population DESC
    LIMIT 1;
  END IF;

  IF v_lat IS NULL OR v_lng IS NULL THEN
    -- No anchor coordinates: fall back to the largest same-state cities with profiles.
    RETURN QUERY
    SELECT c.city, upper(c.state_abbr), c.city || ', ' || upper(c.state_abbr),
           NULL::DOUBLE PRECISION, c.population, d.n
    FROM public.exp_us_cities c
    JOIN (
      SELECT lower(sd.city) AS lcity, upper(sd.state) AS lstate, count(*) AS n
      FROM public.search_documents sd
      WHERE sd.city IS NOT NULL AND sd.state IS NOT NULL
      GROUP BY 1, 2
    ) d ON d.lcity = lower(c.city) AND d.lstate = upper(c.state_abbr)
    WHERE p_state IS NOT NULL
      AND upper(c.state_abbr) = upper(p_state)
      AND lower(c.city) <> lower(coalesce(p_city, ''))
    ORDER BY c.population DESC
    LIMIT v_limit;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.city,
         upper(c.state_abbr),
         c.city || ', ' || upper(c.state_abbr),
         public.exp_haversine_miles(v_lat, v_lng, c.lat, c.lng) AS distance_miles,
         c.population,
         d.n
  FROM public.exp_us_cities c
  JOIN (
    SELECT lower(sd.city) AS lcity, upper(sd.state) AS lstate, count(*) AS n
    FROM public.search_documents sd
    WHERE sd.city IS NOT NULL AND sd.state IS NOT NULL
    GROUP BY 1, 2
  ) d ON d.lcity = lower(c.city) AND d.lstate = upper(c.state_abbr)
  WHERE NOT (
      lower(c.city) = lower(coalesce(p_city, ''))
      AND (p_state IS NULL OR upper(c.state_abbr) = upper(p_state))
    )
    AND c.lat BETWEEN v_lat - 3.2 AND v_lat + 3.2
    AND c.lng BETWEEN v_lng - 4.5 AND v_lng + 4.5
  ORDER BY distance_miles ASC, c.population DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.nearby_cities(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_haversine_miles(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated, service_role;