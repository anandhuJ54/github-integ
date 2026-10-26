-- ============================================================
-- SEED: Real Estate Agent vertical (gcid:real_estate_agents)
-- Vertical #2 — follows the Mortgage Loan Officer playbook structure exactly.
-- Idempotent: safe to run multiple times.
-- Run in Lovable against Supabase (same way the Mortgage vertical was loaded).
-- ============================================================

-- Ensure taxonomy upserts work even if the stub table lacks the unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_unique_gcid_level_slug
  ON exp_taxonomy (gcid, level, term_slug);

-- ------------------------------------------------------------
-- 1. Category row (already a stub from earlier import) — set classification
-- ------------------------------------------------------------
UPDATE gbp_categories
SET entity_type = 'both',
    priority_tier = 1,
    supports_single_pro_office = TRUE,   -- "Harlow Realty — Jane Harlow" single-pro case
    status = 'active'
WHERE gcid = 'gcid:real_estate_agents';

-- ------------------------------------------------------------
-- 2. Knowledge model
-- ------------------------------------------------------------
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:real_estate_agents', 'both', 'professional', 'active',
  ARRAY['MLS','listing','buyer agent','seller agent','listing agent','dual agency',
        'comps','CMA','escrow','earnest money','contingency','closing','days on market',
        'list-to-sale ratio','fiduciary duty','Fair Housing','disclosure','contingency removal',
        'pre-approval','offer','counteroffer','appraisal','title','pending','under contract'],
  '["Buyer representation","Seller representation","Listing & marketing","Comparative Market Analysis (CMA)","Home valuation","Relocation services","Investment property advisory","First-time buyer guidance","Luxury property sales","New construction representation","Short sale / REO","Property staging coordination"]'::jsonb,
  ARRAY['Fair Housing Act compliance','State real estate license display','No guarantee of sale price or timeline',
        'NAR Code of Ethics (members)','RESPA (referral fees / kickbacks)','Brokerage name in advertising','No steering'],
  '["Researching the market","Choosing an agent","Touring homes / listing prep","Offer & negotiation","Under contract / escrow","Closing & beyond"]'::jsonb,
  '["Recent transaction volume in market","Local review recency and rating","Neighborhood-specific content","MLS / Zillow / Realtor.com presence","Response time","Hyper-local authority signals"]'::jsonb,
  ARRAY['knew the neighborhood','negotiated a great price','responsive and communicative','smooth closing',
        'made it stress-free','sold above asking','found us the perfect home','honest and trustworthy',
        'went above and beyond','expert local knowledge'],
  ARRAY['Moving to [City]: Complete Neighborhood Guide','First-Time Homebuyer Guide','How to Price Your Home to Sell',
        'Best Neighborhoods in [City] for Families','[City] Real Estate Market Update','Buyer vs Seller Markets Explained',
        'What to Expect at Closing','Staging Tips That Sell','School Districts and Home Values in [City]',
        'How Much Is My Home Worth?'],
  '["State real estate license","REALTOR (NAR) membership","Designations (CRS, ABR, GRI, SRES)","Transaction volume","Years in market","Local board membership"]'::jsonb,
  '{"profile_completeness":0.18,"review_volume":0.25,"listing_coverage":0.17,"content_freshness":0.15,"schema_completeness":0.13,"ai_visibility":0.12}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"friendly","compliance":"Fair Housing"},"receptionist":{"enabled":false},"review_responder":{"enabled":true,"vocabulary":"real_estate"},"content_assistant":{"enabled":true,"topics":["neighborhoods","market updates","buying","selling"]},"listing_optimizer":{"enabled":true,"directories":["zillow","realtor_com","gbp"]},"qa_assistant":{"enabled":true}}'::jsonb,
  60, FALSE
)
ON CONFLICT (gcid) DO UPDATE SET
  entity_type = EXCLUDED.entity_type,
  pricing_tier = EXCLUDED.pricing_tier,
  status = EXCLUDED.status,
  terminology = EXCLUDED.terminology,
  services = EXCLUDED.services,
  compliance_rules = EXCLUDED.compliance_rules,
  customer_journey = EXCLUDED.customer_journey,
  ranking_factors = EXCLUDED.ranking_factors,
  review_vocabulary = EXCLUDED.review_vocabulary,
  content_topics = EXCLUDED.content_topics,
  expertise_signals = EXCLUDED.expertise_signals,
  scoring_weights = EXCLUDED.scoring_weights,
  ai_agents = EXCLUDED.ai_agents,
  knowledge_pct = EXCLUDED.knowledge_pct,
  updated_at = NOW();

