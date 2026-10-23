-- Ring-map correction (external GPT review, adjudicated + class-audited): a bulk rule
-- misfiled venue/place attributes into 'content'. Venue attributes -> services; operational
-- facts (star class, check-in/out, room count) -> identity; tourBookingPage stays conversion;
-- publishingPrinciples (E-E-A-T trust) -> authority. Node data was already correct; this
-- fixes the map chips and all future map-driven projections.
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='amenityFeature' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='petsAllowed' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='smokingAllowed' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='publicAccess' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='availableLanguage' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='hasMenu' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='servesCuisine' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='menu' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='services' WHERE property='isAccessibleForFree' AND ring_key<>'services';
UPDATE exp_schema_type_ring_map SET ring_key='identity' WHERE property='starRating' AND ring_key<>'identity';
UPDATE exp_schema_type_ring_map SET ring_key='identity' WHERE property='checkinTime' AND ring_key<>'identity';
UPDATE exp_schema_type_ring_map SET ring_key='identity' WHERE property='checkoutTime' AND ring_key<>'identity';
UPDATE exp_schema_type_ring_map SET ring_key='identity' WHERE property='numberOfRooms' AND ring_key<>'identity';
UPDATE exp_schema_type_ring_map SET ring_key='conversion' WHERE property='tourBookingPage' AND ring_key<>'conversion';
UPDATE exp_schema_type_ring_map SET ring_key='authority' WHERE property='publishingPrinciples' AND ring_key<>'authority';

-- verify
SELECT property, ring_key, count(*) FROM exp_schema_type_ring_map
WHERE property IN ('amenityFeature','petsAllowed','smokingAllowed','publicAccess','availableLanguage',
 'hasMenu','servesCuisine','menu','isAccessibleForFree','starRating','checkinTime','checkoutTime',
 'numberOfRooms','tourBookingPage','publishingPrinciples')
GROUP BY 1,2 ORDER BY 1;
