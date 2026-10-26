-- Scott's catch: "why would hotels have a person entity" — three defect sources fixed.

-- (a) pediatric_dentist was entity_type='location' in KM — a practitioner category.
--     Its Person-faceted rows (ABPD cert, residency) are LEGITIMATE; the entity_type was wrong.
UPDATE exp_category_knowledge SET entity_type='both' WHERE gcid='gcid:pediatric_dentist';

-- (b) True location entities (hotel, family_restaurant, church) must carry NO Person facet.
--     Model-emitted staff/clergy rows re-faceted to the business/Organization side:
UPDATE exp_vertical_node_registry SET schema_type='FoodEstablishment', schema_property='employee',
  notes=trim(notes||' [location entity: staff ride employee edges, no Person facet]')
WHERE gcid='gcid:family_restaurant' AND schema_type='Person'
  AND (node_name ILIKE '%chef%' OR node_name ILIKE '%manager%' OR node_name ILIKE '%owner%');
UPDATE exp_vertical_node_registry SET schema_type='FoodEstablishment', schema_property='hasCredential.expires',
  notes=trim(notes||' [staff certification held at establishment level]')
WHERE gcid='gcid:family_restaurant' AND schema_type='Person' AND node_name ILIKE '%servsafe%';
UPDATE exp_vertical_node_registry SET schema_type='Organization',
  schema_property=CASE WHEN node_name ILIKE '%pastor%' THEN 'employee'
                       WHEN node_name ILIKE '%denominational affiliation%' THEN 'memberOf'
                       WHEN node_name ILIKE '%credential%' OR node_name ILIKE '%ordination%'
                         OR node_name ILIKE '%endorsement%' THEN 'hasCredential'
                       ELSE 'description' END,
  notes=trim(notes||' [location entity: Organization facet carries org/staff facts]')
WHERE gcid='gcid:church' AND schema_type='Person';

-- (c) My expert-pass partner UPDATE ignored entity_type: on location entities the
--     partner edge is memberOf on the business (affiliation is Person-only).
UPDATE exp_vertical_node_registry SET
  schema_type=CASE gcid WHEN 'gcid:hotel' THEN 'Hotel' WHEN 'gcid:family_restaurant' THEN 'FoodEstablishment'
                        WHEN 'gcid:church' THEN 'Organization' END,
  schema_property='memberOf',
  notes=trim(notes||' [location entity: partner networks via memberOf]')
WHERE gcid IN ('gcid:hotel','gcid:family_restaurant','gcid:church')
  AND schema_type='Person' AND schema_property='affiliation';

-- Dedupe: church rows now colliding with the expert-pass Senior Pastor / denomination nodes
DELETE FROM exp_vertical_node_registry a USING exp_vertical_node_registry b
WHERE a.gcid='gcid:church' AND b.gcid='gcid:church' AND a.id>b.id
  AND a.schema_property=b.schema_property AND a.schema_property IN ('employee','memberOf')
  AND a.ring=b.ring;
