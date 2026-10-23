ALTER TABLE exp_vertical_node_registry
  DROP CONSTRAINT IF EXISTS exp_vertical_node_registry_ring_check;

UPDATE exp_vertical_node_registry SET ring = CASE ring
  WHEN 'core_identity'         THEN 'identity'
  WHEN 'profiles_presence'     THEN 'presence'
  WHEN 'verifiable_authority'  THEN 'authority'
  WHEN 'published_content'     THEN 'content'
  WHEN 'media_voice'           THEN 'content'
  WHEN 'social_engagement'     THEN 'engagement'
  WHEN 'transactions_outcomes' THEN 'conversion'
  WHEN 'upstream_context'      THEN 'entity_graph'
  ELSE ring END
WHERE ring IN ('core_identity','profiles_presence','verifiable_authority','published_content',
               'media_voice','social_engagement','transactions_outcomes','upstream_context');

ALTER TABLE exp_vertical_node_registry
  ADD CONSTRAINT exp_vertical_node_registry_ring_check
  CHECK (ring IN ('identity','presence','location','authority','services',
                  'content','reputation','engagement','conversion','entity_graph'));