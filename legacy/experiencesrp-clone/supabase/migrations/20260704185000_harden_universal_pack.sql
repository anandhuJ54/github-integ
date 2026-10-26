-- Harden universal pack: add DISTINCT map / voice / nav discovery surfaces missing
-- from the pack. Deliberately NOT re-adding duplicates:
--   * Apple Business Connect already exists as directory_key 'apple_maps'
--   * Foursquare Places/Factual already exists as directory_key 'foursquare'
-- Voice assistants + nav providers largely INGEST from Google/Apple + the aggregators;
-- notes record the ingestion path. Unconfirmed push paths -> unverified (not scored yet).

INSERT INTO exp_directory_packs
  (directory_key, directory_name, canonical_domain, url_pattern, schema_type, schema_property, tier, pack_family, connection_method, verification_status, notes)
VALUES
('waze','Waze','waze.com',NULL,'LocalBusiness','sameAs',1,'universal','etl','verified','Google-owned nav; distinct destination, ingests from GBP'),
('here_maps','HERE Technologies','here.com',NULL,'LocalBusiness','sameAs',2,'universal','etl','verified','Map-data provider feeding many nav/auto systems'),
('amazon_alexa','Amazon Alexa local','alexa.amazon.com',NULL,'LocalBusiness','sameAs',2,'universal','etl','unverified','Voice: ingests from Yelp/aggregators; push path to-confirm'),
('apple_siri','Siri Suggestions','apple.com',NULL,'LocalBusiness','sameAs',2,'universal','manual','verified','Voice: ingests from Apple Business Connect (apple_maps)'),
('google_assistant','Google Assistant','google.com',NULL,'LocalBusiness','sameAs',2,'universal','oauth','verified','Voice: ingests from GBP (google_business_profile)'),
('tomtom','TomTom','tomtom.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','Nav-data provider; push path to-confirm')
ON CONFLICT (directory_key) DO NOTHING;
