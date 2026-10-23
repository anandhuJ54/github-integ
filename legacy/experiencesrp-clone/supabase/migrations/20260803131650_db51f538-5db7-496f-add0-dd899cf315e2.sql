-- Governed RPCs for the Category Population pipeline (console-driven, role-gated).

CREATE OR REPLACE FUNCTION public.exp_etl_activate_category(p_gcid text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_job uuid;
BEGIN
  IF NOT public.exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT job_id INTO v_job FROM public.exp_etl_jobs WHERE gcid = p_gcid LIMIT 1;

  IF v_job IS NULL THEN
    INSERT INTO public.exp_etl_jobs (gcid, phase, stage, status, active, last_run_at)
    VALUES (p_gcid, 'build', 'identify_companies', 'running', true, now())
    RETURNING job_id INTO v_job;
  ELSE
    UPDATE public.exp_etl_jobs
       SET stage = 'identify_companies', status = 'running', active = true, last_run_at = now()
     WHERE job_id = v_job;
  END IF;

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.exp_etl_approve_companies(p_gcid text, p_source_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_kept integer;
BEGIN
  IF NOT public.exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  UPDATE public.exp_etl_sources
     SET status = 'approved'
   WHERE gcid = p_gcid
     AND source_id = ANY(COALESCE(p_source_ids, ARRAY[]::uuid[]))
     AND status IN ('proposed','paused','approved');
  GET DIAGNOSTICS v_kept = ROW_COUNT;

  UPDATE public.exp_etl_sources
     SET status = 'paused'
   WHERE gcid = p_gcid
     AND role_in_discovery = 'hierarchy_source'
     AND NOT (source_id = ANY(COALESCE(p_source_ids, ARRAY[]::uuid[])))
     AND status IN ('proposed','approved','active');

  UPDATE public.exp_etl_jobs
     SET stage = 'method_split', status = 'running', active = true, last_run_at = now()
   WHERE gcid = p_gcid;

  RETURN v_kept;
END;
$$;

CREATE OR REPLACE FUNCTION public.exp_etl_run_source(p_source uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_run uuid; v_method text; v_gcid text;
BEGIN
  IF NOT public.exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT crawl_method, gcid INTO v_method, v_gcid
    FROM public.exp_etl_sources WHERE source_id = p_source;

  IF v_method IS DISTINCT FROM 'server_crawl' THEN
    RAISE EXCEPTION 'source_not_runnable: crawl_method=%', COALESCE(v_method,'unknown');
  END IF;

  UPDATE public.exp_etl_sources SET status = 'active' WHERE source_id = p_source;

  INSERT INTO public.exp_etl_runs (source_id, started_at, detail)
  VALUES (p_source, now(), jsonb_build_object('trigger','console','gcid',v_gcid))
  RETURNING run_id INTO v_run;

  UPDATE public.exp_etl_jobs
     SET stage = 'harvest', status = 'running', active = true, last_run_at = now()
   WHERE gcid = v_gcid;

  RETURN v_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.exp_etl_finish_run(p_run uuid, p_errors integer DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  UPDATE public.exp_etl_runs
     SET finished_at = now(),
         errors = COALESCE(p_errors, 0)
   WHERE run_id = p_run AND finished_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.exp_etl_activate_category(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_etl_approve_companies(text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_etl_run_source(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exp_etl_finish_run(uuid, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.exp_etl_activate_category(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_etl_approve_companies(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_etl_run_source(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exp_etl_finish_run(uuid, integer) TO authenticated;
