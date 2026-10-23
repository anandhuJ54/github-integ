-- Linter catch (per-hop dotted-path rule, new): validFrom/validUntil are INVALID on
-- EducationalOccupationalCredential. EOC < CreativeWork -> expires (Date) and dateCreated.
UPDATE exp_vertical_node_registry
SET schema_property='hasCredential.expires',
    notes='License expiry via expires (EOC<CreativeWork); validUntil invalid on EOC (rule#9)'
WHERE gcid='gcid:real_estate_agents' AND node_slug='license_expiration_date';
UPDATE exp_vertical_node_registry
SET schema_property='hasCredential.dateCreated',
    notes='First-licensed date via dateCreated; validFrom invalid on EOC (rule#9)'
WHERE gcid='gcid:real_estate_agents' AND node_slug='year_first_licensed';
