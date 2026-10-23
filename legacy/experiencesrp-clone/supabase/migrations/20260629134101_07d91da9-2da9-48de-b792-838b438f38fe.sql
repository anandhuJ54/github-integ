-- ============================================================
-- SEED: Financial Planner vertical (gcid:financial_planner)
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
WHERE gcid = 'gcid:financial_planner';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:financial_planner', 'professional', 'professional', 'active',
  ARRAY['comprehensive financial plan', 'net worth', 'cash flow', 'budget', 'debt management', 'emergency fund', 'insurance analysis', 'estate plan', 'tax planning', 'college savings', '529 plan', 'disability insurance', 'life insurance', 'Social Security', 'Medicare', 'beneficiary', 'power of attorney', 'living will', 'revocable trust', 'irrevocable trust', 'charitable giving', 'SECURE Act', 'RMD', 'catch-up contribution'],
  '["Comprehensive financial planning","Retirement income planning","Debt management strategy","Insurance needs analysis","College funding planning","Tax planning coordination","Estate planning guidance","Cash flow & budgeting","Employee benefits optimization","Social Security strategy","Life transition planning","Business succession planning"]'::jsonb,
  ARRAY['CFP Board Standards of Conduct', 'Fiduciary duty to clients', 'Fee disclosure (CFP Ethics Rule)', 'FINRA advertising rules (if securities licensed)', 'No guaranteed outcomes', 'Conflicts of interest must be disclosed in writing', 'Form CRS (client relationship summary) required if RIA'],
  '["Seeking financial clarity / life event trigger","Discovery meeting / financial health review","Engagement letter & data gathering","Financial plan development","Plan delivery & implementation","Ongoing monitoring (quarterly check-ins)","Annual plan update / life event revisions"]'::jsonb,
  '{"primary":["CFP certification (CFP Board)","FINRA BrokerCheck clean record","Client-to-planner ratio (accessibility)","Comprehensive planning vs product-focused","Reviews and referrals"],"secondary":["Years of experience","Specialization focus","Fee model transparency","Access and responsiveness"]}'::jsonb,
  ARRAY['helped me see the big financial picture', 'got my finances organized', 'no-pressure advice', 'explained everything clearly', 'helped me plan for my kids college', 'comprehensive and caring', 'proactive with life changes', 'feels like a trusted advisor', 'helped me pay off debt', 'finally have a plan'],
  ARRAY['Building a financial plan from scratch', 'The 50/30/20 budget rule explained', 'How to build an emergency fund', 'Life insurance — how much do you need?', '529 college savings plans explained', 'When to start Social Security', 'Understanding your employee benefits', 'Tax planning moves before year-end', 'How to pay off debt faster', 'What does estate planning really mean?', 'Protecting your income with disability insurance', 'Financial planning for newlyweds', 'Money milestones by age', 'Retirement accounts: 401k vs IRA vs Roth', 'How to find a fee-only financial planner'],
  '{"primary":["CFP certification","FINRA BrokerCheck clean record","Comprehensive planning approach (not product-focused)","Fee transparency"],"secondary":["Specialization in life stage (young professionals, retirees)","Published financial content","Years of planning experience"]}'::jsonb,
  '{"profile_completeness":0.18,"review_volume":0.22,"credentials":0.2,"license_verified":0.17,"content_freshness":0.13,"schema_completeness":0.1}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"approachable","compliance":"CFP_FINRA"},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"financial_planning"},"content_assistant":{"enabled":true,"topics":["retirement","budgeting","insurance","estate planning"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:financial_planner',
  TRUE, TRUE,
  TRUE, FALSE,
  'CFP #{license_number}', 'CFP Certification Number',
  ARRAY['CFP #{license_number} — Certified Financial Planner', 'Financial planning involves risk — past performance does not guarantee future results', '[Firm Name] Form ADV available upon request'],
  ARRAY['no guaranteed outcomes', 'past performance disclaimers required', 'conflicts of interest must be disclosed', 'fee model must be accurate'],
  ARRAY['guaranteed financial success', 'risk-free plan', 'get rich', 'guaranteed retirement income', 'best financial planner guaranteed'],
  FALSE, FALSE, TRUE,
  ARRAY['CFP Board', 'FINRA (if securities licensed)', 'SEC (if RIA)', 'State securities regulators'],
  'CFP certificants are bound by CFP Board''s fiduciary standard for financial planning engagements. Advertising must not imply guaranteed outcomes. Fee model (fee-only, fee-based, commission) must be accurately disclosed to clients.'
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
('gcid:financial_planner','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:financial_planner','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:financial_planner','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:financial_planner','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:financial_planner','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:financial_planner','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:financial_planner','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:financial_planner','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:financial_planner','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:financial_planner','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:financial_planner','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:financial_planner','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:financial_planner','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:financial_planner','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:financial_planner','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:financial_planner','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:financial_planner','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:financial_planner','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:financial_planner','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:financial_planner','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:financial_planner','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:financial_planner','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:financial_planner','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:financial_planner','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:financial_planner','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:financial_planner','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:financial_planner','CFP certification (CFP Board)','auth_cfp','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,'cfp.net/verify','Primary credential — verify at CFP Board'),
('gcid:financial_planner','FINRA BrokerCheck','auth_brokercheck','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,70,2,'brokercheck.finra.org/individual/{crd}','Required if securities licensed'),
('gcid:financial_planner','ChFC / RICP designation','auth_chfc','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,30,3,NULL,'Chartered Financial Consultant / Retirement Income Certified Professional'),
('gcid:financial_planner','NAPFA membership','auth_napfa','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,40,2,'napfa.org/find-an-advisor/{id}','Fee-only advisors only'),
('gcid:financial_planner','XY Planning Network','auth_xypn','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,30,3,'xyplanningnetwork.com/find-an-advisor/{id}','Fee-only, next-gen planners'),
('gcid:financial_planner','CFP Board planner search','profile_cfpboard','profiles_presence','etl','Person','sameAs',TRUE,60,1,'cfp.net/verify','Primary directory for CFP verification'),
('gcid:financial_planner','NAPFA directory','profile_napfa','profiles_presence','etl','Person','sameAs',FALSE,45,2,'napfa.org/find-an-advisor/{id}',NULL),
('gcid:financial_planner','SmartAsset profile','profile_smartasset','profiles_presence','etl','Person','sameAs',FALSE,40,2,'smartasset.com/financial-advisor/{id}',NULL),
('gcid:financial_planner','Wealthtender profile','profile_wealthtender','profiles_presence','etl','Person','sameAs',FALSE,30,3,'wealthtender.com/financial-advisors/{id}',NULL),
('gcid:financial_planner','Client household count','txn_clients','transactions_outcomes','manual','Service','provider',FALSE,30,2,NULL,NULL),
('gcid:financial_planner','Planning specializations','txn_specializations','transactions_outcomes','manual','Service','serviceType',FALSE,20,3,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:financial_planner','profession_title','Financial Planner','financial-planner','Financial Planner','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','profession_title','Certified Financial Planner','certified-financial-planner','Certified Financial Planner (CFP)','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','profession_title','Personal Financial Planner','personal-financial-planner','Personal Financial Planner','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','profession_title','Retirement Planner','retirement-planner','Retirement Planner','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','specialization','Retirement Income Planning','retirement-income','Retirement Income Planning','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','specialization','Young Professionals','young-professionals','Young Professionals','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','specialization','Women & Money','women-and-money','Women & Money','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','specialization','Business Owner Planning','business-owner','Business Owner Planning','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','specialization','Divorce Financial Planning','divorce-financial','Divorce Financial Planning','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','specialization','Estate Planning Coordination','estate-planning','Estate Planning Coordination','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','product_service','Comprehensive Financial Plan','comprehensive-plan','Comprehensive Financial Plan','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','product_service','Retirement Income Plan','retirement-income-plan','Retirement Income Plan','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','product_service','College Funding Plan','college-funding','College Funding Plan','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','product_service','Insurance Needs Analysis','insurance-analysis','Insurance Needs Analysis','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','product_service','Social Security Optimization','social-security-opt','Social Security Optimization','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','topic','Building a Financial Plan from Scratch','financial-plan-from-scratch','Building a Financial Plan from Scratch','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','topic','How Much Do I Need to Retire?','how-much-to-retire','How Much Do I Need to Retire?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','topic','When to Start Social Security','when-to-start-social-security','When to Start Social Security','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','tag','fee-only','fee-only-fp','Fee-Only','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','tag','CFP','cfp-fp','CFP','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','tag','comprehensive planning','comprehensive-planning','Comprehensive Planning','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:financial_planner','keyword','financial planner near me','financial-planner-near-me','Financial planner near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:financial_planner','keyword','certified financial planner','cfp-kw','Certified financial planner','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:financial_planner','keyword','fee-only financial planner','fee-only-fp-kw','Fee-only financial planner','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:financial_planner','question','How much does a financial planner cost?','fp-cost','How much does a financial planner cost?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','question','What is the difference between a financial planner and financial advisor?','planner-vs-advisor','What is the difference between a financial planner and financial advisor?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:financial_planner','question','Do I need a financial planner or can I do it myself?','diy-vs-planner','Do I need a financial planner or can I do it myself?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
