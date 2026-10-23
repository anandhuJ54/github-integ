-- Same defect class RE's reconciliation fixed: content nodes had author/mainEntity on
-- Person — the edge is backwards; the CreativeWork carries author -> Person (@id).
-- Caught by the projection generator's facet gate during the mortgage generality test.
UPDATE exp_vertical_node_registry SET schema_type='Article',
  notes='Edge reversed: the CreativeWork carries author -> Person (@id)'
WHERE gcid='gcid:mortgage_broker' AND schema_property='author';
UPDATE exp_vertical_node_registry SET schema_type='Answer', schema_property='author',
  notes='Q&A answers: Answer (CreativeWork) carries author -> Person (@id); mainEntity was invalid here'
WHERE gcid='gcid:mortgage_broker' AND schema_property='mainEntity';
UPDATE exp_vertical_node_registry SET schema_property='memberOf',
  notes='partnerOf does not exist in schema.org; lender-panel membership = memberOf'
WHERE gcid='gcid:mortgage_broker' AND schema_property='partnerOf';
