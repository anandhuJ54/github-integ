-- Check-08 regression was CAUSED BY 016000 (my venue-attribute fix moved all 12 assigned
-- properties out of 'content', emptying the ring in the map). Truthful refill: subjectOf
-- ("a CreativeWork about this entity") is content semantics — it's the property press
-- mentions and video nodes ride in every pilot registry — and was misfiled under presence.
UPDATE exp_schema_type_ring_map SET ring_key='content' WHERE schema_property='subjectOf';
-- verify: 10 distinct rings again
SELECT count(DISTINCT ring_key) AS rings, count(*) AS rows FROM exp_schema_type_ring_map;
