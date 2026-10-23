-- ============================================================
-- SEED: Cannabis Dispensary vertical (gcid:cannabis_store)
-- Layer 1: Knowledge model | Layer 2: Taxonomy
-- Layer 3: Node registry   | Layer 4: Compliance
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_unique_gcid_level_slug
  ON exp_taxonomy (gcid, level, term_slug);

-- 1. Category classification
UPDATE gbp_categories
SET entity_type = 'location',
    priority_tier = 1,
    supports_single_pro_office = FALSE,
    status = 'active'
WHERE gcid = 'gcid:cannabis_store';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:cannabis_store', 'location', 'professional', 'active',
  ARRAY['THC', 'CBD', 'indica', 'sativa', 'hybrid', 'terpene', 'cannabinoid', 'flower', 'concentrate', 'edible', 'tincture', 'vape', 'pre-roll', 'live resin', 'rosin', 'RSO', 'CBD:THC ratio', 'microdose', 'tolerance', 'entourage effect', 'couch lock', 'uplifting', 'dispensary', 'budtender', 'medical card', 'adult-use', 'recreational', 'delivery', 'METRC', 'seed-to-sale', 'compliance'],
  '["Adult-use cannabis sales","Medical cannabis (where applicable)","Cannabis delivery (where licensed)","Product consultations","New patient / new customer education","Loyalty program","Online ordering (pickup)","Curbside pickup","Cannabis accessories","CBD products","Edibles and beverages","Pre-rolls and flower","Concentrates and vaporizers"]'::jsonb,
  ARRAY['Age verification required (21+ for adult-use, 18+ medical with card)', 'State cannabis license required', 'No advertising to minors', 'No marketing claims about health benefits (FDA/FTC rules)', 'METRC seed-to-sale tracking compliance', 'No interstate sales or shipping', 'Local zoning compliance', 'No consumption on premises (most states)', 'No false potency claims', 'Social equity compliance (some states)'],
  '["New to cannabis / medical need / recreational interest","Searching for dispensary near me (Leafly / Weedmaps)","Age verification and ID check (in-store or online)","Budtender consultation / menu browse","Product selection and purchase","Education on use and dosing","Return visit / loyalty program"]'::jsonb,
  '{"primary":["Leafly and Weedmaps star rating","Product selection and menu freshness","Loyalty program","Verified license (publicly visible)","Staff knowledge and reviews"],"secondary":["Delivery availability","Online ordering","Location and hours","Social equity / community programs","Pricing and deals"]}'::jsonb,
  ARRAY['knowledgeable staff', 'great selection', 'clean and welcoming', 'helped me find the right product', 'no judgment', 'loyalty rewards are great', 'fast pickup', 'best deals in town', 'answered all my questions', 'my go-to dispensary'],
  ARRAY['Indica vs sativa vs hybrid — what''s the difference?', 'How to choose your first cannabis product', 'CBD vs THC explained', 'Microdosing cannabis — a beginner''s guide', 'Cannabis for sleep — what works?', 'Terpenes and the entourage effect', 'What is live resin?', 'Edibles dosing guide — start low and go slow', 'How to get a medical cannabis card', 'Cannabis and anxiety — what to know', 'Vaping vs smoking — what''s safer?', 'Cannabis delivery — how it works in your state', 'How to read a cannabis lab report', 'Best cannabis products for pain relief', 'Cannabis loyalty programs — how to maximize rewards'],
  '{"primary":["State cannabis license in good standing","Verified Leafly / Weedmaps listing","Product lab testing (COA)","Staff training certifications"],"secondary":["Social equity certification","Medical program participation","Award-winning products","Community involvement"]}'::jsonb,
  '{"profile_completeness":0.18,"review_volume":0.27,"license_verified":0.17,"menu_freshness":0.15,"content_freshness":0.12,"schema_completeness":0.11}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true,"compliance":"age_gate_21","tone":"welcoming"},"review_responder":{"enabled":true,"vocabulary":"cannabis"},"content_assistant":{"enabled":true,"topics":["product education","dosing guides","cannabis basics"]},"qa_assistant":{"enabled":true,"age_gate":true}}'::jsonb,
  60, FALSE
)
ON CONFLICT (gcid) DO UPDATE SET
  entity_type=EXCLUDED.entity_type, pricing_tier=EXCLUDED.pricing_tier,
  status=EXCLUDED.status, terminology=EXCLUDED.terminology,
  services=EXCLUDED.services, compliance_rules=EXCLUDED.compliance_rules,
  customer_journey=EXCLUDED.customer_journey, ranking_factors=EXCLUDED.ranking_factors,
  review_vocabulary=EXCLUDED.review_vocabulary, content_topics=EXCLUDED.content_topics,
  expertise_signals=EXCLUDED.expertise_signals, scoring_weights=EXCLUDED.scoring_weights,
  ai_agents=EXCLUDED.ai_agents, knowledge_pct=EXCLUDED.knowledge_pct,
  updated_at=NOW();

