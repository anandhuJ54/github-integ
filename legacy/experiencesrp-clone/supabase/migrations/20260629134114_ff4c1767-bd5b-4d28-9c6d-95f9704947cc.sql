-- ============================================================
-- SEED: Tax Consultant vertical (gcid:tax_consultant)
-- Layer 1: Knowledge model | Layer 2: Taxonomy
-- Layer 3: Node registry   | Layer 4: Compliance
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_unique_gcid_level_slug
  ON exp_taxonomy (gcid, level, term_slug);

-- 1. Category classification
UPDATE gbp_categories
SET entity_type = 'professional',
    priority_tier = 1,
    supports_single_pro_office = TRUE,
    status = 'active'
WHERE gcid = 'gcid:tax_consultant';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:tax_consultant', 'professional', 'professional', 'active',
  ARRAY['IRS', 'tax return', 'audit', 'deduction', 'credit', 'AGI', 'AMT', 'capital gains', 'depreciation', 'NOL', 'estimated taxes', 'withholding', 'self-employment tax', 'Enrolled Agent', '1040', 'Schedule C', '1120-S', 'K-1', 'FBAR', 'FATCA', 'tax lien', 'offer in compromise', 'installment agreement', 'penalty abatement', 'like-kind exchange', 'QSBS'],
  '["Individual tax return preparation","Business tax returns","Tax planning and strategy","IRS audit representation","Back tax resolution","Offer in compromise","Installment agreements","Payroll tax help","International tax (FBAR/FATCA)","Estate and trust returns","State tax compliance","Tax lien removal","Penalty abatement requests","Real estate tax planning","Crypto tax reporting"]'::jsonb,
  ARRAY['IRS Circular 230', 'State CPA/EA board requirements', 'No guaranteed refund amounts', 'No guaranteed audit outcomes', 'Privacy rules for tax records (GLBA)', 'Preparer PTIN required', 'No unauthorized practice of tax law', 'Client confidentiality'],
  '["Tax deadline pressure or IRS notice","Searching for tax help / referral","Initial consultation / case review","Engagement letter and document collection","Filing or resolution work","Filing confirmation / resolution notice","Year-round tax planning setup"]'::jsonb,
  '{"primary":["EA or CPA credentials","IRS resolution success record","Client reviews","Tax specialty (small business, real estate, crypto)","Availability year-round (not just tax season)"],"secondary":["State tax expertise","Software (Drake, ProSeries, UltraTax)","Languages spoken","Response time to IRS notices","Pricing transparency"]}'::jsonb,
  ARRAY['saved me from the IRS', 'got my back taxes resolved', 'found deductions I missed', 'responds quickly to IRS notices', 'explains complex tax situations', 'year-round support', 'no surprises at filing', 'got my penalties waived', 'trusted tax advisor', 'always finds a way to save money'],
  ARRAY['Back taxes — what to do if you owe the IRS', 'Offer in compromise — who qualifies?', 'Crypto tax reporting explained', 'Self-employed tax deductions guide', 'FBAR filing requirements', 'What happens at an IRS audit?', 'Penalty abatement request guide', 'Real estate tax strategies', 'How to set up an S-corp for tax savings', 'Estimated tax payments explained', 'Tax planning moves for high earners', 'IRS notice — what to do first', 'State tax residency planning', 'Year-end tax strategies', 'Capital gains tax explained'],
  '{"primary":["Enrolled Agent (EA) credential","CPA license","IRS e-file authorization (EFIN)","PTIN registration"],"secondary":["IRS resolution experience","Tax specialization (real estate, crypto, international)","Former IRS employee (bonus credibility)","Published tax content"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.22,"license_verified":0.2,"specialization":0.16,"content_freshness":0.14,"schema_completeness":0.11}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"expert","compliance":"Circular230"},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"tax"},"content_assistant":{"enabled":true,"topics":["tax tips","IRS guidance","tax planning"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:tax_consultant',
  TRUE, TRUE,
  TRUE, FALSE,
  'License #{license_number}', 'EA / CPA License',
  ARRAY['Licensed Tax Professional | {license_number}', 'This content is general tax information and does not constitute personalized tax advice', 'Tax situations vary — consult a qualified tax professional for your specific situation'],
  ARRAY['no guaranteed refunds', 'no guaranteed audit outcomes', 'Circular 230 compliance', 'no misleading credential claims'],
  ARRAY['guaranteed tax refund', 'IRS won''t audit you', 'guarantee no taxes owed', 'largest refund guaranteed', 'no taxes ever'],
  FALSE, FALSE, TRUE,
  ARRAY['IRS (Circular 230)', 'State CPA/EA Board', 'AICPA (for CPAs)', 'NAEA (National Association of Enrolled Agents)'],
  'Tax preparers must hold a valid PTIN. Enrolled Agents and CPAs have unlimited practice rights before the IRS. Circular 230 governs all tax advice. No guaranteed refund or audit-free guarantees.'
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
('gcid:tax_consultant','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:tax_consultant','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:tax_consultant','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:tax_consultant','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:tax_consultant','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:tax_consultant','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:tax_consultant','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:tax_consultant','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:tax_consultant','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:tax_consultant','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:tax_consultant','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:tax_consultant','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:tax_consultant','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:tax_consultant','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:tax_consultant','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:tax_consultant','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:tax_consultant','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:tax_consultant','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:tax_consultant','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:tax_consultant','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:tax_consultant','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:tax_consultant','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:tax_consultant','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:tax_consultant','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:tax_consultant','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:tax_consultant','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:tax_consultant','Enrolled Agent (IRS)','auth_ea','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,90,1,'irs.gov/tax-professionals/verify-the-status-of-an-enrolled-agent/{id}','EA = unlimited IRS practice rights'),
('gcid:tax_consultant','CPA state license','auth_cpa','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,100,1,NULL,'CPA state board'),
('gcid:tax_consultant','IRS PTIN registration','auth_ptin','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,60,2,'irs.gov/tax-professionals','Required for all paid tax preparers'),
('gcid:tax_consultant','EFIN authorization','auth_efin','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,40,3,NULL,'Electronic Filing Identification Number'),
('gcid:tax_consultant','IRS Tax Pro directory','profile_irs_dir','profiles_presence','etl','Person','sameAs',FALSE,50,1,'irs.gov/tax-professionals/choosing-a-tax-professional','IRS official tax pro directory'),
('gcid:tax_consultant','NAEA directory (EAs)','profile_naea','profiles_presence','etl','Person','sameAs',FALSE,40,2,'naea.org/find-a-tax-expert/{id}','National Association of Enrolled Agents'),
('gcid:tax_consultant','Yelp listing','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,25,4,'yelp.com/biz/{slug}',NULL),
('gcid:tax_consultant','Tax specializations','txn_specialties','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,NULL),
('gcid:tax_consultant','IRS resolution track record','txn_irs_resolution','transactions_outcomes','platform','Service','provider',FALSE,40,1,NULL,'Aggregate cases resolved — no client PII')
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:tax_consultant','profession_title','Tax Consultant','tax-consultant-title','Tax Consultant','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','profession_title','Enrolled Agent (EA)','enrolled-agent','Enrolled Agent (EA)','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','profession_title','Tax Preparer','tax-preparer','Tax Preparer','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','profession_title','Tax Advisor','tax-advisor','Tax Advisor','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','specialization','Small Business Tax','small-biz-tax','Small Business Tax','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','specialization','IRS Tax Resolution','irs-resolution','IRS Tax Resolution','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','specialization','Real Estate Tax Planning','real-estate-tax','Real Estate Tax Planning','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','specialization','Crypto Tax Reporting','crypto-tax','Crypto Tax Reporting','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','specialization','International Tax (FBAR/FATCA)','international-tax','International Tax','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','specialization','Back Tax Resolution','back-taxes','Back Tax Resolution','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','product_service','Individual Tax Return','individual-tax-return','Individual Tax Return','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','product_service','Business Tax Return','business-tax-return','Business Tax Return','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','product_service','IRS Audit Representation','irs-audit-rep','IRS Audit Representation','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','product_service','Offer in Compromise','offer-in-compromise','Offer in Compromise','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','product_service','Tax Planning Strategy','tax-planning-svc','Tax Planning Strategy','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','topic','Back Taxes — What to Do If You Owe the IRS','back-taxes-irs','Back Taxes — What to Do If You Owe the IRS','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','topic','Offer in Compromise — Who Qualifies?','offer-compromise-qualify','Offer in Compromise — Who Qualifies?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','topic','Crypto Tax Reporting Explained','crypto-tax-explained','Crypto Tax Reporting Explained','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','tag','IRS help','irs-help','IRS Help','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','tag','back taxes','back-taxes-tag','Back Taxes','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','tag','enrolled agent','ea-tag','Enrolled Agent','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','keyword','tax consultant near me','tax-consultant-near-me','Tax consultant near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:tax_consultant','keyword','IRS tax resolution','irs-tax-resolution','IRS tax resolution','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:tax_consultant','keyword','enrolled agent near me','ea-near-me','Enrolled agent near me','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:tax_consultant','question','Can a tax consultant help me with back taxes?','back-taxes-help','Can a tax consultant help me with back taxes?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','question','What is an enrolled agent?','what-is-enrolled-agent','What is an enrolled agent?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:tax_consultant','question','How much does an IRS audit cost to fight?','irs-audit-cost','How much does an IRS audit cost to fight?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
