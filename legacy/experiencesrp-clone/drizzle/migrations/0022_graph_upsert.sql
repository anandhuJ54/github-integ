-- 0022_graph_upsert.sql — governed graph upsert + owner-fact firewall on graph_nodes.
--
-- ONE connected system: extracted facts land in graph_nodes (no parallel store).
-- Additive and idempotent: two nullable columns, one partial unique index, three
-- helper/trigger functions, one SECURITY DEFINER writer. No data is rewritten.
--
--  * trust_tier  — provenance tier per fact (directive §5: self_declared | imported |
--                  platform_observed | authority_verified, plus owner_verified).
--                  NULL on legacy rows (= unknown; ranks below every tier).
--  * value_hash  — md5 of the normalised value; with (entity, node_registry_id or
--                  node_type) it is the idempotency key of exp_graph_upsert_nodes.
--                  Legacy ETL rows keep NULL and are untouched by the index.
--  * Firewall    — rows whose source is 'user'/'oauth' or whose trust_tier is
--                  'owner_verified' are owner facts: DELETEs and fact-column UPDATEs
--                  that do not come through exp_graph_upsert_nodes are skipped
--                  (scoring columns stay writable). This is what keeps the ETL
--                  writers (exp_sf_nodalize, etl-deep-hydrate replaceEtlNodes —
--                  DELETE source='etl' + reinsert) from ever wiping them. Mirrors
--                  exp_etl_guard_claimed on exp_entity.
--  * Compatible with trg_graph_nodes_ring_autofill: the writer passes ring_key only
--    when exp_ring knows it, otherwise leaves it NULL for the autofill trigger.