-- ------------------------------------------------------------
-- 3. Compliance (row exists from earlier seed) — refine with Fair Housing
-- ------------------------------------------------------------
INSERT INTO exp_category_compliance
  (gcid, display_license_on_profile, display_license_on_content, display_license_on_ads, display_license_on_email,
   license_display_format, license_label,
   required_disclaimers, content_restrictions, prohibited_phrases,
   age_gate_required, hipaa_applies, glba_applies,
   regulated_by, compliance_notes)
VALUES (
  'gcid:real_estate_agents', TRUE, TRUE, TRUE, FALSE,
  'RE License #{license_number}', 'RE License',
  ARRAY['Licensed Real Estate Agent | #{license_number}','Equal Housing Opportunity'],
  ARRAY['no price or sale guarantees','no steering by protected class','Fair Housing compliant','brokerage name required in ads'],
  ARRAY['guaranteed sale','guaranteed price','risk-free investment','safe neighborhood','good schools for [demographic]','family-friendly area (as steering)'],
  FALSE, FALSE, FALSE,
  ARRAY['NAR','State Real Estate Commission','HUD (Fair Housing)'],
  'Fair Housing is the dominant constraint: AI content and replies must avoid any language that could steer by race, religion, familial status, national origin, disability, or other protected class. Brokerage name must appear in advertising per most state rules.'
)
ON CONFLICT (gcid) DO UPDATE SET
  display_license_on_profile = EXCLUDED.display_license_on_profile,
  display_license_on_content = EXCLUDED.display_license_on_content,
  display_license_on_ads = EXCLUDED.display_license_on_ads,
  license_display_format = EXCLUDED.license_display_format,
  license_label = EXCLUDED.license_label,
  required_disclaimers = EXCLUDED.required_disclaimers,
  content_restrictions = EXCLUDED.content_restrictions,
  prohibited_phrases = EXCLUDED.prohibited_phrases,
  regulated_by = EXCLUDED.regulated_by,
  compliance_notes = EXCLUDED.compliance_notes,
  updated_at = NOW();

-- ------------------------------------------------------------
-- 4. Vertical Node Registry — 8 rings
-- ------------------------------------------------------------
INSERT INTO exp_vertical_node_registry
  (gcid, node_name, node_slug, ring, connection_method, schema_type, schema_property,
   required_for_score, score_points, priority, url_pattern, compliance_notes)
