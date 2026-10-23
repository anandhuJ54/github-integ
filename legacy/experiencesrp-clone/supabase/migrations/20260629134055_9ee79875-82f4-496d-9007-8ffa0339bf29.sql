-- ============================================================
-- SEED: Attorney vertical (gcid:lawyer)
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
WHERE gcid = 'gcid:lawyer';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:lawyer', 'professional', 'professional', 'active',
  ARRAY['litigation', 'counsel', 'retainer', 'discovery', 'deposition', 'brief', 'pleading', 'motion', 'hearing', 'ruling', 'settlement', 'damages', 'plaintiff', 'defendant', 'tort', 'statute', 'fiduciary', 'attorney-client privilege', 'pro bono', 'contingency', 'voir dire', 'subpoena', 'injunction', 'arbitration', 'mediation'],
  '["Legal consultation","Litigation representation","Contract drafting & review","Negotiation","Mediation & arbitration","Document review & due diligence","Legal research","Trial preparation & representation","Appeals","Settlement negotiation","Demand letters","Regulatory compliance advice"]'::jsonb,
  ARRAY['State bar advertising rules', 'No guarantee of case outcome', 'Attorney advertising must include firm name', 'Contingency fee disclosure required', 'Referral fees regulated by state bar', 'No misleading claims of expertise or results', 'Testimonials require client consent', 'No ''specialist'' claim without certification'],
  '["Searching for legal help / researching options","Initial consultation / case evaluation","Retaining an attorney / signing engagement letter","Discovery & case preparation","Negotiation or trial / hearing","Resolution / judgment or settlement","Post-resolution follow-up"]'::jsonb,
  '{"primary":["Peer review ratings (AV Preeminent)","Case outcome history","Super Lawyers / Best Lawyers recognition","State bar standing","Bar complaint history"],"secondary":["Years of practice","Specialization certifications","Geographic coverage","Firm size","Response time"]}'::jsonb,
  ARRAY['explained my options clearly', 'fought hard for me', 'responsive and kept me informed', 'settled quickly', 'excellent outcome', 'knew the law inside and out', 'honest about my chances', 'made a stressful situation manageable', 'highly recommend', 'won my case', 'professional and thorough'],
  ARRAY['How to choose an attorney', 'What to expect in a lawsuit', 'Understanding attorney fees', 'When to hire a lawyer', 'Statute of limitations explained', 'How settlements work', 'Your rights in a legal dispute', 'What is discovery?', 'Small claims vs civil court', 'How to prepare for a deposition', 'Understanding a contract', 'When to appeal a court decision', 'Mediation vs arbitration', 'Legal documents you need', 'Finding pro bono legal help'],
  '{"primary":["AV Preeminent rated (Martindale-Hubbell)","Super Lawyers","Best Lawyers in America","Board certified specialist"],"secondary":["Published legal articles","Law school ranking","Appellate experience","Trial experience"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.24,"peer_recognition":0.18,"license_verified":0.16,"content_freshness":0.14,"schema_completeness":0.11}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"professional","compliance":"state_bar"},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"legal"},"content_assistant":{"enabled":true,"topics":["legal tips","rights","process guides"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:lawyer',
  TRUE, TRUE,
  TRUE, FALSE,
  'Bar No. {license_number}', 'State Bar Number',
  ARRAY['Licensed attorney in [State] | Bar No. {license_number}', 'Prior results do not guarantee a similar outcome', 'This is not legal advice — consult an attorney for your specific situation'],
  ARRAY['no guaranteed outcomes', 'no misleading success statistics', 'no false specialization claims', 'testimonials require client consent'],
  ARRAY['guaranteed verdict', 'guaranteed settlement', 'win your case', 'best lawyer in', 'most successful attorney', 'risk-free legal help', 'no-lose case'],
  FALSE, FALSE, FALSE,
  ARRAY['State Bar Association', 'American Bar Association (voluntary)', 'State Supreme Court'],
  'Attorney advertising is regulated by state bar rules (typically Model Rules 7.1-7.5). No outcome guarantees. The phrase ''specialist'' requires bar-certified specialization in most states. All ads must include firm name and bar number.'
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
('gcid:lawyer','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:lawyer','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:lawyer','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:lawyer','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:lawyer','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:lawyer','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:lawyer','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:lawyer','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:lawyer','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:lawyer','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:lawyer','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:lawyer','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:lawyer','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:lawyer','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:lawyer','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:lawyer','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:lawyer','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:lawyer','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:lawyer','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:lawyer','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:lawyer','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:lawyer','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:lawyer','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:lawyer','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:lawyer','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:lawyer','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:lawyer','State bar license','auth_bar_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'Primary credential — must match state bar records'),
('gcid:lawyer','Peer review rating (AV Preeminent)','auth_av_preeminent','verifiable_authority','etl','Rating','ratingValue',FALSE,50,2,'martindale.com/{id}','AV Preeminent = highest Martindale-Hubbell rating'),
('gcid:lawyer','Super Lawyers recognition','auth_super_lawyers','verifiable_authority','etl','Award','award',FALSE,40,3,'superlawyers.com/attorney/{id}',NULL),
('gcid:lawyer','Best Lawyers recognition','auth_best_lawyers','verifiable_authority','etl','Award','award',FALSE,40,3,'bestlawyers.com/lawyers/{id}',NULL),
('gcid:lawyer','Board certification','auth_board_cert','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,30,4,NULL,'State bar specialty certification'),
('gcid:lawyer','Years of practice','auth_experience','verifiable_authority','manual','Person','description',FALSE,10,5,NULL,NULL),
('gcid:lawyer','Avvo profile','profile_avvo','profiles_presence','etl','Person','sameAs',TRUE,60,1,'avvo.com/attorneys/{id}','Leading attorney directory — Avvo Rating + reviews'),
('gcid:lawyer','Martindale-Hubbell profile','profile_martindale','profiles_presence','etl','Person','sameAs',TRUE,50,2,'martindale.com/find-lawyers/{id}','Peer review ratings'),
('gcid:lawyer','FindLaw attorney profile','profile_findlaw','profiles_presence','etl','Person','sameAs',FALSE,40,2,'lawyers.findlaw.com/{id}',NULL),
('gcid:lawyer','Justia lawyer profile','profile_justia','profiles_presence','etl','Person','sameAs',FALSE,35,3,'justia.com/lawyers/{id}',NULL),
('gcid:lawyer','Lawyers.com profile','profile_lawyers_com','profiles_presence','etl','Person','sameAs',FALSE,30,3,'lawyers.com/profile/{id}',NULL),
('gcid:lawyer','Yelp business page','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,20,5,'yelp.com/biz/{slug}',NULL),
('gcid:lawyer','Practice area content','content_practice','published_content','platform','Article','author',FALSE,30,2,NULL,'Practice area–specific articles'),
('gcid:lawyer','Case result summaries','social_case_results','transactions_outcomes','platform','Service','provider',FALSE,40,1,NULL,'Aggregate outcomes — no client PII'),
('gcid:lawyer','Practice area coverage','txn_practice_areas','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,NULL),
('gcid:lawyer','Jurisdictions served','txn_jurisdictions','transactions_outcomes','manual','Service','areaServed',FALSE,20,3,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:lawyer','profession_title','Attorney','attorney','Attorney','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','profession_title','Lawyer','lawyer','Lawyer','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','profession_title','Counsel','counsel','Counsel','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','profession_title','Trial Attorney','trial-attorney','Trial Attorney','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','profession_title','Litigation Attorney','litigation-attorney','Litigation Attorney','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','profession_title','General Counsel','general-counsel','General Counsel','claude_generated',6,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Civil Litigation','civil-litigation','Civil Litigation','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Criminal Defense','criminal-defense','Criminal Defense','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Family Law','family-law','Family Law','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Personal Injury','personal-injury','Personal Injury','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Estate Planning','estate-planning','Estate Planning','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Business Law','business-law','Business Law','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Real Estate Law','real-estate-law','Real Estate Law','claude_generated',7,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Immigration Law','immigration-law','Immigration Law','claude_generated',8,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Bankruptcy Law','bankruptcy-law','Bankruptcy Law','claude_generated',9,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','specialization','Employment Law','employment-law','Employment Law','claude_generated',10,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','product_service','Legal Consultation','legal-consultation','Legal Consultation','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','product_service','Litigation Representation','litigation-representation','Litigation Representation','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','product_service','Contract Drafting','contract-drafting','Contract Drafting','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','product_service','Negotiation & Settlement','negotiation-settlement','Negotiation & Settlement','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','product_service','Document Review','document-review','Document Review','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','product_service','Appeals','appeals','Appeals','claude_generated',6,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','topic','How to Choose an Attorney','how-to-choose-attorney','How to Choose an Attorney','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','topic','Understanding Attorney Fees','understanding-attorney-fees','Understanding Attorney Fees','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','topic','What to Expect in a Lawsuit','what-to-expect-lawsuit','What to Expect in a Lawsuit','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','topic','Your Legal Rights','your-legal-rights','Your Legal Rights','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','topic','Statute of Limitations Explained','statute-of-limitations','Statute of Limitations Explained','claude_generated',5,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','tag','free consultation','free-consultation','Free Consultation','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','tag','contingency fee','contingency-fee','Contingency Fee','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','tag','local attorney','local-attorney','Local Attorney','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','tag','experienced lawyer','experienced-lawyer','Experienced Lawyer','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:lawyer','keyword','attorney near me','attorney-near-me','Attorney near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:lawyer','keyword','lawyer near me','lawyer-near-me','Lawyer near me','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:lawyer','keyword','best attorney in [city]','best-attorney-city','Best attorney in [city]','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:lawyer','keyword','free legal consultation','free-legal-consultation','Free legal consultation','claude_generated',4,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:lawyer','keyword','top rated attorney','top-rated-attorney','Top rated attorney','claude_generated',5,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:lawyer','question','How much does it cost to hire an attorney?','cost-hire-attorney','How much does it cost to hire an attorney?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','question','What should I look for when choosing a lawyer?','choosing-a-lawyer','What should I look for when choosing a lawyer?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','question','What is a contingency fee?','what-is-contingency-fee','What is a contingency fee?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','question','How long does a lawsuit take?','how-long-lawsuit','How long does a lawsuit take?','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:lawyer','question','Do I need a lawyer for a small claim?','need-lawyer-small-claim','Do I need a lawyer for a small claim?','claude_generated',5,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
