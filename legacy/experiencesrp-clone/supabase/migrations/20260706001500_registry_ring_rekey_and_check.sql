-- Re-key legacy ring values -> canonical 10, then enforce strict CHECK.
-- (Old CHECK allowed only the 8 legacy names and blocked the 10-ring RE seed.)
UPDATE exp_vertical_node_registry SET ring = CASE ring
  WHEN 'core_identity'         THEN 'identity'
  WHEN 'profiles_presence'     THEN 'presence'
  WHEN 'verifiable_authority'  THEN 'authority'
  WHEN 'published_content'     THEN 'content'
  WHEN 'media_voice'           THEN 'content'        -- absorbed per locked model
  WHEN 'social_engagement'     THEN 'engagement'
  WHEN 'transactions_outcomes' THEN 'conversion'
  WHEN 'upstream_context'      THEN 'entity_graph'
  ELSE ring END
WHERE ring IN ('core_identity','profiles_presence','verifiable_authority','published_content',
               'media_voice','social_engagement','transactions_outcomes','upstream_context');

ALTER TABLE exp_vertical_node_registry
  DROP CONSTRAINT IF EXISTS exp_vertical_node_registry_ring_check;
ALTER TABLE exp_vertical_node_registry
  ADD CONSTRAINT exp_vertical_node_registry_ring_check
  CHECK (ring IN ('identity','presence','location','authority','services',
                  'content','reputation','engagement','conversion','entity_graph'));
