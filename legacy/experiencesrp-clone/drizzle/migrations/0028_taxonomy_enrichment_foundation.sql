-- 0028 · Taxonomy enrichment foundation (approved by Scott, 2026-10-15)
--
-- What this does
--   1) Four ADDITIVE columns on exp_taxonomy: concept_slug (one concept shared across lanes),
--      volume_source, volume_as_of, evidence (jsonb: reason codes, merge pointers, local-pack flag, modifiers).
--   2) Extends exp__category_proposal_apply_one so the proposal path can finally do the enrichment job:
--        add     upsert on the existing natural key uq_taxonomy_term (gcid, level, term_slug):
--                  new row -> insert; active row -> idempotent metadata update; retired row -> reactivate
--        merge   retire the loser, point it at the survivor (evidence.merged_into), remap content_items.topic_ids
--        set     now also covers search_volume_monthly, validated, priority, is_required, concept_slug,
--                volume_source, volume_as_of, evidence (typed casts; the stale-write guard still applies)
--        retire  accepts payload.reason (stored in evidence); refuses if published content still references the row
--      A "move" between lanes is an add in the new lane plus a retire in the old one (no new op needed).
--   3) Nothing is deleted. Writes still flow only through exp_category_proposal_apply
--      (snapshot -> ops -> ledger row per op -> validator must not regress, else that gcid rolls back).
--
-- Unchanged: relabel/rescope rules, knowledge 'set', registry behaviour, the apply wrapper, review function.
-- Additive and re-runnable.

ALTER TABLE public.exp_taxonomy
  ADD COLUMN IF NOT EXISTS concept_slug  text,
  ADD COLUMN IF NOT EXISTS volume_source text,
  ADD COLUMN IF NOT EXISTS volume_as_of  date,
  ADD COLUMN IF NOT EXISTS evidence      jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_exp_taxonomy_concept
  ON public.exp_taxonomy (gcid, concept_slug) WHERE concept_slug IS NOT NULL;

COMMENT ON COLUMN public.exp_taxonomy.concept_slug  IS 'Shared across lanes: one real-world concept (e.g. va_home_loan) that plays several roles (product, keyword, topic, tag, question, title).';
COMMENT ON COLUMN public.exp_taxonomy.volume_source IS 'Where search_volume_monthly came from (e.g. dataforseo_google_ads, dataforseo_clickstream); NULL when no volume.';
COMMENT ON COLUMN public.exp_taxonomy.volume_as_of  IS 'Date the volume was measured; drives the refresh schedule.';
COMMENT ON COLUMN public.exp_taxonomy.evidence      IS 'Audit trail for the row: reason codes, merged_into, retired_reason, local_pack, modifiers, sources.';

CREATE OR REPLACE FUNCTION public.exp__category_proposal_apply_one(p exp_category_proposals)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_cur jsonb; v_col text; v_path text[]; v_cols text[]; v_elem jsonb;
  v_type text; v_into uuid; v_surv jsonb; v_ex public.exp_taxonomy;
  v_level text; v_slug text; v_new uuid; v_key text;
  c_tax text[] := ARRAY['term','term_display','term_slug','entity_scope','schema_type','schema_property','search_intent'];
  c_tax_meta text[] := ARRAY['search_volume_monthly','validated','priority','is_required','concept_slug','volume_source',
                             'volume_as_of','evidence','description','wikidata_id','parent_id',
                             'use_srp','use_voce','use_search','use_agents','use_schema'];
  c_add text[] := ARRAY['level','term','term_display','term_slug','entity_scope','source','search_intent','schema_type','schema_property',
                        'search_volume_monthly','validated','priority','is_required','concept_slug','volume_source','volume_as_of','evidence',
                        'description','wikidata_id','parent_id','use_srp','use_voce','use_search','use_agents','use_schema'];
  c_reg text[] := ARRAY['node_name','node_description','schema_type','schema_property','entity_scope','ring',
                        'owns_lane','node_class','connection_method'];
  c_kn  text[] := ARRAY['conversion_actions','value_props','search_intents','services','customer_journey',
                        'ranking_factors','expertise_signals'];
