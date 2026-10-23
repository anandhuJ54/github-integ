-- Per-hop gauntlet catch (batch pilot round 4): credentialId DOES NOT EXIST in schema.org.
-- Both exemplar registries carried hasCredential.credentialId (generated under root-only
-- linting). Correct slot: identifier (Thing). Rule #10.
UPDATE exp_vertical_node_registry
SET schema_property = replace(schema_property, '.credentialId', '.identifier'),
    notes = trim(notes || ' [rule#10: credentialId does not exist; identifier]')
WHERE schema_property LIKE '%.credentialId%';