-- 1. Columns -------------------------------------------------------------------
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS trust_tier text;
ALTER TABLE public.graph_nodes ADD COLUMN IF NOT EXISTS value_hash text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'graph_nodes_trust_tier_check' AND conrelid = 'public.graph_nodes'::regclass
  ) THEN
    ALTER TABLE public.graph_nodes ADD CONSTRAINT graph_nodes_trust_tier_check CHECK (
      trust_tier IS NULL OR trust_tier IN
        ('self_declared', 'imported', 'platform_observed', 'authority_verified', 'owner_verified')
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS graph_nodes_upsert_key
  ON public.graph_nodes (entity_type, entity_id, (coalesce(node_registry_id::text, node_type)), value_hash)
  WHERE value_hash IS NOT NULL;

COMMENT ON COLUMN public.graph_nodes.trust_tier IS
  'Provenance tier: self_declared | imported | platform_observed | authority_verified | owner_verified. NULL = legacy/unknown.';
COMMENT ON COLUMN public.graph_nodes.value_hash IS
  'md5(lower(squashed value)) — idempotency key for exp_graph_upsert_nodes.';

-- 2. Helpers -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_trust_rank(p_trust text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_trust
    WHEN 'self_declared' THEN 1
    WHEN 'imported' THEN 2
    WHEN 'platform_observed' THEN 3
    WHEN 'authority_verified' THEN 4
    WHEN 'owner_verified' THEN 5
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.exp_graph_node_is_protected(p_source text, p_trust text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_source IN ('user', 'oauth'), false) OR coalesce(p_trust = 'owner_verified', false)
$$;

-- 3. Owner-fact firewall ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exp_graph_nodes_owner_firewall()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.exp_graph_node_is_protected(OLD.source, OLD.trust_tier)
     -- The governed writer (and only it) may change owner facts — never on an ETL run.
     OR (coalesce(current_setting('exp.graph_governed', true), '') = 'on'
         AND coalesce(current_setting('exp.actor', true), '') <> 'etl') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND (
       NEW.entity_type, NEW.entity_id, NEW.node_type, NEW.node_registry_id, NEW.title, NEW.url,
       NEW.raw_data, NEW.extracted_data, NEW.schema_type, NEW.schema_property, NEW.source,
       NEW.source_id, NEW.source_url, NEW.fetched_at, NEW.verified, NEW.verified_at,
       NEW.verified_by, NEW.is_active, NEW.trust_tier, NEW.value_hash
     ) IS NOT DISTINCT FROM (
       OLD.entity_type, OLD.entity_id, OLD.node_type, OLD.node_registry_id, OLD.title, OLD.url,
       OLD.raw_data, OLD.extracted_data, OLD.schema_type, OLD.schema_property, OLD.source,
       OLD.source_id, OLD.source_url, OLD.fetched_at, OLD.verified, OLD.verified_at,
       OLD.verified_by, OLD.is_active, OLD.trust_tier, OLD.value_hash
     ) THEN
    RETURN NEW; -- scoring / ring / refresh columns only: allowed
  END IF;
  -- Skip (not raise) so bulk ETL DELETE+reinsert batches keep running around owner facts.
  RAISE NOTICE 'OWNER FIREWALL: % of owner fact % (source %, trust %) skipped',
    TG_OP, OLD.id, OLD.source, OLD.trust_tier;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_graph_nodes_owner_firewall ON public.graph_nodes;
CREATE TRIGGER trg_graph_nodes_owner_firewall
  BEFORE UPDATE OR DELETE ON public.graph_nodes
  FOR EACH ROW EXECUTE FUNCTION public.exp_graph_nodes_owner_firewall();

-- 4. Governed upsert ---------------------------------------------------------------
-- p_nodes: jsonb array of ProposedNode-shaped objects (src/lib/nora/extract/types.ts):
--   { value, title, node_type, schema_property, schema_type?, ring?, registry_node_id? |
--     (gcid + registry_node_slug)?, url?, source_id?, source_url?, fetched_at?,
--     extracted_data?, raw_data?, evidence?, confidence?, method?, is_active? }
-- Idempotent on (entity, node_registry_id or node_type, value_hash). A write never
-- lowers trust: an existing row with a higher trust_tier is kept as is.
CREATE OR REPLACE FUNCTION public.exp_graph_upsert_nodes(
  p_entity_type text,
  p_entity_id uuid,
  p_nodes jsonb,
  p_source text,
  p_trust text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_service boolean := coalesce(auth.role(), '') = 'service_role' OR session_user = 'postgres';
  v_admin boolean := false;
  v_verified boolean := p_trust IN ('owner_verified', 'authority_verified');
  n jsonb;
  v_value text;
  v_type text;
  v_reg uuid;
  v_ring_key text;
  v_ring smallint;
  v_hash text;
  v_id uuid;
  v_ins boolean;
  v_inserted int := 0;
  v_updated int := 0;
  v_kept int := 0;
  v_skipped int := 0;
  v_ids uuid[] := '{}';
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF p_entity_type NOT IN ('professional', 'organization') OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'entity must be a professional or organization id';
  END IF;
  IF p_source NOT IN ('oauth', 'etl', 'crm_sync', 'api', 'manual', 'rss', 'platform', 'user') THEN
    RAISE EXCEPTION 'unknown source %', p_source;
  END IF;
  IF public.exp_trust_rank(p_trust) = 0 THEN
    RAISE EXCEPTION 'unknown trust tier %', p_trust;
  END IF;
  IF jsonb_typeof(coalesce(p_nodes, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_nodes must be a json array';
  END IF;

  -- Authorization: service role, platform admins, or the entity's owner.
  IF NOT v_service THEN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
    v_admin := public.exp_ctrl_has_role(ARRAY['super_admin', 'architect']);
    IF NOT v_admin AND NOT (
      (p_entity_type = 'professional' AND EXISTS (
        SELECT 1 FROM professionals p WHERE p.id = p_entity_id AND p.user_id = v_uid))
      OR (p_entity_type = 'organization' AND EXISTS (
        SELECT 1 FROM professional_org_memberships m
        JOIN professionals p ON p.id = m.professional_id
        WHERE m.org_id = p_entity_id AND p.user_id = v_uid
          AND (m.end_date IS NULL OR m.end_date >= current_date)))
    ) THEN
      RAISE EXCEPTION 'Not allowed to write graph facts for % %', p_entity_type, p_entity_id;
    END IF;
    -- Owners speak for themselves; only the platform asserts observed/authority/import tiers.
    IF NOT v_admin AND p_trust NOT IN ('self_declared', 'owner_verified') THEN
      RAISE EXCEPTION 'trust tier % requires a platform caller', p_trust;
    END IF;
    IF NOT v_admin AND p_source = 'etl' THEN
      RAISE EXCEPTION 'source etl requires a platform caller';
    END IF;
  END IF;

  PERFORM set_config('exp.graph_governed', 'on', true);

  FOR n IN SELECT value FROM jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) LOOP
    v_value := nullif(btrim(coalesce(n->>'value', n->>'title', '')), '');
    v_type := nullif(btrim(coalesce(n->>'node_type', '')), '');
    IF v_value IS NULL OR v_type IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_reg := NULL;
    IF coalesce(n->>'registry_node_id', '') ~ uuid_re THEN
      SELECT r.id INTO v_reg FROM exp_vertical_node_registry r WHERE r.id = (n->>'registry_node_id')::uuid;
    ELSIF nullif(n->>'registry_node_slug', '') IS NOT NULL AND nullif(n->>'gcid', '') IS NOT NULL THEN
      SELECT r.id INTO v_reg FROM exp_vertical_node_registry r
      WHERE r.gcid = n->>'gcid' AND r.node_slug = n->>'registry_node_slug' AND r.is_active
      LIMIT 1;
    END IF;

    -- Ring: keep the brief's ring only when exp_ring knows it; else let autofill decide.
    SELECT r.ring_key, CASE WHEN r.sort BETWEEN 0 AND 9 THEN r.sort ELSE 0 END
      INTO v_ring_key, v_ring
      FROM exp_ring r WHERE r.ring_key = n->>'ring';
    v_ring := coalesce(v_ring, 0);

    v_hash := md5(lower(regexp_replace(v_value, '\s+', ' ', 'g')));

    INSERT INTO graph_nodes AS g (
      entity_type, entity_id, ring, ring_key, node_type, node_registry_id, title, url,
      raw_data, extracted_data, schema_type, schema_property, source, source_id, source_url,
      fetched_at, verified, verified_at, verified_by, is_active, trust_tier, value_hash
    ) VALUES (
      p_entity_type, p_entity_id, v_ring, v_ring_key, v_type, v_reg,
      left(coalesce(nullif(n->>'title', ''), v_value), 500),
      coalesce(nullif(n->>'url', ''), CASE WHEN v_value ~* '^https?://' THEN v_value END),
      coalesce(n->'raw_data', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'evidence', n->'evidence', 'confidence', n->'confidence', 'method', n->'method',
        'written_by', coalesce(v_uid::text, 'service_role'))),
      coalesce(n->'extracted_data', '{}'::jsonb) || jsonb_build_object('value', v_value),
      nullif(n->>'schema_type', ''), nullif(n->>'schema_property', ''),
      p_source, nullif(n->>'source_id', ''), nullif(n->>'source_url', ''),
      CASE WHEN coalesce(n->>'fetched_at', '') <> '' THEN (n->>'fetched_at')::timestamptz ELSE now() END,
      v_verified, CASE WHEN v_verified THEN now() END,
      CASE WHEN p_trust = 'owner_verified' THEN 'owner:' || coalesce(v_uid::text, 'service_role')
           WHEN v_verified THEN coalesce(v_uid::text, 'service_role') END,
      coalesce((n->>'is_active')::boolean, true), p_trust, v_hash
    )
    ON CONFLICT (entity_type, entity_id, (coalesce(node_registry_id::text, node_type)), value_hash)
      WHERE value_hash IS NOT NULL
    DO UPDATE SET
      ring_key = coalesce(EXCLUDED.ring_key, g.ring_key),
      title = EXCLUDED.title,
      url = coalesce(EXCLUDED.url, g.url),
      raw_data = coalesce(g.raw_data, '{}'::jsonb) || EXCLUDED.raw_data,
      extracted_data = coalesce(g.extracted_data, '{}'::jsonb) || EXCLUDED.extracted_data,
      schema_type = coalesce(EXCLUDED.schema_type, g.schema_type),
      schema_property = coalesce(EXCLUDED.schema_property, g.schema_property),
      source = EXCLUDED.source,
      source_id = coalesce(EXCLUDED.source_id, g.source_id),
      source_url = coalesce(EXCLUDED.source_url, g.source_url),
      fetched_at = EXCLUDED.fetched_at,
      verified = g.verified OR EXCLUDED.verified,
      verified_at = CASE WHEN EXCLUDED.verified THEN EXCLUDED.verified_at ELSE g.verified_at END,
      verified_by = CASE WHEN EXCLUDED.verified THEN EXCLUDED.verified_by ELSE g.verified_by END,
      is_active = EXCLUDED.is_active,
      trust_tier = EXCLUDED.trust_tier,
      updated_at = now()
    WHERE public.exp_trust_rank(EXCLUDED.trust_tier) >= public.exp_trust_rank(g.trust_tier)
    RETURNING g.id, (g.xmax = 0) INTO v_id, v_ins;

    IF v_id IS NULL THEN
      v_kept := v_kept + 1; -- an existing fact with higher trust wins
    ELSE
      v_ids := v_ids || v_id;
      IF v_ins THEN v_inserted := v_inserted + 1; ELSE v_updated := v_updated + 1; END IF;
    END IF;
    v_id := NULL;
  END LOOP;

  PERFORM set_config('exp.graph_governed', 'off', true);

  RETURN jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'kept', v_kept, 'skipped', v_skipped,
    'ids', to_jsonb(v_ids), 'trust_tier', p_trust, 'source', p_source);
END $$;

REVOKE ALL ON FUNCTION public.exp_graph_upsert_nodes(text, uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exp_graph_upsert_nodes(text, uuid, jsonb, text, text) TO authenticated, service_role;
