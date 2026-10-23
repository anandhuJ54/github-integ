INSERT INTO public.exp_category_schema (gcid, entity_type, schema_json, model, knowledge_updated_at)
SELECT 'gcid:mortgage_broker', 'both',
       (SELECT payload FROM public._stage_mortgage_proj WHERE chunk_id=1)::jsonb,
       'registry-projection-linted-v1', now()
ON CONFLICT (gcid) DO UPDATE SET
  schema_json = EXCLUDED.schema_json,
  entity_type = EXCLUDED.entity_type,
  model = EXCLUDED.model,
  knowledge_updated_at = now(),
  updated_at = now();
DROP TABLE public._stage_mortgage_proj;