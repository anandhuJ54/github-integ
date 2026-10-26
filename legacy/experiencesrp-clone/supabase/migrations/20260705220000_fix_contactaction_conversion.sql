-- FIX: ContactAction (does not exist in schema.org) -> CommunicateAction across
-- conversion_actions JSONB. Affects 4,007 of 4,024 logic-layer rows — the Colab
-- batch predates the vocabulary gate. CommunicateAction verified in vendored
-- vocabulary (reference/schemaorg-current.jsonld) and present in Engagement ring.
UPDATE exp_category_knowledge
SET conversion_actions =
      replace(conversion_actions::text, '"ContactAction"', '"CommunicateAction"')::jsonb,
    updated_at = now()
WHERE conversion_actions::text LIKE '%ContactAction%';
