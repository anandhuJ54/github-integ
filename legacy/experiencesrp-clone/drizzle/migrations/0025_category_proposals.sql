-- 0025 · Category proposals: the only write path for category data
-- (knowledge, registry, taxonomy, rings, scoring targets, compliance, directories).
--
-- Workflow: a detector or curator emits proposals (state 'pending') → a human reviews a
-- 10–20 row sample → exp_category_proposal_review() approves/rejects → exp_category_proposal_apply()
-- applies approved rows per gcid: exp_engine_snapshot(gcid) first, ops applied additively
-- (retire = is_active=false, never DELETE), one exp_curation_ledger row per op
-- (ruled_by = reviewer), exp_validate_category_full(gcid) must not regress, else that gcid's
-- changes roll back and its proposals are marked 'failed' with the error.
--
-- Additive + idempotent. RLS: read for control staff (super_admin/architect/analyst);
-- no direct writes for anyone but service_role; review/apply restricted to super_admin/architect.
-- Pattern follows disco_proposals (proposal rows + console read policy).

CREATE TABLE IF NOT EXISTS public.exp_category_proposals (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch         text        NOT NULL,
  gcid          text        NOT NULL REFERENCES public.gbp_categories(gcid),
  lane          text        NOT NULL CHECK (lane IN ('location','professional','shared','brand',
                                                     'score_priors','directories','knowledge','taxonomy')),
  target_table  text        NOT NULL,
  target_key    jsonb       NOT NULL,
  op            text        NOT NULL CHECK (op IN ('add','retire','rescope','relabel','merge','set')),
  payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  before        jsonb,
  rationale     text        NOT NULL,
  rule          text        NOT NULL,
  state         text        NOT NULL DEFAULT 'pending'
                            CHECK (state IN ('pending','approved','rejected','applied','failed','superseded')),
  created_by    text        NOT NULL DEFAULT 'claude',
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by   text,
  reviewed_at   timestamptz,
  review_note   text,
  applied_at    timestamptz,
  error         text
);

CREATE INDEX IF NOT EXISTS idx_exp_category_proposals_batch_state ON public.exp_category_proposals (batch, state);
CREATE INDEX IF NOT EXISTS idx_exp_category_proposals_gcid ON public.exp_category_proposals (gcid);
-- one open proposal per target row/element; makes proposal INSERT files idempotent
CREATE UNIQUE INDEX IF NOT EXISTS uq_exp_category_proposals_open_target
  ON public.exp_category_proposals (target_table, target_key)
  WHERE state IN ('pending','approved');

ALTER TABLE public.exp_category_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exp_category_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exp_category_proposals TO authenticated;
GRANT ALL ON public.exp_category_proposals TO service_role;
DROP POLICY IF EXISTS "staff read category proposals" ON public.exp_category_proposals;
CREATE POLICY "staff read category proposals" ON public.exp_category_proposals
  FOR SELECT TO authenticated
  USING (public.exp_ctrl_has_role(ARRAY['super_admin','architect','analyst']));

