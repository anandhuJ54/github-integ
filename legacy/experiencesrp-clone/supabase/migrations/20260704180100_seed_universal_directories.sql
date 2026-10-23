-- Seed: universal citation network (pack_family = 'universal'), applied to ALL categories.
-- Tier 1 = majors everyone verifies; Tier 2 = data aggregators + strong generalists;
-- Tier 3 = general long-tail directories. verified = stands as a real, well-established
-- citation site; unverified = real-but-URL/coverage not confirmed here (expand later).
-- This is intentionally NOT full Yext-parity yet; the tail is marked to-expand.

INSERT INTO exp_directory_packs
  (directory_key, directory_name, canonical_domain, url_pattern, schema_type, schema_property, tier, pack_family, connection_method, verification_status, notes)
VALUES
-- Tier 1 — majors
('google_business_profile','Google Business Profile','google.com','google.com/maps?cid={id}','LocalBusiness','sameAs',1,'universal','oauth','verified','Primary local listing'),
('apple_maps','Apple Business Connect','apple.com','maps.apple.com/place?auid={id}','LocalBusiness','sameAs',1,'universal','manual','verified',NULL),
('bing_places','Bing Places','bing.com','bing.com/maps','LocalBusiness','sameAs',1,'universal','manual','verified',NULL),
('facebook','Facebook Page','facebook.com','facebook.com/{id}','Organization','sameAs',1,'universal','oauth','verified',NULL),
('yelp','Yelp','yelp.com','yelp.com/biz/{id}','LocalBusiness','sameAs',1,'universal','etl','verified',NULL),
-- Tier 2 — aggregators + strong generalists
('foursquare','Foursquare','foursquare.com','foursquare.com/v/{id}','LocalBusiness','sameAs',2,'universal','api','verified','Data aggregator, feeds many downstream'),
('data_axle','Data Axle','data-axle.com',NULL,'LocalBusiness','sameAs',2,'universal','etl','verified','Aggregator (formerly Infogroup)'),
('localeze','Neustar Localeze','neustarlocaleze.biz',NULL,'LocalBusiness','sameAs',2,'universal','etl','verified','Aggregator'),
('yellow_pages','Yellow Pages','yellowpages.com','yellowpages.com/{id}','LocalBusiness','sameAs',2,'universal','etl','verified',NULL),
('better_business_bureau','Better Business Bureau','bbb.org','bbb.org/us/{id}','Organization','sameAs',2,'universal','manual','verified',NULL),
('nextdoor','Nextdoor','nextdoor.com','nextdoor.com/pages/{id}','LocalBusiness','sameAs',2,'universal','manual','verified',NULL),
('manta','Manta','manta.com','manta.com/c/{id}','Organization','sameAs',2,'universal','etl','verified',NULL),
('trustpilot','Trustpilot','trustpilot.com','trustpilot.com/review/{id}','Organization','sameAs',2,'universal','etl','verified',NULL),
('mapquest','MapQuest','mapquest.com',NULL,'LocalBusiness','sameAs',2,'universal','etl','verified',NULL),
-- Tier 3 — general long tail (real, common; URL patterns to confirm -> unverified)
('superpages','Superpages','superpages.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm URL pattern'),
('citysearch','Citysearch','citysearch.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('hotfrog','Hotfrog','hotfrog.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('brownbook','Brownbook','brownbook.net',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('ezlocal','EZlocal','ezlocal.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('chamberofcommerce','ChamberofCommerce.com','chamberofcommerce.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('elocal','eLocal','elocal.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('cylex','Cylex','cylex.us.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('n49','n49','n49.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('showmelocal','ShowMeLocal','showmelocal.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm')
ON CONFLICT (directory_key) DO NOTHING;