-- 3. Compliance
INSERT INTO exp_category_compliance
  (gcid, display_license_on_profile, display_license_on_content,
   display_license_on_ads, display_license_on_email,
   license_display_format, license_label,
   required_disclaimers, content_restrictions, prohibited_phrases,
   age_gate_required, hipaa_applies, glba_applies,
   regulated_by, compliance_notes)
VALUES (
  'gcid:cannabis_store',
  TRUE, TRUE,
  TRUE, FALSE,
  'License #{license_number}', 'State Cannabis License',
  ARRAY['State Cannabis License #{license_number} | [State] Licensed Retailer', 'For adults 21+ (or 18+ medical patients with valid card) only', 'Cannabis products have not been evaluated by the FDA for safety or efficacy', 'Keep all cannabis products away from children and pets', 'Do not drive or operate heavy machinery after consuming cannabis'],
  ARRAY['no medical or health claims (FDA/FTC rules)', 'no advertising to minors', 'no potency exaggeration', 'must include 21+ age gate on all digital content', 'no interstate shipping or sales'],
  ARRAY['cures cancer', 'treats anxiety disorder', 'FDA approved', 'safe for children', 'legal everywhere', 'medically proven cannabis', 'drive after using'],
  TRUE, FALSE, FALSE,
  ARRAY['State Cannabis Control Board / Department', 'Local municipality (zoning, licensing)', 'METRC (seed-to-sale)', 'FTC (advertising)', 'FDA (no health claims for cannabis)'],
  'Cannabis is Schedule I federally — no banking, no interstate commerce, no FDA-approved health claims. All advertising must include 21+ age gate. State-specific rules govern delivery, medical vs adult-use, hours, packaging, and potency labeling. METRC compliance is mandatory for seed-to-sale tracking. No claims that cannabis treats, cures, or prevents any medical condition.'
)
ON CONFLICT (gcid) DO UPDATE SET
  display_license_on_profile=EXCLUDED.display_license_on_profile,
  display_license_on_content=EXCLUDED.display_license_on_content,
  display_license_on_ads=EXCLUDED.display_license_on_ads,
  license_display_format=EXCLUDED.license_display_format,
  license_label=EXCLUDED.license_label,
  required_disclaimers=EXCLUDED.required_disclaimers,
  content_restrictions=EXCLUDED.content_restrictions,
  prohibited_phrases=EXCLUDED.prohibited_phrases,
  regulated_by=EXCLUDED.regulated_by,
  compliance_notes=EXCLUDED.compliance_notes,
  updated_at=NOW();

-- 4. Vertical node registry (8 rings)
INSERT INTO exp_vertical_node_registry
  (gcid, node_name, node_slug, ring, connection_method, schema_type, schema_property,
   required_for_score, score_points, priority, url_pattern, compliance_notes)
