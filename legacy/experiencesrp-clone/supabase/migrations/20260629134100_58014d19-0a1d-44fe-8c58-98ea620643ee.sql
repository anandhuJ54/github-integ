-- ============================================================
-- SEED: Financial Advisor vertical (gcid:financial_advisor)
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
WHERE gcid = 'gcid:financial_advisor';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:financial_advisor', 'professional', 'professional', 'active',
  ARRAY['AUM', 'portfolio', 'diversification', 'asset allocation', 'risk tolerance', 'fiduciary', 'fee-only', 'Series 7', 'Series 65', 'Series 66', 'RIA', 'broker-dealer', 'securities', 'equities', 'fixed income', 'ETF', 'mutual fund', '401k', 'IRA', 'Roth IRA', 'annuity', 'rebalancing', 'market timing', 'alpha', 'beta', 'Sharpe ratio'],
  '["Investment portfolio management","Retirement planning","Tax-efficient investing","Estate planning coordination","Insurance analysis","College savings planning","Wealth management","Social Security optimization","Charitable giving strategies","Business owner financial planning","Employee benefits guidance","Risk management"]'::jsonb,
  ARRAY['FINRA advertising rules', 'SEC Investment Adviser Act', 'Fiduciary standard for RIAs', 'No guaranteed return on investment', 'Risk disclosure required', 'Past performance disclaimer', 'GLBA privacy notice required', 'Material conflicts of interest must be disclosed', 'Form ADV disclosure', 'No cherry-picking performance data'],
  '["Researching financial help / robo-advisors vs advisors","Initial discovery call / financial review","Formalize relationship / open accounts","Investment plan development","Implementation and account funding","Ongoing monitoring and rebalancing","Annual review / life event updates"]'::jsonb,
  '{"primary":["CFP or CFA designation","FINRA BrokerCheck record (no disciplinary history)","AUM / years in business","Client reviews","Fee transparency"],"secondary":["Specialization (retirement, business owners)","Geographic focus","Access and responsiveness","Portfolio performance vs benchmark"]}'::jsonb,
  ARRAY['helped me plan for retirement', 'transparent about fees', 'explains complex concepts simply', 'grew my portfolio', 'trusts my financial goals', 'proactive with advice', 'no high-pressure sales', 'listens to my situation', 'honest about market risks', 'I can finally retire confidently'],
  ARRAY['How to choose a financial advisor', 'Fee-only vs commission-based advisors', 'What is a fiduciary and why it matters', 'Retirement planning at every age', 'How to read your investment statement', 'Market volatility — stay the course', 'Tax-loss harvesting explained', 'Dollar-cost averaging strategy', 'Roth vs traditional IRA — which is better?', 'How to retire early', 'Social Security claiming strategies', 'Protecting your portfolio in a downturn', 'Estate planning basics', 'How much do you need to retire?', 'Investment risk tolerance quiz guide'],
  '{"primary":["CFP (Certified Financial Planner)","CFA (Chartered Financial Analyst)","FINRA BrokerCheck clean record","SEC-registered RIA"],"secondary":["AUM under management","Years in practice","Specialized client focus","Published financial content"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.22,"credentials":0.2,"license_verified":0.18,"content_freshness":0.13,"schema_completeness":0.1}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"trustworthy","compliance":"FINRA_SEC"},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"financial_advisory"},"content_assistant":{"enabled":true,"topics":["retirement planning","investing basics","market updates"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:financial_advisor',
  TRUE, TRUE,
  TRUE, FALSE,
  'CRD #{license_number}', 'FINRA CRD Number',
  ARRAY['CRD #{license_number} | [Firm Name] is a [Registered Investment Advisor / FINRA member]', 'Past performance is not indicative of future results', 'Investing involves risk, including possible loss of principal', '[Firm Name] is required to provide you with a Form ADV — please ask for a copy'],
  ARRAY['no guaranteed returns', 'no risk-free investment claims', 'past performance disclaimer required', 'material conflicts of interest must be disclosed'],
  ARRAY['guaranteed returns', 'risk-free investment', 'can''t lose money', 'double your money', 'beat the market guaranteed', 'safe investment with high returns'],
  FALSE, FALSE, TRUE,
  ARRAY['FINRA', 'SEC (for RIAs)', 'State securities regulators', 'CFPB (consumer protection)'],
  'Financial advisors face dual regulation: broker-dealers are regulated by FINRA (suitability standard), RIAs by the SEC (fiduciary standard). GLBA requires annual privacy notice. All advertising must include past-performance disclaimers. No guaranteed return language under any circumstances.'
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
('gcid:financial_advisor','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:financial_advisor','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:financial_advisor','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:financial_advisor','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:financial_advisor','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:financial_advisor','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:financial_advisor','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:financial_advisor','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:financial_advisor','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:financial_advisor','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:financial_advisor','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:financial_advisor','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:financial_advisor','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:financial_advisor','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:financial_advisor','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:financial_advisor','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:financial_advisor','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:financial_advisor','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:financial_advisor','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:financial_advisor','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:financial_advisor','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:financial_advisor','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:financial_advisor','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:financial_advisor','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:financial_advisor','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:financial_advisor','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:financial_advisor','CFP certification','auth_cfp','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,60,1,'cfp.net/verify','Certified Financial Planner — verify at cfp.net'),
('gcid:financial_advisor','CFA designation','auth_cfa','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,60,2,NULL,'Chartered Financial Analyst'),
('gcid:financial_advisor','FINRA BrokerCheck','auth_brokercheck','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,'brokercheck.finra.org/individual/{crd}','Primary credential verification — no disciplinary actions'),
('gcid:financial_advisor','SEC IAPD registration','auth_sec_iapd','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,80,1,'adviserinfo.sec.gov/individual/{crd}','For RIAs — Investment Adviser Public Disclosure'),
('gcid:financial_advisor','NAPFA membership','auth_napfa','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,40,3,'napfa.org/find-an-advisor/{id}','National Association of Personal Financial Advisors — fee-only advisors'),
('gcid:financial_advisor','FINRA BrokerCheck profile','profile_brokercheck','profiles_presence','etl','Person','sameAs',TRUE,70,1,'brokercheck.finra.org/individual/{crd}','Regulatory profile — public must be able to verify'),
('gcid:financial_advisor','SEC IAPD profile','profile_sec_iapd','profiles_presence','etl','Person','sameAs',FALSE,60,1,'adviserinfo.sec.gov/individual/{crd}','For RIA-only advisors'),
('gcid:financial_advisor','SmartAsset advisor profile','profile_smartasset','profiles_presence','etl','Person','sameAs',FALSE,40,2,'smartasset.com/financial-advisor/{id}',NULL),
('gcid:financial_advisor','Bankrate profile','profile_bankrate','profiles_presence','etl','Person','sameAs',FALSE,30,3,'bankrate.com/advisors/{id}',NULL),
('gcid:financial_advisor','Wealthtender profile','profile_wealthtender','profiles_presence','etl','Person','sameAs',FALSE,30,3,'wealthtender.com/financial-advisors/{id}',NULL),
('gcid:financial_advisor','AUM under management','txn_aum','transactions_outcomes','manual','Service','provider',FALSE,40,1,NULL,'Aggregate AUM — no client account details'),
('gcid:financial_advisor','Client household count','txn_clients','transactions_outcomes','manual','Service','provider',FALSE,30,2,NULL,NULL),
('gcid:financial_advisor','Investment specializations','txn_specializations','transactions_outcomes','manual','Service','serviceType',FALSE,20,3,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:financial_advisor','profession_title','Financial Advisor','financial-advisor','Financial Advisor','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','profession_title','Investment Advisor','investment-advisor','Investment Advisor','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','profession_title','Wealth Manager','wealth-manager','Wealth Manager','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','profession_title','Portfolio Manager','portfolio-manager','Portfolio Manager','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','profession_title','Registered Investment Advisor','registered-investment-advisor','Registered Investment Advisor','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','specialization','Retirement Planning Specialist','retirement-planning-specialist','Retirement Planning Specialist','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','specialization','High-Net-Worth Wealth Management','high-net-worth','High-Net-Worth Wealth Management','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','specialization','Business Owner Financial Planning','business-owner-planning','Business Owner Financial Planning','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','specialization','Fee-Only Fiduciary','fee-only-fiduciary','Fee-Only Fiduciary','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','specialization','ESG / Socially Responsible Investing','esg-investing','ESG / Socially Responsible Investing','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','specialization','Tax-Efficient Investing','tax-efficient-investing','Tax-Efficient Investing','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','product_service','Investment Portfolio Management','portfolio-management','Investment Portfolio Management','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','product_service','Retirement Planning','retirement-planning','Retirement Planning','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','product_service','Financial Plan Development','financial-plan','Financial Plan Development','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','product_service','Tax-Efficient Investing','tax-efficient-investing-svc','Tax-Efficient Investing','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','product_service','Estate Planning Coordination','estate-planning-coord','Estate Planning Coordination','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','topic','How to Choose a Financial Advisor','how-to-choose-financial-advisor','How to Choose a Financial Advisor','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','topic','Fee-Only vs Commission-Based Advisors','fee-only-vs-commission','Fee-Only vs Commission-Based Advisors','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','topic','What Is a Fiduciary?','what-is-fiduciary','What Is a Fiduciary?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','topic','Retirement Planning at Every Age','retirement-planning-by-age','Retirement Planning at Every Age','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','tag','fiduciary','fiduciary-tag','Fiduciary','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','tag','fee-only','fee-only-tag','Fee-Only','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','tag','CFP','cfp-tag','CFP','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','keyword','financial advisor near me','financial-advisor-near-me','Financial advisor near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:financial_advisor','keyword','fee-only financial advisor','fee-only-fa-kw','Fee-only financial advisor','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:financial_advisor','keyword','fiduciary financial advisor','fiduciary-fa-kw','Fiduciary financial advisor','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:financial_advisor','question','What does a financial advisor charge?','fa-cost','What does a financial advisor charge?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','question','What is the difference between a broker and an RIA?','broker-vs-ria','What is the difference between a broker and an RIA?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_advisor','question','How much money do I need to work with a financial advisor?','fa-minimum','How much money do I need to work with a financial advisor?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
