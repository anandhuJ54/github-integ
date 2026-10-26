CREATE OR REPLACE FUNCTION public.exp_sf_fetch_tick(p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net, extensions AS $fn$
DECLARE r record; v_req bigint; n int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('exp_sf_fetch_tick_v2')) THEN
    RETURN jsonb_build_object('skipped','locked');
  END IF;

  FOR r IN
    SELECT s.stage_id, s.detail_url
      FROM exp_etl_staging s
     WHERE s.gcid = 'gcid:insurance_agent'
       AND s.field_tier = 'core'
       AND s.detail_url IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM exp_etl_fetch f WHERE f.stage_id = s.stage_id)
     ORDER BY s.observed_at
     LIMIT p_limit
  LOOP
    BEGIN
      SELECT net.http_get(r.detail_url, timeout_milliseconds => 25000) INTO v_req;
      INSERT INTO exp_etl_fetch (stage_id, detail_url, request_id) VALUES (r.stage_id, r.detail_url, v_req);
      n := n + 1;
    EXCEPTION WHEN others THEN
      INSERT INTO exp_etl_fetch (stage_id, detail_url, parsed, parsed_at, note)
      VALUES (r.stage_id, r.detail_url, true, now(), 'fetch error: ' || SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('requested', n);
END $fn$;

CREATE OR REPLACE FUNCTION public.exp_sf_parse_tick(p_limit int DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net, extensions AS $fn$
DECLARE
  r record; v_status int; v_body text; v_f jsonb;
  n int := 0; promoted int := 0; shallow int := 0; failed int := 0;
  waiting int := 0; requeued int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('exp_sf_parse_tick_v2')) THEN
    RETURN jsonb_build_object('skipped','locked');
  END IF;

  FOR r IN
    SELECT f.fetch_id, f.stage_id, f.detail_url, f.request_id, f.requested_at
      FROM exp_etl_fetch f
     WHERE f.parsed = false AND f.request_id IS NOT NULL
     ORDER BY f.requested_at
     LIMIT p_limit
  LOOP
    v_status := NULL; v_body := NULL;
    SELECT status_code, content INTO v_status, v_body
      FROM net._http_response WHERE id = r.request_id;

    IF v_status IN (429, 503, 502, 500)
       OR (v_status IS NULL AND r.requested_at < now() - interval '10 minutes') THEN
      DELETE FROM exp_etl_fetch WHERE fetch_id = r.fetch_id;
      requeued := requeued + 1;
      CONTINUE;
    END IF;

    IF v_status IS NULL THEN waiting := waiting + 1; CONTINUE; END IF;

    IF v_status <> 200 THEN
      UPDATE exp_etl_fetch SET parsed = true, parsed_at = now(), http_status = v_status,
             note = 'source returned ' || v_status WHERE fetch_id = r.fetch_id;
      UPDATE exp_etl_staging SET resolution_status = 'needs_review' WHERE stage_id = r.stage_id;
      failed := failed + 1;
      CONTINUE;
    END IF;

    n := n + 1;
    v_f := public.exp_sf_parse(v_body, r.detail_url);

    IF (v_f->>'gate_passed')::boolean THEN
      PERFORM public.exp_sf_apply(r.detail_url, v_f);
      UPDATE exp_etl_staging
         SET field_tier = 'deep', resolution_status = 'created', resolved_at = now(),
             payload = coalesce(payload,'{}'::jsonb) || jsonb_build_object('deep', v_f)
       WHERE stage_id = r.stage_id;
      promoted := promoted + 1;
    ELSE
      UPDATE exp_etl_staging
         SET resolution_status = 'shallow',
             payload = coalesce(payload,'{}'::jsonb) || jsonb_build_object(
               'gate_passed', false, 'gate_reasons', v_f->'gate_reasons',
               'field_count', v_f->'field_count')
       WHERE stage_id = r.stage_id;
      shallow := shallow + 1;
    END IF;

    UPDATE exp_etl_fetch SET parsed = true, parsed_at = now(), http_status = 200
     WHERE fetch_id = r.fetch_id;
  END LOOP;

  RETURN jsonb_build_object('processed', n, 'promoted', promoted, 'shallow', shallow,
    'failed', failed, 'waiting', waiting, 'requeued', requeued);
END $fn$;

REVOKE ALL ON FUNCTION public.exp_sf_fetch_tick(int) FROM public;
REVOKE ALL ON FUNCTION public.exp_sf_parse_tick(int) FROM public;
GRANT EXECUTE ON FUNCTION public.exp_sf_fetch_tick(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.exp_sf_parse_tick(int) TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('sf-hydrate-fetch','sf-hydrate-parse');
SELECT cron.schedule('sf-hydrate-fetch', '* * * * *', $$SELECT public.exp_sf_fetch_tick(60)$$);
SELECT cron.schedule('sf-hydrate-parse', '* * * * *', $$SELECT public.exp_sf_parse_tick(300)$$);