VALUES
('gcid:cannabis_store','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:cannabis_store','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:cannabis_store','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:cannabis_store','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:cannabis_store','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:cannabis_store','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:cannabis_store','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:cannabis_store','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:cannabis_store','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:cannabis_store','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:cannabis_store','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:cannabis_store','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:cannabis_store','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:cannabis_store','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:cannabis_store','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:cannabis_store','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:cannabis_store','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:cannabis_store','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:cannabis_store','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:cannabis_store','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:cannabis_store','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:cannabis_store','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:cannabis_store','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:cannabis_store','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:cannabis_store','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:cannabis_store','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:cannabis_store','State cannabis retail license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'State cannabis control board — mandatory'),
('gcid:cannabis_store','Local municipal permit','auth_local_permit','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',TRUE,60,1,NULL,'City/county zoning and operating permit'),
('gcid:cannabis_store','METRC compliance','auth_metrc','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,60,1,NULL,'Seed-to-sale tracking compliance'),
('gcid:cannabis_store','Leafly dispensary profile','profile_leafly','profiles_presence','etl','LocalBusiness','sameAs',TRUE,90,1,'leafly.com/dispensary-info/{id}','#1 cannabis discovery platform'),
('gcid:cannabis_store','Weedmaps listing','profile_weedmaps','profiles_presence','etl','LocalBusiness','sameAs',TRUE,80,1,'weedmaps.com/dispensaries/{id}','Leading dispensary directory'),
('gcid:cannabis_store','iHeartJane menu','profile_iheartjane','profiles_presence','etl','LocalBusiness','sameAs',FALSE,50,2,'iheartjane.com/dispensaries/{id}','Real-time menu and ordering platform'),
('gcid:cannabis_store','Dutchie online ordering','profile_dutchie','profiles_presence','etl','LocalBusiness','sameAs',FALSE,50,2,'dutchie.com','POS and online ordering integration'),
('gcid:cannabis_store','Yelp dispensary listing','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,40,3,'yelp.com/biz/{slug}',NULL),
('gcid:cannabis_store','Age gate verification','social_age_gate','social_engagement','platform','Thing','accessibilityFeature',TRUE,50,1,NULL,'21+ verification on all digital channels — required'),
('gcid:cannabis_store','Leafly reviews','social_leafly_reviews','social_engagement','etl','Review','review',TRUE,60,1,NULL,'Primary review source for cannabis'),
('gcid:cannabis_store','Weedmaps reviews','social_weedmaps_reviews','social_engagement','etl','Review','review',FALSE,40,2,NULL,NULL),
('gcid:cannabis_store','Loyalty program','social_loyalty','social_engagement','platform','LoyaltyPoints','offers',FALSE,30,2,NULL,'Strong retention and repeat visit driver'),
('gcid:cannabis_store','Live menu (products in stock)','txn_live_menu','transactions_outcomes','api','Product','offers',TRUE,60,1,NULL,'Real-time menu via Dutchie/Jane/BLAZE API'),
('gcid:cannabis_store','Delivery zone (if licensed)','txn_delivery','transactions_outcomes','manual','Service','areaServed',FALSE,40,1,NULL,'State-specific delivery licensing required'),
('gcid:cannabis_store','Product categories carried','txn_categories','transactions_outcomes','manual','Product','category',FALSE,30,2,NULL,'Flower, edibles, concentrates, vapes, topicals, etc.'),
('gcid:cannabis_store','Lab-tested products (COA)','txn_lab_testing','transactions_outcomes','manual','Product','additionalProperty',FALSE,40,1,NULL,'Certificate of Analysis — potency and contaminant testing')
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:cannabis_store','profession_title','Cannabis Dispensary','cannabis-dispensary','Cannabis Dispensary','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','profession_title','Marijuana Dispensary','marijuana-dispensary','Marijuana Dispensary','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','profession_title','Recreational Dispensary','recreational-dispensary','Recreational Dispensary','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','profession_title','Medical Dispensary','medical-dispensary','Medical Dispensary','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','profession_title','Cannabis Retailer','cannabis-retailer','Cannabis Retailer','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','specialization','Adult-Use (Recreational)','adult-use','Adult-Use (Recreational)','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','specialization','Medical Cannabis','medical-cannabis','Medical Cannabis','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','specialization','Cannabis Delivery','cannabis-delivery','Cannabis Delivery','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','specialization','Craft / Boutique Cannabis','craft-cannabis','Craft / Boutique Cannabis','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','specialization','CBD & Low-THC Products','cbd-low-thc','CBD & Low-THC Products','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','product_service','Cannabis Flower','cannabis-flower','Cannabis Flower','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','product_service','Edibles & Beverages','edibles-beverages','Edibles & Beverages','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','product_service','Concentrates','concentrates-svc','Concentrates','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','product_service','Vaporizers','vaporizers-svc','Vaporizers','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','product_service','Pre-Rolls','pre-rolls-svc','Pre-Rolls','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','product_service','Tinctures & Topicals','tinctures-topicals','Tinctures & Topicals','claude_generated',6,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','topic','Indica vs Sativa vs Hybrid','indica-sativa-hybrid','Indica vs Sativa vs Hybrid','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','topic','Edibles Dosing Guide — Start Low and Go Slow','edibles-dosing','Edibles Dosing Guide','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','topic','CBD vs THC Explained','cbd-vs-thc','CBD vs THC Explained','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','topic','Microdosing Cannabis — A Beginner''s Guide','microdosing-cannabis','Microdosing Cannabis — A Beginner''s Guide','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','tag','21+ only','21-plus','21+ Only','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','tag','online ordering','online-ordering-cannabis','Online Ordering','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','tag','delivery available','delivery-cannabis','Delivery Available','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','tag','medical patients welcome','medical-patients','Medical Patients Welcome','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','keyword','dispensary near me','dispensary-near-me','Dispensary near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:cannabis_store','keyword','cannabis dispensary near me','cannabis-dispensary-near-me','Cannabis dispensary near me','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:cannabis_store','keyword','marijuana dispensary near me','marijuana-dispensary-near-me','Marijuana dispensary near me','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:cannabis_store','question','Is cannabis legal in [state]?','cannabis-legal-state','Is cannabis legal in [state]?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','question','What is the difference between indica and sativa?','indica-vs-sativa-q','What is the difference between indica and sativa?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:cannabis_store','question','How do edibles work and how long do they take?','edibles-how-work','How do edibles work and how long do they take?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