BEGIN
  -- ADD: upsert on the natural key (gcid, level, term_slug). Taxonomy only.
  IF p.op = 'add' THEN
    IF p.target_table <> 'exp_taxonomy' THEN
      RAISE EXCEPTION 'proposal %: add is supported on exp_taxonomy only (got %)', p.id, p.target_table;
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p.payload) LOOP
      IF NOT v_key = ANY(c_add) THEN RAISE EXCEPTION 'proposal %: add payload key % not allowed', p.id, v_key; END IF;
    END LOOP;
    v_level := p.payload->>'level'; v_slug := p.payload->>'term_slug';
    IF v_level IS NULL OR v_slug IS NULL OR p.payload->>'term' IS NULL OR p.payload->>'source' IS NULL THEN
      RAISE EXCEPTION 'proposal %: add needs level, term, term_slug and source (provenance)', p.id;
    END IF;
    IF coalesce(p.payload->>'entity_scope','shared') NOT IN ('location','professional','shared') THEN
      RAISE EXCEPTION 'proposal %: bad entity_scope %', p.id, p.payload->>'entity_scope';
    END IF;
    SELECT * INTO v_ex FROM public.exp_taxonomy t
      WHERE t.gcid = p.gcid AND t.level = v_level AND t.term_slug = v_slug FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.exp_taxonomy (gcid, level, term, term_display, term_slug, entity_scope, source, search_intent,
             schema_type, schema_property, search_volume_monthly, validated, priority, is_required, concept_slug,
             volume_source, volume_as_of, evidence, description, wikidata_id, parent_id, is_active,
             use_srp, use_voce, use_search, use_agents, use_schema)
      VALUES (p.gcid, v_level, p.payload->>'term', coalesce(p.payload->>'term_display', p.payload->>'term'), v_slug,
             coalesce(p.payload->>'entity_scope','shared'), p.payload->>'source', p.payload->>'search_intent',
             p.payload->>'schema_type', p.payload->>'schema_property',
             (p.payload->>'search_volume_monthly')::integer, coalesce((p.payload->>'validated')::boolean, false),
             coalesce((p.payload->>'priority')::smallint, 5), coalesce((p.payload->>'is_required')::boolean, false),
             p.payload->>'concept_slug', p.payload->>'volume_source', (p.payload->>'volume_as_of')::date,
             coalesce((p.payload->'evidence'), '{}'::jsonb) || jsonb_build_object('added_batch', p.batch),
             p.payload->>'description', p.payload->>'wikidata_id', (p.payload->>'parent_id')::uuid, true,
             coalesce((p.payload->>'use_srp')::boolean, true), coalesce((p.payload->>'use_voce')::boolean, true),
             coalesce((p.payload->>'use_search')::boolean, true), coalesce((p.payload->>'use_agents')::boolean, true),
             coalesce((p.payload->>'use_schema')::boolean, true));
    ELSE
      -- existing row: never rewrite its wording; refresh metadata only, and reactivate if it was retired
      IF NOT coalesce(v_ex.is_active, false) THEN
        UPDATE public.exp_taxonomy SET is_active = true, updated_at = now(),
               evidence = coalesce(evidence,'{}'::jsonb) || jsonb_build_object('reactivated_batch', p.batch)
         WHERE id = v_ex.id;
      END IF;
      FOREACH v_col IN ARRAY c_tax_meta LOOP
        IF p.payload ? v_col AND p.payload->v_col <> 'null'::jsonb THEN
          IF v_col = 'evidence' THEN
            UPDATE public.exp_taxonomy SET evidence = coalesce(evidence,'{}'::jsonb) || (p.payload->'evidence'), updated_at = now() WHERE id = v_ex.id;
          ELSE
            SELECT format_type(a.atttypid, a.atttypmod) INTO v_type FROM pg_attribute a
             WHERE a.attrelid = 'public.exp_taxonomy'::regclass AND a.attname = v_col AND NOT a.attisdropped;
            EXECUTE format('UPDATE public.exp_taxonomy SET %I = $2::%s, updated_at = now() WHERE id = $1', v_col, v_type)
              USING v_ex.id, p.payload->>v_col;
          END IF;
        END IF;
      END LOOP;
    END IF;
    RETURN;
  END IF;

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
    IF p.target_table = 'exp_taxonomy' THEN
      IF EXISTS (SELECT 1 FROM public.content_items ci WHERE ci.topic_ids @> ARRAY[v_id]) THEN
        RAISE EXCEPTION 'proposal %: row is referenced by published content; merge it into a survivor instead of retiring', p.id;
      END IF;
      UPDATE public.exp_taxonomy SET is_active = false, updated_at = now(),
             evidence = coalesce(evidence,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
                          'retired_reason', p.payload->>'reason', 'retired_batch', p.batch))
       WHERE id = v_id;
    ELSE
      EXECUTE format('UPDATE public.%I SET is_active = false, updated_at = now() WHERE id = $1', p.target_table)
        USING v_id;
    END IF;

  ELSIF p.op = 'merge' THEN
    IF p.target_table <> 'exp_taxonomy' THEN
      RAISE EXCEPTION 'proposal %: merge is supported on exp_taxonomy only', p.id;
    END IF;
    v_into := (p.payload->>'into')::uuid;
    IF v_into IS NULL OR v_into = v_id THEN RAISE EXCEPTION 'proposal %: merge needs payload.into (a different row)', p.id; END IF;
    IF NOT coalesce((v_cur->>'is_active')::boolean, false) THEN
      RAISE EXCEPTION 'proposal %: merge target already retired', p.id;
    END IF;
    SELECT to_jsonb(t) INTO v_surv FROM public.exp_taxonomy t WHERE t.id = v_into FOR UPDATE;
    IF v_surv IS NULL THEN RAISE EXCEPTION 'proposal %: survivor % not found', p.id, v_into; END IF;
    IF v_surv->>'gcid' IS DISTINCT FROM p.gcid OR v_surv->>'level' IS DISTINCT FROM v_cur->>'level'
       OR NOT coalesce((v_surv->>'is_active')::boolean, false) THEN
      RAISE EXCEPTION 'proposal %: survivor must be active, same category and same lane', p.id;
    END IF;
    UPDATE public.content_items SET topic_ids = array_replace(topic_ids, v_id, v_into) WHERE topic_ids @> ARRAY[v_id];
    UPDATE public.exp_taxonomy SET is_active = false, updated_at = now(),
           evidence = coalesce(evidence,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
                        'merged_into', v_into, 'retired_reason', coalesce(p.payload->>'reason','merged'), 'retired_batch', p.batch))
     WHERE id = v_id;

  ELSIF p.op IN ('relabel','rescope','set') AND p.target_table IN ('exp_taxonomy','exp_vertical_node_registry') THEN
    IF NOT coalesce((v_cur->>'is_active')::boolean, false) THEN
      RAISE EXCEPTION 'proposal %: target is retired', p.id;
    END IF;
    v_cols := CASE WHEN p.target_table = 'exp_taxonomy' THEN
                CASE WHEN p.op = 'set' THEN c_tax || c_tax_meta ELSE c_tax END
              ELSE c_reg END;
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
      SELECT format_type(a.atttypid, a.atttypmod) INTO v_type FROM pg_attribute a
       WHERE a.attrelid = format('public.%I', p.target_table)::regclass AND a.attname = v_col AND NOT a.attisdropped;
      EXECUTE format('UPDATE public.%I SET %I = $2::%s, updated_at = now() WHERE id = $1', p.target_table, v_col, v_type)
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