VALUES
-- Ring 0: core_identity
('gcid:real_estate_agents','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,'Name must match license registration'),
('gcid:real_estate_agents','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,'No guarantees of sale price/timeline; Fair Housing compliant'),
('gcid:real_estate_agents','Real estate license number','core_license','core_identity','manual','Person','identifier',TRUE,50,1,NULL,'Primary license identifier; format varies by state'),
('gcid:real_estate_agents','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:real_estate_agents','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:real_estate_agents','Brokerage affiliation','core_brokerage','core_identity','manual','Organization','worksFor',TRUE,20,2,NULL,'License operates under the broker; brokerage name required in ads'),
-- Ring 1: verifiable_authority
('gcid:real_estate_agents','State license verification','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'Verified against state commission lookup'),
('gcid:real_estate_agents','REALTOR / NAR membership','auth_nar','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,30,2,NULL,'Only NAR members may use the REALTOR mark'),
('gcid:real_estate_agents','Designations (CRS, ABR, GRI, SRES)','auth_designations','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,20,3,NULL,NULL),
('gcid:real_estate_agents','Years of experience','auth_experience','verifiable_authority','manual','Person','description',FALSE,10,5,NULL,NULL),
('gcid:real_estate_agents','Local board / association membership','auth_local_board','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,10,4,NULL,NULL),
('gcid:real_estate_agents','Awards / recognition','auth_awards','verifiable_authority','manual','Person','award',FALSE,15,4,NULL,NULL),
-- Ring 2: profiles_presence
('gcid:real_estate_agents','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:real_estate_agents','Zillow Premier Agent','profile_zillow','profiles_presence','etl','Person','sameAs',TRUE,60,1,'zillow.com/profile/{id}',NULL),
('gcid:real_estate_agents','Realtor.com profile','profile_realtor_com','profiles_presence','etl','Person','sameAs',TRUE,50,2,'realtor.com/realestateagents/{id}',NULL),
('gcid:real_estate_agents','MLS member profile','profile_mls','profiles_presence','api','Person','sameAs',TRUE,50,2,NULL,'Per MLS data-use rules'),
('gcid:real_estate_agents','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:real_estate_agents','Homes.com profile','profile_homes_com','profiles_presence','etl','Person','sameAs',FALSE,30,3,'homes.com/real-estate-agents/{id}',NULL),
('gcid:real_estate_agents','HomeLight profile','profile_homelight','profiles_presence','etl','Person','sameAs',FALSE,30,3,'homelight.com/agents/{id}',NULL),
('gcid:real_estate_agents','Trulia profile','profile_trulia','profiles_presence','etl','Person','sameAs',FALSE,20,4,'trulia.com/profile/{id}',NULL),
('gcid:real_estate_agents','Yelp business page','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,20,5,'yelp.com/biz/{slug}',NULL),
('gcid:real_estate_agents','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:real_estate_agents','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:real_estate_agents','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
-- Ring 3: published_content
('gcid:real_estate_agents','VOCE neighborhood / market articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,'Fair Housing: no steering language'),
('gcid:real_estate_agents','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,'Compliance review before publish'),
('gcid:real_estate_agents','Blog / WordPress posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:real_estate_agents','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:real_estate_agents','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,'Fair Housing + advertising disclosure'),
-- Ring 4: media_voice
('gcid:real_estate_agents','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:real_estate_agents','Property tour videos','media_tours','media_voice','manual','VideoObject','author',FALSE,15,2,NULL,NULL),
('gcid:real_estate_agents','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:real_estate_agents','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:real_estate_agents','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
-- Ring 5: social_engagement
('gcid:real_estate_agents','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:real_estate_agents','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:real_estate_agents','Zillow reviews','social_zillow_reviews','social_engagement','etl','Review','review',FALSE,30,2,NULL,NULL),
('gcid:real_estate_agents','Realtor.com reviews','social_realtor_reviews','social_engagement','etl','Review','review',FALSE,20,3,NULL,NULL),
('gcid:real_estate_agents','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,'Fair Housing compliant'),
('gcid:real_estate_agents','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:real_estate_agents','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
-- Ring 6: transactions_outcomes
('gcid:real_estate_agents','Closed transaction volume','txn_volume','transactions_outcomes','crm_sync','Service','provider',FALSE,60,1,NULL,'Aggregate only — no client PII'),
('gcid:real_estate_agents','Markets served (zip codes)','txn_markets','transactions_outcomes','crm_sync','Service','areaServed',FALSE,40,2,NULL,NULL),
('gcid:real_estate_agents','Transaction type mix (buyer/seller/luxury)','txn_type_mix','transactions_outcomes','crm_sync','Service','serviceType',FALSE,30,3,NULL,NULL),
('gcid:real_estate_agents','Price range served','txn_price_range','transactions_outcomes','crm_sync','Service','priceRange',FALSE,20,3,NULL,NULL),
('gcid:real_estate_agents','MLS transaction history','txn_mls_history','transactions_outcomes','api','Service','provider',FALSE,50,1,NULL,'Per MLS data-use rules'),
-- Ring 7: upstream_context
('gcid:real_estate_agents','Brokerage office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:real_estate_agents','Brand / franchise org node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,'RE/MAX, Keller Williams, Compass, etc.'),
('gcid:real_estate_agents','Real estate category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- ------------------------------------------------------------
-- 5. Taxonomy Stack — profession_title / specialization / product_service / topic / tag / keyword / question
--    source = claude_generated, validated = false (DataForSEO enrichment fills volume later)
-- ------------------------------------------------------------
INSERT INTO exp_taxonomy (gcid, level, term, term_slug, term_display, source, priority, use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
-- profession_title
('gcid:real_estate_agents','profession_title','Real Estate Agent','real-estate-agent','Real Estate Agent','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','profession_title','REALTOR','realtor','REALTOR','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','profession_title','Listing Agent','listing-agent','Listing Agent','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','profession_title','Buyer Agent','buyer-agent','Buyer Agent','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','profession_title','Real Estate Broker','real-estate-broker','Real Estate Broker','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','profession_title','Associate Broker','associate-broker','Associate Broker','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
-- specialization
('gcid:real_estate_agents','specialization','First-Time Homebuyer Specialist','first-time-homebuyer-specialist','First-Time Homebuyer Specialist','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','specialization','Luxury Home Specialist','luxury-home-specialist','Luxury Home Specialist','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','specialization','Relocation Specialist','relocation-specialist','Relocation Specialist','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','specialization','Investment Property Specialist','investment-property-specialist','Investment Property Specialist','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','specialization','New Construction Specialist','new-construction-specialist','New Construction Specialist','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','specialization','Short Sale / REO Specialist','short-sale-reo-specialist','Short Sale / REO Specialist','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','specialization','Senior (SRES) Specialist','senior-sres-specialist','Senior (SRES) Specialist','claude_generated',7,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','specialization','Condo / Townhome Specialist','condo-townhome-specialist','Condo / Townhome Specialist','claude_generated',8,TRUE,TRUE,TRUE,TRUE,TRUE),
-- product_service
('gcid:real_estate_agents','product_service','Buyer Representation','buyer-representation','Buyer Representation','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','product_service','Seller Representation','seller-representation','Seller Representation','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','product_service','Listing & Marketing','listing-marketing','Listing & Marketing','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','product_service','Comparative Market Analysis','cma','Comparative Market Analysis (CMA)','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','product_service','Home Valuation','home-valuation','Home Valuation','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','product_service','Relocation Services','relocation-services','Relocation Services','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','product_service','Investment Property Advisory','investment-property-advisory','Investment Property Advisory','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','product_service','Property Staging Coordination','staging-coordination','Property Staging Coordination','claude_generated',6,TRUE,FALSE,TRUE,TRUE,TRUE),
-- topic
('gcid:real_estate_agents','topic','Moving to [City]: Neighborhood Guide','moving-to-city-guide','Moving to [City]: Neighborhood Guide','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','topic','First-Time Homebuyer Guide','first-time-homebuyer-guide','First-Time Homebuyer Guide','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','topic','How to Price Your Home to Sell','price-your-home','How to Price Your Home to Sell','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','topic','[City] Real Estate Market Update','city-market-update','[City] Real Estate Market Update','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','topic','Buyer vs Seller Markets Explained','buyer-vs-seller-markets','Buyer vs Seller Markets Explained','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','topic','What to Expect at Closing','what-to-expect-at-closing','What to Expect at Closing','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','topic','Home Staging Tips That Sell','staging-tips','Home Staging Tips That Sell','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','topic','How Much Is My Home Worth?','how-much-is-my-home-worth','How Much Is My Home Worth?','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
-- tag
('gcid:real_estate_agents','tag','buyer','buyer','buyer','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','seller','seller','seller','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','luxury','luxury','luxury','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','first-time buyer','first-time-buyer','first-time buyer','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','investment','investment','investment','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','relocation','relocation','relocation','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','new construction','new-construction','new construction','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','condo','condo','condo','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','staging','staging','staging','claude_generated',5,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','tag','market update','market-update','market update','claude_generated',5,FALSE,TRUE,TRUE,TRUE,TRUE),
-- keyword (seed; DataForSEO enrichment fills volume/intent)
('gcid:real_estate_agents','keyword','real estate agent [city]','real-estate-agent-city','real estate agent [city]','claude_generated',1,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','realtor [city]','realtor-city','realtor [city]','claude_generated',1,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','best realtor [city]','best-realtor-city','best realtor [city]','claude_generated',1,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','homes for sale [city]','homes-for-sale-city','homes for sale [city]','claude_generated',2,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','sell my house [city]','sell-my-house-city','sell my house [city]','claude_generated',2,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','buyer agent [city]','buyer-agent-city','buyer agent [city]','claude_generated',3,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','luxury real estate agent [city]','luxury-real-estate-agent-city','luxury real estate agent [city]','claude_generated',3,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','how much is my home worth','how-much-is-my-home-worth-kw','how much is my home worth','claude_generated',4,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','first time home buyer programs [state]','first-time-buyer-programs-state','first time home buyer programs [state]','claude_generated',4,FALSE,FALSE,TRUE,FALSE,FALSE),
('gcid:real_estate_agents','keyword','moving to [city]','moving-to-city-kw','moving to [city]','claude_generated',4,FALSE,FALSE,TRUE,FALSE,FALSE),
-- question (PAA / FAQ prompts)
('gcid:real_estate_agents','question','How do I choose a real estate agent?','q-choose-agent','How do I choose a real estate agent?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','question','What does a buyer agent do?','q-buyer-agent-do','What does a buyer agent do?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','question','How much commission does a realtor charge?','q-commission','How much commission does a realtor charge?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','question','How long does it take to sell a house?','q-time-to-sell','How long does it take to sell a house?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','question','What is the difference between a realtor and a real estate agent?','q-realtor-vs-agent','What is the difference between a realtor and a real estate agent?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','question','How do I price my home to sell?','q-price-home','How do I price my home to sell?','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','question','What should I look for in a neighborhood?','q-neighborhood','What should I look for in a neighborhood?','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:real_estate_agents','question','What are closing costs for a buyer?','q-closing-costs','What are closing costs for a buyer?','claude_generated',5,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;

-- ------------------------------------------------------------
-- 6. Verification — run these to confirm the seed landed
-- ------------------------------------------------------------
-- SELECT ring, count(*) FROM exp_vertical_node_registry WHERE gcid='gcid:real_estate_agents' GROUP BY ring ORDER BY ring;
-- SELECT level, count(*) FROM exp_taxonomy WHERE gcid='gcid:real_estate_agents' GROUP BY level ORDER BY level;
-- SELECT gcid, entity_type, knowledge_pct FROM exp_category_knowledge WHERE gcid='gcid:real_estate_agents';
