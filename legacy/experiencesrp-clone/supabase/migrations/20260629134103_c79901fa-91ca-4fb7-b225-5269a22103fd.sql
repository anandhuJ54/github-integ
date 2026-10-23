-- ============================================================
-- SEED: Insurance Agent vertical (gcid:insurance_agency)
-- Layer 1: Knowledge model | Layer 2: Taxonomy
-- Layer 3: Node registry   | Layer 4: Compliance
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_unique_gcid_level_slug
  ON exp_taxonomy (gcid, level, term_slug);

-- 1. Category classification
UPDATE gbp_categories
SET entity_type = 'both',
    priority_tier = 1,
    supports_single_pro_office = TRUE,
    status = 'active'
WHERE gcid = 'gcid:insurance_agency';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:insurance_agency', 'both', 'professional', 'active',
  ARRAY['premium', 'deductible', 'copay', 'coverage', 'policy', 'underwriting', 'beneficiary', 'claim', 'liability', 'endorsement', 'rider', 'exclusion', 'subrogation', 'indemnity', 'actuary', 'binder', 'declarations page', 'CLUE report', 'term life', 'whole life', 'universal life', 'umbrella policy', 'E&O', 'captive agent', 'independent agent', 'carrier'],
  '["Auto insurance","Homeowners insurance","Life insurance (term and whole)","Health insurance","Business / commercial insurance","Renters insurance","Umbrella insurance","Disability insurance","Long-term care insurance","Medicare supplement","Workers compensation","General liability"]'::jsonb,
  ARRAY['State insurance department licensing', 'GLBA privacy and data protection', 'No misleading policy comparisons', 'Premium guarantees must be accurate', 'No unauthorized binding of coverage', 'Suitable product recommendations required', 'Replacement transaction disclosure', 'Disclosure of compensation arrangements'],
  '["Identifying insurance need / life event trigger","Shopping and comparing options / agent referral","Needs analysis meeting with agent","Proposal and quote review","Application and underwriting","Policy issuance","Claims handling / annual review"]'::jsonb,
  '{"primary":["State license in good standing","Carrier ratings (AM Best)","Client reviews","Years of experience","Independent vs captive transparency"],"secondary":["Product specialization","Geographic focus","Claims advocacy","Policy count","Referral network"]}'::jsonb,
  ARRAY['got me the best rate', 'helped with my claim', 'explained my coverage clearly', 'saved me money', 'responded quickly', 'honest about what I needed', 'trusted for years', 'handled my claim smoothly', 'found coverage I didn''t know I needed', 'excellent customer service'],
  ARRAY['How to choose the right insurance agent', 'Term vs whole life insurance', 'How much auto insurance do you need?', 'Understanding homeowners insurance', 'What is an umbrella policy?', 'How life insurance protects your family', 'Reviewing your insurance coverage annually', 'What does renters insurance cover?', 'Business insurance for small businesses', 'Health insurance terms explained', 'Long-term care planning', 'When to file an insurance claim', 'How insurance premiums are calculated', 'Medicare supplement (Medigap) explained', 'The importance of disability insurance'],
  '{"primary":["State insurance license in good standing","AM Best A-rated carrier relationships","Industry designations (CLU, ChFC, CPCU)","Independent agent status (access to multiple carriers)"],"secondary":["Years of experience","Specialization","Claims advocacy track record","Community involvement"]}'::jsonb,
  '{"profile_completeness":0.18,"review_volume":0.24,"license_verified":0.17,"carrier_relationships":0.15,"content_freshness":0.14,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"helpful","compliance":"state_insurance_dept"},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"insurance"},"content_assistant":{"enabled":true,"topics":["coverage guides","claims help","life events"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:insurance_agency',
  TRUE, TRUE,
  TRUE, FALSE,
  'License #{license_number}', 'State Insurance License',
  ARRAY['Licensed insurance agent in [State] | License #{license_number}', 'Coverage is subject to policy terms, conditions, and exclusions', '[Agent Name] is [captive with X / independent — representing multiple carriers]'],
  ARRAY['no guaranteed coverage or claims approval', 'no misleading comparisons', 'must disclose captive vs independent status', 'no unauthorized binding'],
  ARRAY['guaranteed coverage', 'claim always approved', 'cheapest insurance guaranteed', 'best insurance company', 'no questions asked coverage'],
  FALSE, FALSE, TRUE,
  ARRAY['State Department of Insurance', 'NAIC (National Association of Insurance Commissioners)', 'GLBA (Gramm-Leach-Bliley for financial privacy)'],
  'Insurance agents must hold a state license per line of authority (P&C, life, health, etc.). GLBA requires privacy notices. Independent agents must clearly distinguish themselves from captive agents. No misleading comparisons between carriers.'
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
('gcid:insurance_agency','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:insurance_agency','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:insurance_agency','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:insurance_agency','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:insurance_agency','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:insurance_agency','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:insurance_agency','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:insurance_agency','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:insurance_agency','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:insurance_agency','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:insurance_agency','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:insurance_agency','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:insurance_agency','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:insurance_agency','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:insurance_agency','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:insurance_agency','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:insurance_agency','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:insurance_agency','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:insurance_agency','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:insurance_agency','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:insurance_agency','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:insurance_agency','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:insurance_agency','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:insurance_agency','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:insurance_agency','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:insurance_agency','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:insurance_agency','State insurance license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'License per line of authority — auto, home, life, health'),
('gcid:insurance_agency','NIPR license verification','auth_nipr','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,'nipr.com','National Insurance Producer Registry'),
('gcid:insurance_agency','CLU / ChFC / CPCU designation','auth_designations','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,30,3,NULL,'Advanced insurance and financial planning designations'),
('gcid:insurance_agency','Carrier appointments','auth_carriers','verifiable_authority','manual','Organization','worksFor',FALSE,40,2,NULL,'AM Best A-rated carrier relationships'),
('gcid:insurance_agency','Yelp business page','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,30,2,'yelp.com/biz/{slug}',NULL),
('gcid:insurance_agency','Insurify profile','profile_insurify','profiles_presence','etl','Person','sameAs',FALSE,30,2,'insurify.com/agents/{id}',NULL),
('gcid:insurance_agency','Policygenius profile','profile_policygenius','profiles_presence','etl','Person','sameAs',FALSE,30,3,'policygenius.com/life-insurance/agents/{id}',NULL),
('gcid:insurance_agency','Lines of authority covered','txn_lines','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,'Auto, home, life, health, commercial, etc.'),
('gcid:insurance_agency','Policies in force','txn_policies','transactions_outcomes','manual','Service','provider',FALSE,20,3,NULL,NULL),
('gcid:insurance_agency','Claims support track record','txn_claims','transactions_outcomes','platform','Service','provider',FALSE,40,1,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:insurance_agency','profession_title','Insurance Agent','insurance-agent','Insurance Agent','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','profession_title','Insurance Broker','insurance-broker','Insurance Broker','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','profession_title','Independent Insurance Agent','independent-insurance-agent','Independent Insurance Agent','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','profession_title','Licensed Insurance Advisor','licensed-insurance-advisor','Licensed Insurance Advisor','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','specialization','Auto Insurance','auto-insurance','Auto Insurance','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','specialization','Homeowners Insurance','homeowners-insurance','Homeowners Insurance','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','specialization','Life Insurance','life-insurance','Life Insurance','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','specialization','Health Insurance','health-insurance','Health Insurance','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','specialization','Commercial / Business Insurance','commercial-insurance','Commercial / Business Insurance','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','specialization','Medicare Supplement','medicare-supplement','Medicare Supplement','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','specialization','Long-Term Care Insurance','long-term-care','Long-Term Care Insurance','claude_generated',7,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','product_service','Auto Insurance Quotes','auto-insurance-quotes','Auto Insurance Quotes','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','product_service','Homeowners Insurance','homeowners-insurance-svc','Homeowners Insurance','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','product_service','Life Insurance Analysis','life-insurance-analysis','Life Insurance Analysis','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','product_service','Annual Coverage Review','annual-review','Annual Coverage Review','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','topic','How to Choose the Right Insurance','how-to-choose-insurance','How to Choose the Right Insurance','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','topic','Term vs Whole Life Insurance','term-vs-whole-life','Term vs Whole Life Insurance','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','topic','What Does Homeowners Insurance Cover?','homeowners-coverage','What Does Homeowners Insurance Cover?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','tag','independent agent','independent-agent-tag','Independent Agent','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','tag','free quotes','free-quotes','Free Quotes','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','tag','bundling discount','bundling-discount','Bundling Discount','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','keyword','insurance agent near me','insurance-agent-near-me','Insurance agent near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:insurance_agency','keyword','independent insurance agent','independent-agent-kw','Independent insurance agent','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:insurance_agency','keyword','best insurance rates','best-insurance-rates','Best insurance rates','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:insurance_agency','question','What insurance do I really need?','what-insurance-do-i-need','What insurance do I really need?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','question','How much does homeowners insurance cost?','homeowners-cost','How much does homeowners insurance cost?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:insurance_agency','question','Is it better to have an independent or captive insurance agent?','independent-vs-captive','Is it better to have an independent or captive agent?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
