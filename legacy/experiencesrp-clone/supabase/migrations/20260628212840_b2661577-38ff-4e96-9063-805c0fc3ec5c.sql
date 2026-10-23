
-- Unique key needed for schema_cache upsert by (entity_type, entity_id, page_type)
CREATE UNIQUE INDEX IF NOT EXISTS schema_cache_entity_page_key
  ON public.schema_cache (entity_type, entity_id, page_type);

-- Invalidate cached schema whenever a graph_node for the same entity changes.
CREATE OR REPLACE FUNCTION public.invalidate_schema_cache_on_graph_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity_type text;
  v_entity_id   uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_entity_type := OLD.entity_type;
    v_entity_id   := OLD.entity_id;
  ELSE
    v_entity_type := NEW.entity_type;
    v_entity_id   := NEW.entity_id;
  END IF;

  UPDATE public.schema_cache
     SET is_valid = false,
         invalidated_at = now()
   WHERE entity_type = v_entity_type
     AND entity_id   = v_entity_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_schema_cache ON public.graph_nodes;
CREATE TRIGGER trg_invalidate_schema_cache
AFTER INSERT OR UPDATE OR DELETE ON public.graph_nodes
FOR EACH ROW EXECUTE FUNCTION public.invalidate_schema_cache_on_graph_change();
