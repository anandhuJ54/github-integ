-- ============================================================
-- SEED: Mortgage Broker vertical (gcid:mortgage_broker)
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
WHERE gcid = 'gcid:mortgage_broker';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:mortgage_broker', 'professional', 'professional', 'active',
  ARRAY['NMLS', 'broker', 'wholesale lender', 'correspondent lender', 'rate shopping', 'lock', 'yield spread premium', 'origination fee', 'lender credit', 'par rate', 'conventional', 'FHA', 'VA', 'USDA', 'jumbo', 'non-QM', 'stated income', 'bank statement loan', 'DSCR', 'hard money', 'credit score', 'DTI', 'LTV', 'appraisal', 'rate lock', 'GFE', 'LE', 'CD', 'escrow', 'title', 'PMI'],
  '["Purchase mortgage brokering","Refinance brokering","FHA loans","VA loans","USDA loans","Jumbo loans","Non-QM / bank statement loans","Investment property loans","DSCR loans","Hard money referrals","First-time buyer programs","Down payment assistance programs","Rate and term refinance","Cash-out refinance","Construction-to-perm loans"]'::jsonb,
  ARRAY['NMLS licensing required (SAFE Act)', 'RESPA anti-kickback rules', 'TRID disclosure requirements (LE, CD)', 'No steering to unsuitable products', 'ECOA anti-discrimination rules', 'Yield spread premium disclosure', 'Compensation transparency (CFPB rules)', 'GLBA privacy notice required', 'No guaranteed interest rate claims', 'State broker licensing requirements'],
  '["Home purchase or refi trigger","Searching for broker / rate comparison","Pre-approval application","Rate shopping with multiple wholesale lenders","Loan selection and lock","Processing, appraisal, underwriting","Closing"]'::jsonb,
  '{"primary":["NMLS license in good standing","Access to multiple wholesale lenders (rate shopping)","Client reviews","Niche expertise (VA, jumbo, non-QM)","Close-on-time track record"],"secondary":["Lender panel size","Technology (digital application)","Communication and updates","Non-QM / niche loan access","Realtor referral network"]}'::jsonb,
  ARRAY['shopped the best rate for me', 'closed on time', 'explained every option', 'saved me thousands vs my bank', 'non-QM expert', 'transparent about all costs', 'no surprises at closing', 'available nights and weekends', 'VA loan expert', 'refinanced perfectly'],
  ARRAY['Broker vs bank vs direct lender — what''s the difference?', 'How a mortgage broker shops rates for you', 'NMLS license — why it matters', 'Non-QM loans — who are they for?', 'VA loan guide for veterans', 'FHA vs conventional — which is right for you?', 'Bank statement loans for self-employed borrowers', 'How to get the best mortgage rate', 'DSCR loans for real estate investors', 'What is a wholesale mortgage rate?', 'Understanding your Loan Estimate', 'Rate lock strategies', 'Mortgage broker fees explained', 'Down payment assistance programs', 'Jumbo loan guide'],
  '{"primary":["NMLS license in good standing","State broker license","Access to 10+ wholesale lenders","Niche expertise (VA, non-QM, jumbo)"],"secondary":["Years of experience","Volume and close-rate","Realtor partnerships","Technology platform","Non-QM / specialty access"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.24,"nmls_verified":0.18,"lender_panel":0.15,"content_freshness":0.14,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"professional","compliance":"RESPA_GLBA"},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"mortgage"},"content_assistant":{"enabled":true,"topics":["mortgage guides","rate strategy","loan programs"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:mortgage_broker',
  TRUE, TRUE,
  TRUE, FALSE,
  'NMLS #{license_number}', 'NMLS ID',
  ARRAY['NMLS #{license_number} | Licensed Mortgage Broker in [State]', 'Rates and terms subject to change and credit approval', 'This is not a commitment to lend — final approval is subject to underwriting'],
  ARRAY['no guaranteed interest rate', 'no guaranteed approval', 'RESPA-compliant referral language', 'TRID-compliant disclosure references'],
  ARRAY['guaranteed lowest rate', 'guaranteed approval', 'no income verification loan (if not accurate)', 'best rate in the market guaranteed', 'instant approval'],
  FALSE, FALSE, TRUE,
  ARRAY['NMLS (SAFE Act)', 'CFPB', 'State Mortgage Regulator', 'RESPA', 'ECOA', 'TRID (TILA-RESPA Integrated Disclosure)'],
  'Mortgage brokers differ from loan officers — they shop multiple wholesale lenders on behalf of borrowers. NMLS licensing is required federally (SAFE Act) and in each operating state. Yield spread premium and compensation must be disclosed. RESPA prohibits kickbacks from settlement service providers.'
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
('gcid:mortgage_broker','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:mortgage_broker','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:mortgage_broker','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:mortgage_broker','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:mortgage_broker','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:mortgage_broker','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:mortgage_broker','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:mortgage_broker','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:mortgage_broker','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:mortgage_broker','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:mortgage_broker','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:mortgage_broker','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:mortgage_broker','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:mortgage_broker','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:mortgage_broker','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:mortgage_broker','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:mortgage_broker','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:mortgage_broker','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:mortgage_broker','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:mortgage_broker','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:mortgage_broker','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:mortgage_broker','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:mortgage_broker','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:mortgage_broker','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:mortgage_broker','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:mortgage_broker','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:mortgage_broker','NMLS ID (SAFE Act license)','auth_nmls','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,'nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/{nmls_id}','Primary credential — NMLS Consumer Access'),
('gcid:mortgage_broker','State mortgage broker license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,NULL,'State-level broker license — separate from MLO license'),
('gcid:mortgage_broker','Wholesale lender panel','auth_lender_panel','verifiable_authority','manual','Organization','partnerOf',FALSE,40,2,NULL,'10+ lenders enables real rate shopping'),
('gcid:mortgage_broker','NMLS Consumer Access profile','profile_nmls_consumer','profiles_presence','etl','Person','sameAs',TRUE,90,1,'nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/{nmls_id}','Required — public must be able to verify license'),
('gcid:mortgage_broker','Zillow / Trulia mortgage profile','profile_zillow_mortgage','profiles_presence','etl','Person','sameAs',FALSE,40,2,'zillow.com/lender-profile/{id}',NULL),
('gcid:mortgage_broker','Bankrate broker profile','profile_bankrate','profiles_presence','etl','Person','sameAs',FALSE,35,3,'bankrate.com/mortgages/brokers/{id}',NULL),
('gcid:mortgage_broker','Yelp listing','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,20,4,'yelp.com/biz/{slug}',NULL),
('gcid:mortgage_broker','Loan volume (aggregate)','txn_volume','transactions_outcomes','manual','Service','provider',FALSE,40,1,NULL,'Annual origination volume — no borrower PII'),
('gcid:mortgage_broker','Loan programs offered','txn_programs','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,'FHA, VA, jumbo, non-QM, etc.'),
('gcid:mortgage_broker','States licensed in','txn_states','transactions_outcomes','manual','Service','areaServed',FALSE,20,2,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:mortgage_broker','profession_title','Mortgage Broker','mortgage-broker-title','Mortgage Broker','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','profession_title','NMLS Licensed Mortgage Broker','nmls-mortgage-broker','NMLS Licensed Mortgage Broker','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','profession_title','Independent Mortgage Broker','independent-mb','Independent Mortgage Broker','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','specialization','VA Loan Specialist','va-loan-mb','VA Loan Specialist','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','specialization','Non-QM / Bank Statement Loans','non-qm-mb','Non-QM / Bank Statement Loans','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','specialization','Jumbo Loan Specialist','jumbo-mb','Jumbo Loan Specialist','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','specialization','FHA Loan Specialist','fha-mb','FHA Loan Specialist','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','specialization','Investment Property / DSCR','dscr-mb','Investment Property / DSCR','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','specialization','Self-Employed Borrower Specialist','self-employed-mb','Self-Employed Borrower Specialist','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','product_service','Purchase Mortgage','purchase-mortgage-mb','Purchase Mortgage','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','product_service','Refinance','refinance-mb','Refinance','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','product_service','VA Loan','va-loan-mb-svc','VA Loan','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','product_service','FHA Loan','fha-loan-mb-svc','FHA Loan','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','product_service','Non-QM Loan','non-qm-svc','Non-QM Loan','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','topic','Broker vs Bank — Who Gets You the Better Rate?','broker-vs-bank','Broker vs Bank — Who Gets You the Better Rate?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','topic','Non-QM Loans — Who Are They For?','non-qm-who','Non-QM Loans — Who Are They For?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','topic','Bank Statement Loans for Self-Employed Borrowers','bank-statement-loans','Bank Statement Loans for Self-Employed Borrowers','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','tag','NMLS licensed','nmls-licensed','NMLS Licensed','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','tag','wholesale rates','wholesale-rates','Wholesale Rates','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','tag','non-QM specialist','non-qm-specialist','Non-QM Specialist','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','keyword','mortgage broker near me','mortgage-broker-near-me','Mortgage broker near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:mortgage_broker','keyword','best mortgage broker','best-mortgage-broker','Best mortgage broker','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:mortgage_broker','keyword','non-QM mortgage lender','non-qm-lender-kw','Non-QM mortgage lender','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:mortgage_broker','question','What is the difference between a mortgage broker and a bank?','broker-vs-bank-q','What is the difference between a mortgage broker and a bank?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','question','How do mortgage brokers get paid?','broker-compensation','How do mortgage brokers get paid?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mortgage_broker','question','Can a mortgage broker get me a better rate?','broker-better-rate','Can a mortgage broker get me a better rate?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