-- ---------------------------------------------------------------------------------------
-- Caller identity. Signed-in callers must hold super_admin/architect; the recorded actor is
-- their email. Sessions without a JWT user (service_role / SQL console, i.e. Claude acting
-- on a decision Scott gave in chat) must name the human: p_actor matching scott|abdul.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp__category_proposal_actor(p_actor text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_email text;
BEGIN
  IF v_uid IS NOT NULL THEN
    IF NOT public.exp_ctrl_has_role(ARRAY['super_admin','architect']) THEN
      RAISE EXCEPTION 'super_admin or architect required';
    END IF;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    RETURN coalesce(v_email, v_uid::text);
  END IF;
  IF p_actor IS NULL OR p_actor !~* '^(scott|abdul)\M' THEN
    RAISE EXCEPTION 'without a signed-in user, name the human reviewer (scott or abdul)';
  END IF;
  RETURN lower(p_actor);
END $function$;

-- ---------------------------------------------------------------------------------------
-- Review: approve or reject pending proposals, by batch and/or explicit ids.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_category_proposal_review(
  p_batch text, p_ids bigint[] DEFAULT NULL, p_approve boolean DEFAULT true,
  p_note text DEFAULT NULL, p_reviewer text DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_actor text; v_n integer;
BEGIN
  IF p_batch IS NULL AND p_ids IS NULL THEN RAISE EXCEPTION 'batch or ids required'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'approve must be true or false'; END IF;
  v_actor := public.exp__category_proposal_actor(p_reviewer);
  UPDATE public.exp_category_proposals cp
     SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = v_actor, reviewed_at = now(), review_note = p_note
   WHERE cp.state = 'pending'
     AND (p_batch IS NULL OR cp.batch = p_batch)
     AND (p_ids IS NULL OR cp.id = ANY(p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $function$;

-- ---------------------------------------------------------------------------------------
-- Apply one proposal (internal; no EXECUTE for API roles). Raises on anything unexpected,
-- including stale `before` values, so the caller's per-gcid block rolls back.
-- Supported now: retire (taxonomy/registry), relabel/rescope/set of whitelisted text columns
-- (taxonomy/registry), set of a jsonb path in whitelisted knowledge columns.
-- add/merge and other target tables raise 'not supported' (→ failed) until implemented.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp__category_proposal_apply_one(p public.exp_category_proposals)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_id uuid; v_cur jsonb; v_col text; v_path text[]; v_cols text[]; v_elem jsonb;
  c_tax text[] := ARRAY['term','term_display','term_slug','entity_scope','schema_type','schema_property','search_intent'];
  c_reg text[] := ARRAY['node_name','node_description','schema_type','schema_property','entity_scope','ring',
                        'owns_lane','node_class','connection_method'];
  c_kn  text[] := ARRAY['conversion_actions','value_props','search_intents','services','customer_journey',
                        'ranking_factors','expertise_signals'];
BEGIN
  IF p.target_table NOT IN ('exp_taxonomy','exp_vertical_node_registry','exp_category_knowledge') THEN
    RAISE EXCEPTION 'proposal %: target_table % not supported by apply', p.id, p.target_table;
  END IF;
  v_id := (p.target_key->>'id')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'proposal %: target_key.id required', p.id; END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', p.target_table)
     INTO v_cur USING v_id;
  IF v_cur IS NULL THEN RAISE EXCEPTION 'proposal %: target % not found', p.id, v_id; END IF;
  IF v_cur->>'gcid' IS DISTINCT FROM p.gcid THEN
    RAISE EXCEPTION 'proposal %: target gcid % <> proposal gcid %', p.id, v_cur->>'gcid', p.gcid;
  END IF;

  IF p.op = 'retire' THEN
    IF p.target_table = 'exp_category_knowledge' THEN
      RAISE EXCEPTION 'proposal %: knowledge rows have no is_active; use set', p.id;
    END IF;
    IF NOT coalesce((v_cur->>'is_active')::boolean, false) THEN
      RAISE EXCEPTION 'proposal %: target already retired', p.id;
    END IF;
    EXECUTE format('UPDATE public.%I SET is_active = false, updated_at = now() WHERE id = $1', p.target_table)
      USING v_id;

  ELSIF p.op IN ('relabel','rescope','set') AND p.target_table IN ('exp_taxonomy','exp_vertical_node_registry') THEN
    IF NOT coalesce((v_cur->>'is_active')::boolean, false) THEN
      RAISE EXCEPTION 'proposal %: target is retired', p.id;
    END IF;
    v_cols := CASE WHEN p.target_table = 'exp_taxonomy' THEN c_tax ELSE c_reg END;
    IF p.op = 'rescope' AND EXISTS (SELECT 1 FROM jsonb_object_keys(p.payload) k WHERE k <> 'entity_scope') THEN
      RAISE EXCEPTION 'proposal %: rescope may only change entity_scope', p.id;
    END IF;
    IF p.op = 'relabel' AND EXISTS (SELECT 1 FROM jsonb_object_keys(p.payload) k
                                   WHERE k NOT IN ('term','term_display','term_slug','node_name','node_description')) THEN
      RAISE EXCEPTION 'proposal %: relabel may only change labels', p.id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p.payload)) THEN
      RAISE EXCEPTION 'proposal %: empty payload', p.id;
    END IF;
    FOR v_col IN SELECT jsonb_object_keys(p.payload) LOOP
      IF NOT v_col = ANY(v_cols) THEN
        RAISE EXCEPTION 'proposal %: column % not settable on %', p.id, v_col, p.target_table;
      END IF;
      IF p.before IS NULL OR NOT p.before ? v_col THEN
        RAISE EXCEPTION 'proposal %: before.% required (stale-write guard)', p.id, v_col;
      END IF;
      IF (v_cur->v_col) IS DISTINCT FROM (p.before->v_col) THEN
        RAISE EXCEPTION 'proposal %: % changed since proposal (now %)', p.id, v_col, v_cur->v_col;
      END IF;
      EXECUTE format('UPDATE public.%I SET %I = $2, updated_at = now() WHERE id = $1', p.target_table, v_col)
        USING v_id, p.payload->>v_col;
    END LOOP;

  ELSIF p.op = 'set' AND p.target_table = 'exp_category_knowledge' THEN
    v_col := p.payload->>'column';
    IF v_col IS NULL OR NOT v_col = ANY(c_kn) THEN
      RAISE EXCEPTION 'proposal %: knowledge column % not settable', p.id, v_col;
    END IF;
    IF jsonb_typeof(p.payload->'path') <> 'array' OR jsonb_array_length(p.payload->'path') = 0
       OR NOT p.payload ? 'value' THEN
      RAISE EXCEPTION 'proposal %: payload needs path[] and value', p.id;
    END IF;
    v_path := ARRAY(SELECT jsonb_array_elements_text(p.payload->'path'));
    IF p.before IS NULL OR NOT p.before ? 'value' THEN
      RAISE EXCEPTION 'proposal %: before.value required (stale-write guard)', p.id;
    END IF;
    IF (v_cur->v_col #> v_path) IS DISTINCT FROM (p.before->'value') THEN
      RAISE EXCEPTION 'proposal %: %.% changed since proposal (now %)', p.id, v_col, v_path, v_cur->v_col #> v_path;
    END IF;
    IF p.before ? 'label' AND cardinality(v_path) > 1 THEN
      v_elem := v_cur->v_col #> v_path[1:cardinality(v_path) - 1];
      IF (v_elem->'label') IS DISTINCT FROM (p.before->'label') THEN
        RAISE EXCEPTION 'proposal %: element label changed since proposal', p.id;
      END IF;
    END IF;
    EXECUTE format('UPDATE public.exp_category_knowledge SET %I = jsonb_set(%I, $2, $3, false), updated_at = now() WHERE id = $1',
                   v_col, v_col)
      USING v_id, v_path, p.payload->'value';

  ELSE
    RAISE EXCEPTION 'proposal %: op % on % not supported by apply yet', p.id, p.op, p.target_table;
  END IF;
END $function$;

-- ---------------------------------------------------------------------------------------
-- Apply an approved batch, one gcid at a time, each gcid all-or-nothing.
-- p_max_gcids caps the gcids handled per call (large batches: call repeatedly; only rows
-- still 'approved' are picked up, so re-running is safe).
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_category_proposal_apply(p_batch text, p_max_gcids integer DEFAULT NULL)
 RETURNS TABLE(out_gcid text, out_state text, out_applied integer, out_detail text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_g text; v_p public.exp_category_proposals; v_before text[]; v_new text[]; v_n integer; v_err text;
BEGIN
  IF p_batch IS NULL THEN RAISE EXCEPTION 'batch required'; END IF;
  -- gate only: ledger attribution is each proposal's reviewer, not the caller
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.exp__category_proposal_actor(NULL);
  END IF;

  FOR v_g IN SELECT DISTINCT cp.gcid FROM public.exp_category_proposals cp
              WHERE cp.batch = p_batch AND cp.state = 'approved' ORDER BY 1 LIMIT p_max_gcids LOOP
    v_n := 0;
    BEGIN
      PERFORM public.exp_engine_snapshot(v_g);
      SELECT coalesce(array_agg(DISTINCT v.check_code), '{}') INTO v_before
        FROM public.exp_validate_category_full(v_g) v WHERE NOT v.passed;

      FOR v_p IN SELECT * FROM public.exp_category_proposals cp
                  WHERE cp.batch = p_batch AND cp.gcid = v_g AND cp.state = 'approved'
                  ORDER BY cp.id FOR UPDATE LOOP
        IF v_p.reviewed_by IS NULL THEN RAISE EXCEPTION 'proposal % has no reviewer', v_p.id; END IF;
        PERFORM public.exp__category_proposal_apply_one(v_p);
        INSERT INTO public.exp_curation_ledger (gcid, layer, action, target, rationale, ruled_by, batch)
        VALUES (v_g,
                CASE v_p.target_table WHEN 'exp_taxonomy' THEN 'taxonomy'
                                      WHEN 'exp_vertical_node_registry' THEN 'registry'
                                      WHEN 'exp_category_knowledge' THEN 'knowledge'
                                      ELSE v_p.target_table END,
                v_p.op,
                v_p.target_table || ' ' || v_p.target_key::text || ' ' || v_p.payload::text,
                v_p.rule || ': ' || v_p.rationale || ' (proposal ' || v_p.id || ')',
                v_p.reviewed_by,
                p_batch);
        v_n := v_n + 1;
      END LOOP;

      SELECT array_agg(DISTINCT v.check_code) INTO v_new
        FROM public.exp_validate_category_full(v_g) v
       WHERE NOT v.passed AND NOT (v.check_code = ANY(v_before));
      IF v_new IS NOT NULL THEN
        RAISE EXCEPTION 'validation regressed: %', array_to_string(v_new, ', ');
      END IF;

      UPDATE public.exp_category_proposals cp
         SET state = 'applied', applied_at = now(), error = NULL
       WHERE cp.batch = p_batch AND cp.gcid = v_g AND cp.state = 'approved';
      out_gcid := v_g; out_state := 'applied'; out_applied := v_n; out_detail := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      UPDATE public.exp_category_proposals cp
         SET state = 'failed', error = v_err
       WHERE cp.batch = p_batch AND cp.gcid = v_g AND cp.state = 'approved';
      out_gcid := v_g; out_state := 'failed'; out_applied := 0; out_detail := v_err;
      RETURN NEXT;
    END;
  END LOOP;
END $function$;

REVOKE ALL ON FUNCTION public.exp__category_proposal_actor(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exp__category_proposal_apply_one(public.exp_category_proposals) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exp_category_proposal_review(text, bigint[], boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exp_category_proposal_apply(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_category_proposal_review(text, bigint[], boolean, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp_category_proposal_apply(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exp__category_proposal_actor(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exp__category_proposal_apply_one(public.exp_category_proposals) TO service_role;
