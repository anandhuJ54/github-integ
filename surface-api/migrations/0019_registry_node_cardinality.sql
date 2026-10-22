-- PROPOSAL (category data change: requires sign-off by Scott / Abdul / Claude).
-- Adds per-node cardinality to the existing node registry so NORA's interview
-- knows how many of each fact to expect (one / few / many + expected range).
-- Additive and idempotent. No data backfill here: derived values live in
-- tools/category_brief/out/registry_node_cardinality.csv.gz (keyed by gcid +
-- node_slug) and are applied separately once reviewed.
-- Identity keys need no new column: they fill the existing
-- exp_category_shape.identity_keys (see tools/category_brief/out/category_identity_keys.json).

ALTER TABLE public.exp_vertical_node_registry
  ADD COLUMN IF NOT EXISTS cardinality text,
  ADD COLUMN IF NOT EXISTS expected_count_min integer,
  ADD COLUMN IF NOT EXISTS expected_count_max integer,
  ADD COLUMN IF NOT EXISTS cardinality_rule text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exp_vertical_node_registry_cardinality_check'
      AND conrelid = 'public.exp_vertical_node_registry'::regclass
  ) THEN
    ALTER TABLE public.exp_vertical_node_registry
      ADD CONSTRAINT exp_vertical_node_registry_cardinality_check
      CHECK (cardinality IS NULL OR cardinality IN ('one', 'few', 'many'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exp_vertical_node_registry_expected_count_check'
      AND conrelid = 'public.exp_vertical_node_registry'::regclass
  ) THEN
    ALTER TABLE public.exp_vertical_node_registry
      ADD CONSTRAINT exp_vertical_node_registry_expected_count_check
      CHECK (
        (expected_count_min IS NULL OR expected_count_min >= 0)
        AND (expected_count_max IS NULL OR expected_count_max >= 0)
        AND (expected_count_min IS NULL OR expected_count_max IS NULL OR expected_count_min <= expected_count_max)
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.exp_vertical_node_registry.cardinality IS
  'How many instances of this node one entity is expected to hold: one | few | many. Derived from schema.org property definitions + expected-volume tables (tools/category_brief).';
COMMENT ON COLUMN public.exp_vertical_node_registry.expected_count_min IS
  'Lower bound of expected instance count for this node (annual per entity for volume-stream nodes).';
COMMENT ON COLUMN public.exp_vertical_node_registry.expected_count_max IS
  'Upper bound of expected instance count for this node (annual per entity for volume-stream nodes).';
COMMENT ON COLUMN public.exp_vertical_node_registry.cardinality_rule IS
  'Provenance: derivation rule id that produced cardinality/expected_count (category_brief.v1).';
