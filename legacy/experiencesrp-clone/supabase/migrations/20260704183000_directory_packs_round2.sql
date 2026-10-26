-- Catalog corrections + additions (round 2):
--  1. Add Experience.com as UNIVERSAL Tier 1 (our own platform, on every category).
--  2. Remove the duplicate 'Expertise.com' row (same entity as Experience.com per Scott).
--  3. Add four missing families grounded in KM mining: financial, real_estate,
--     insurance, veterinary. Several rows double as authority/credential sources
--     (NMLS, FINRA BrokerCheck, FDIC, AAHA).
-- NOTE (category integrity): the node-registry template was seeded to
-- 'gcid:mortgage_broker' which does NOT exist in the category master; the real
-- category is 'gcid:mortgage_lender'. Template must be re-keyed when the registry
-- is built. Flagged, not fixed here.

-- 1. Experience.com — universal Tier 1, platform-connected, verified (ours)
INSERT INTO exp_directory_packs
  (directory_key, directory_name, canonical_domain, url_pattern, schema_type, schema_property, tier, pack_family, connection_method, verification_status, notes)
VALUES
('experience_com','Experience.com','experience.com','experience.com/pro/{id}','ProfilePage','sameAs',1,'universal','platform','verified','Own platform home node — present on every category')
ON CONFLICT (directory_key) DO NOTHING;

-- 2. Remove the duplicate external row (consolidated into Experience.com)
DELETE FROM exp_directory_packs WHERE directory_key = 'expertise_com';

-- 3. Add the four missing families
INSERT INTO exp_directory_packs
  (directory_key, directory_name, canonical_domain, url_pattern, schema_type, schema_property, tier, pack_family, connection_method, verification_status, notes)
VALUES
('bankrate','Bankrate','bankrate.com',NULL,'WebSite','sameAs',2,'financial','etl','verified','Rates/lender listings'),
('nerdwallet','NerdWallet','nerdwallet.com',NULL,'WebSite','sameAs',2,'financial','etl','verified',NULL),
('lendingtree','LendingTree','lendingtree.com',NULL,'WebSite','sameAs',2,'financial','etl','verified','Mortgage marketplace'),
('zillow_mortgage','Zillow Mortgage','zillow.com',NULL,'WebSite','sameAs',2,'financial','etl','verified','Mortgage lender profiles'),
('nmls_consumer_access','NMLS Consumer Access','nmlsconsumeraccess.org','nmlsconsumeraccess.org/EntityDetails.aspx/{id}','WebSite','sameAs',2,'financial','etl','verified','Authority: mortgage license registry'),
('finra_brokercheck','FINRA BrokerCheck','brokercheck.finra.org','brokercheck.finra.org/individual/summary/{id}','WebSite','sameAs',2,'financial','etl','verified','Authority: advisor/broker registry'),
('cfp_board','CFP Board Find a Planner','letsmakeaplan.org',NULL,'WebSite','sameAs',3,'financial','etl','verified','Certified financial planners'),
('napfa','NAPFA Advisor Directory','napfa.org',NULL,'WebSite','sameAs',3,'financial','etl','verified','Fee-only advisors'),
('wiseradvisor','WiserAdvisor','wiseradvisor.com',NULL,'WebSite','sameAs',3,'financial','etl','verified',NULL),
('fdic_bankfind','FDIC BankFind','banks.data.fdic.gov',NULL,'WebSite','sameAs',3,'financial','etl','verified','Authority: bank registry'),
('zillow','Zillow','zillow.com','zillow.com/profile/{id}','WebSite','sameAs',2,'real_estate','etl','verified',NULL),
('realtor_com','Realtor.com','realtor.com','realtor.com/realestateagents/{id}','WebSite','sameAs',2,'real_estate','etl','verified',NULL),
('redfin','Redfin','redfin.com',NULL,'WebSite','sameAs',2,'real_estate','etl','verified',NULL),
('homes_com','Homes.com','homes.com',NULL,'WebSite','sameAs',3,'real_estate','etl','verified',NULL),
('costar','CoStar','costar.com',NULL,'WebSite','sameAs',3,'real_estate','etl','verified','Commercial RE'),
('biggerpockets','BiggerPockets','biggerpockets.com',NULL,'WebSite','sameAs',3,'real_estate','etl','unverified','to-confirm listing model'),
('policygenius','Policygenius','policygenius.com',NULL,'WebSite','sameAs',2,'insurance','etl','verified',NULL),
('iiaba','IIABA Agent Locator','independentagent.com',NULL,'WebSite','sameAs',3,'insurance','etl','verified','Independent agents'),
('insurify','Insurify','insurify.com',NULL,'WebSite','sameAs',3,'insurance','etl','verified',NULL),
('insurance_com','Insurance.com Agent Directory','insurance.com',NULL,'WebSite','sameAs',3,'insurance','etl','unverified','to-confirm'),
('insureon','Insureon Marketplace','insureon.com',NULL,'WebSite','sameAs',3,'insurance','etl','unverified','to-confirm'),
('aaha','AAHA Hospital Locator','aaha.org','aaha.org/your-pet/pet-owner-education/find-an-aaha-hospital/{id}','WebSite','sameAs',2,'veterinary','etl','verified','Accredited animal hospitals'),
('petmd','PetMD Vet Finder','petmd.com',NULL,'WebSite','sameAs',3,'veterinary','etl','verified',NULL),
('pawlicy','Pawlicy Advisor','pawlicy.com',NULL,'WebSite','sameAs',3,'veterinary','etl','unverified','to-confirm')
ON CONFLICT (directory_key) DO NOTHING;
