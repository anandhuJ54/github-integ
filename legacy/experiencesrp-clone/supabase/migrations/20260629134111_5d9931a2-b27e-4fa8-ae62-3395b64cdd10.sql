-- ============================================================
-- SEED: Accountant vertical (gcid:accountant)
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
WHERE gcid = 'gcid:accountant';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:accountant', 'both', 'professional', 'active',
  ARRAY['CPA', 'bookkeeping', 'tax return', 'audit', 'GAAP', 'accrual', 'cash basis', 'balance sheet', 'P&L', 'depreciation', 'amortization', 'payroll', '1040', '1120', 'Schedule C', 'W-2', '1099', 'estimated taxes', 'deduction', 'tax credit', 'IRS', 'state tax', 'quarterly filing', 'QuickBooks', 'Xero', 'Chart of Accounts', 'reconciliation', 'internal controls'],
  '["Tax preparation (individual & business)","Bookkeeping","Financial statement preparation","Payroll processing","IRS representation","Business advisory","Audit & review","QuickBooks setup and training","Nonprofit accounting","Estate and trust returns","Business formation accounting","Sales tax compliance"]'::jsonb,
  ARRAY['AICPA Code of Professional Conduct', 'IRS Circular 230', 'State CPA board requirements', 'Independence requirements for attest services', 'Client confidentiality (CPA privilege)', 'GLBA data protection', 'No guarantee of specific tax refund amounts', 'Advertising must not be misleading about credentials'],
  '["Tax season trigger / business accounting need","Referral or online search","Initial consultation / scope of engagement","Engagement letter and data gathering","Service delivery (filing, books, audit)","Delivery and review meeting","Ongoing retainer or next-cycle setup"]'::jsonb,
  '{"primary":["CPA license in good standing","Specialization (small business, real estate, crypto)","Availability during tax season","Client reviews","Pricing transparency"],"secondary":["Tax software expertise","Industry focus","Years of experience","Firm size","Multi-state capabilities"]}'::jsonb,
  ARRAY['saved me money on taxes', 'organized my books', 'always available during tax season', 'explained deductions I didn''t know about', 'responsive and professional', 'stress-free tax season', 'helped grow my business', 'accurate and thorough', 'honest and trustworthy', 'recommended to all my friends'],
  ARRAY['Tax deductions every small business owner should claim', 'How to choose a CPA for your small business', 'Quarterly estimated taxes — how they work', 'Bookkeeping best practices for entrepreneurs', 'Home office deduction explained', 'S-corp vs LLC — which is right for you?', 'How to prepare for a tax audit', 'Understanding your balance sheet', 'QuickBooks vs Xero — which is better?', 'Year-end tax planning moves', 'What records to keep for your taxes', 'Payroll taxes for small businesses', 'Crypto tax reporting guide', 'How to read a profit and loss statement', 'When to upgrade from DIY taxes to a CPA'],
  '{"primary":["CPA license in good standing","AICPA membership","State CPA society membership","Specialization certifications (ABV, PFS, CITP)"],"secondary":["Industry focus (real estate, healthcare, nonprofit)","Software certifications (QB ProAdvisor)","Published tax guides","Client retention rate"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.24,"license_verified":0.18,"specialization":0.16,"content_freshness":0.14,"schema_completeness":0.11}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"professional","compliance":"AICPA_Circular230"},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"accounting"},"content_assistant":{"enabled":true,"topics":["tax tips","small business finance","bookkeeping"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:accountant',
  TRUE, TRUE,
  TRUE, FALSE,
  'CPA #{license_number}', 'CPA License',
  ARRAY['CPA #{license_number} | Licensed in [State]', 'This content is for general information and does not constitute tax advice', 'Individual tax situations vary — consult a CPA for personalized guidance'],
  ARRAY['no guaranteed refund amounts', 'no guaranteed audit outcomes', 'Circular 230 compliance for tax advice', 'no misleading credential claims'],
  ARRAY['guaranteed refund', 'guaranteed tax savings', 'no IRS problems guaranteed', 'biggest refund guaranteed', 'cheapest tax preparation'],
  FALSE, FALSE, TRUE,
  ARRAY['State CPA Board', 'AICPA', 'IRS (Circular 230)', 'PCAOB (if public company audits)'],
  'CPAs are bound by AICPA Code of Professional Conduct and IRS Circular 230 for tax practice. No guarantees of refund amounts. Independence required for attest engagements. GLBA governs data protection for financial records.'
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
('gcid:accountant','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:accountant','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:accountant','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:accountant','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:accountant','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:accountant','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:accountant','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:accountant','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:accountant','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:accountant','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:accountant','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:accountant','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:accountant','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:accountant','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:accountant','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:accountant','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:accountant','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:accountant','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:accountant','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:accountant','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:accountant','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:accountant','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:accountant','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:accountant','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:accountant','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:accountant','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:accountant','CPA state license','auth_cpa_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'State CPA board — primary credential'),
('gcid:accountant','AICPA membership','auth_aicpa','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,40,2,NULL,'American Institute of CPAs'),
('gcid:accountant','EA — Enrolled Agent status','auth_ea','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,50,2,'irs.gov/tax-professionals/verify-the-status-of-an-enrolled-agent/{id}','IRS-authorized tax practitioners'),
('gcid:accountant','QuickBooks ProAdvisor','auth_qb_proadvisor','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,20,4,'quickbooks.intuit.com/find-an-accountant/{id}',NULL),
('gcid:accountant','AICPA directory','profile_aicpa_dir','profiles_presence','etl','Person','sameAs',FALSE,40,2,'findacpa.org/{id}',NULL),
('gcid:accountant','QuickBooks Find an Accountant','profile_qb','profiles_presence','etl','Person','sameAs',FALSE,30,3,'quickbooks.intuit.com/find-an-accountant/{id}',NULL),
('gcid:accountant','Yelp business listing','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,25,4,'yelp.com/biz/{slug}',NULL),
('gcid:accountant','Tax specialty areas','txn_specialties','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,NULL),
('gcid:accountant','Industries served','txn_industries','transactions_outcomes','manual','Service','serviceType',FALSE,20,3,NULL,NULL),
('gcid:accountant','Software expertise','txn_software','transactions_outcomes','manual','Service','serviceType',FALSE,10,4,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:accountant','profession_title','CPA','cpa','CPA (Certified Public Accountant)','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','profession_title','Accountant','accountant-title','Accountant','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','profession_title','Tax Accountant','tax-accountant','Tax Accountant','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','profession_title','Bookkeeper','bookkeeper','Bookkeeper','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','specialization','Small Business Accounting','small-business-accounting','Small Business Accounting','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','specialization','Real Estate Accounting','real-estate-accounting','Real Estate Accounting','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','specialization','Nonprofit Accounting','nonprofit-accounting','Nonprofit Accounting','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','specialization','Tax Planning & Strategy','tax-planning','Tax Planning & Strategy','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','specialization','Business Valuation','business-valuation','Business Valuation','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','specialization','Audit & Assurance','audit-assurance','Audit & Assurance','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','product_service','Tax Preparation','tax-preparation','Tax Preparation','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','product_service','Bookkeeping','bookkeeping-svc','Bookkeeping','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','product_service','Financial Statement Preparation','financial-statements','Financial Statement Preparation','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','product_service','Payroll Processing','payroll','Payroll Processing','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','product_service','IRS Representation','irs-representation','IRS Representation','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','topic','Tax Deductions Every Small Business Should Claim','small-biz-deductions','Tax Deductions Every Small Business Should Claim','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','topic','How to Choose a CPA','how-to-choose-cpa','How to Choose a CPA','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','topic','Quarterly Estimated Taxes Explained','quarterly-taxes','Quarterly Estimated Taxes Explained','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','tag','tax season','tax-season-tag','Tax Season','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','tag','small business CPA','small-biz-cpa','Small Business CPA','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','tag','QuickBooks certified','qb-certified','QuickBooks Certified','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:accountant','keyword','CPA near me','cpa-near-me','CPA near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:accountant','keyword','small business accountant','small-biz-accountant','Small business accountant','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:accountant','keyword','tax accountant near me','tax-accountant-near-me','Tax accountant near me','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:accountant','question','How much does a CPA cost?','cpa-cost','How much does a CPA cost?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','question','What is the difference between a CPA and a bookkeeper?','cpa-vs-bookkeeper','What is the difference between a CPA and a bookkeeper?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:accountant','question','Do I need a CPA or can I use TurboTax?','cpa-vs-turbotax','Do I need a CPA or can I use TurboTax?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
