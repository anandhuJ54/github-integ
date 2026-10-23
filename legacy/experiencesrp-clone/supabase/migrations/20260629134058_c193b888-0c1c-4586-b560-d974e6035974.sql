-- ============================================================
-- SEED: Immigration Attorney vertical (gcid:immigration_attorney)
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
WHERE gcid = 'gcid:immigration_attorney';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:immigration_attorney', 'professional', 'professional', 'active',
  ARRAY['visa', 'green card', 'citizenship', 'naturalization', 'deportation', 'removal', 'asylum', 'USCIS', 'I-485', 'I-130', 'petition', 'affidavit of support', 'priority date', 'adjustment of status', 'consular processing', 'EAD', 'work permit', 'DACA', 'TPS', 'I-94', 'NTA', 'immigration court', 'BIA', 'EOIR'],
  '["Family-based immigration","Employment-based visas","Green card applications","Citizenship & naturalization","Asylum applications","DACA renewals","Deportation defense","Removal proceedings","Business immigration (H-1B, L-1, O-1)","Consular processing","Appeals to BIA","USCIS appeals"]'::jsonb,
  ARRAY['State bar advertising rules', 'EOIR rules on accredited representatives', 'No guarantee of visa approval', 'No unauthorized practice of immigration law', 'UPL rules against notarios', 'No misleading claims about processing times', 'Must not solicit disaster victims (state bar rules)'],
  '["Researching immigration options / status","Initial consultation / case eligibility assessment","Retaining attorney / engagement letter","Preparation and filing of petitions","Government processing period","Interview preparation (if required)","Approval / next steps or appeal"]'::jsonb,
  '{"primary":["AILA membership","State bar standing","EOIR accreditation","Success rate with USCIS / immigration courts","Client reviews"],"secondary":["Languages spoken","Years of immigration experience","Specific visa category expertise","Geographic representation"]}'::jsonb,
  ARRAY['helped my family stay together', 'got my green card approved', 'navigated the process for me', 'responsive to my questions', 'clear about the timeline', 'fought my deportation case', 'honest about my chances', 'speaks my language', 'trusted advisor', 'life-changing help'],
  ARRAY['How to apply for a green card', 'Family-based vs employment-based immigration', 'What is the path to US citizenship?', 'DACA — current status and renewals', 'H-1B visa guide for employers', 'Asylum — who qualifies?', 'What happens at a USCIS interview', 'Deportation defense options', 'Processing times for common immigration applications', 'Common reasons visas are denied', 'Bringing a spouse or parent to the US', 'Investing in the US — EB-5 visa', 'How to appeal a USCIS denial', 'TPS countries and eligibility', 'Green card through marriage — step by step'],
  '{"primary":["AILA (American Immigration Lawyers Association) membership","State bar in good standing","BIA accreditation (for non-attorneys)","Published immigration law articles"],"secondary":["Languages spoken","Board of Immigration Appeals experience","Success with specific visa categories","EOIR representation history"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.24,"credentials":0.18,"license_verified":0.15,"content_freshness":0.14,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"empathetic","compliance":"state_bar"},"receptionist":{"enabled":true,"languages":["en","es","zh","pt","tl"]},"review_responder":{"enabled":true,"vocabulary":"immigration"},"content_assistant":{"enabled":true,"topics":["visa guides","citizenship","deportation defense"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:immigration_attorney',
  TRUE, TRUE,
  TRUE, FALSE,
  'Bar No. {license_number}', 'State Bar Number',
  ARRAY['Licensed attorney in [State] | Bar No. {license_number}', 'USCIS approval is not guaranteed — visa decisions are made by USCIS / consular officers'],
  ARRAY['no guaranteed visa approvals', 'no guaranteed processing times', 'no notario-style advertising', 'must distinguish attorney from accredited representative'],
  ARRAY['guaranteed visa', 'guaranteed green card', '100% approval rate', 'fastest immigration service', 'cheap immigration help'],
  FALSE, FALSE, FALSE,
  ARRAY['State Bar Association', 'EOIR (Board of Immigration Appeals)', 'USCIS', 'Department of Justice'],
  'Immigration attorneys must be licensed in their state bar. Accredited representatives may practice under EOIR accreditation. Notarios practicing unauthorized law is a persistent issue — avoid any language that could be misconstrued as guaranteeing government approval.'
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
('gcid:immigration_attorney','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:immigration_attorney','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:immigration_attorney','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:immigration_attorney','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:immigration_attorney','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:immigration_attorney','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:immigration_attorney','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:immigration_attorney','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:immigration_attorney','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:immigration_attorney','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:immigration_attorney','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:immigration_attorney','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:immigration_attorney','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:immigration_attorney','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:immigration_attorney','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:immigration_attorney','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:immigration_attorney','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:immigration_attorney','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:immigration_attorney','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:immigration_attorney','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:immigration_attorney','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:immigration_attorney','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:immigration_attorney','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:immigration_attorney','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:immigration_attorney','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:immigration_attorney','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:immigration_attorney','State bar license','auth_bar_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'Required for all attorney practice'),
('gcid:immigration_attorney','AILA membership','auth_aila','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,40,2,'aila.org/find-an-immigration-lawyer/{id}','American Immigration Lawyers Association'),
('gcid:immigration_attorney','BIA accreditation','auth_bia','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,60,2,NULL,'Required for non-attorney representatives'),
('gcid:immigration_attorney','EOIR registration','auth_eoir','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,40,3,NULL,'EOIR attorney roster'),
('gcid:immigration_attorney','Avvo profile','profile_avvo','profiles_presence','etl','Person','sameAs',TRUE,60,1,'avvo.com/attorneys/{id}',NULL),
('gcid:immigration_attorney','Martindale-Hubbell profile','profile_martindale','profiles_presence','etl','Person','sameAs',TRUE,50,2,'martindale.com/find-lawyers/{id}',NULL),
('gcid:immigration_attorney','AILA attorney finder','profile_aila_finder','profiles_presence','etl','Person','sameAs',FALSE,50,2,'aila.org/find-an-immigration-lawyer/{id}',NULL),
('gcid:immigration_attorney','Languages spoken','auth_languages','verifiable_authority','manual','Person','knowsLanguage',FALSE,30,3,NULL,'Critical differentiator for immigration clients'),
('gcid:immigration_attorney','Visa category coverage','txn_visa_types','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,NULL),
('gcid:immigration_attorney','Geographic jurisdictions','txn_jurisdictions','transactions_outcomes','manual','Service','areaServed',FALSE,20,3,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:immigration_attorney','profession_title','Immigration Attorney','immigration-attorney','Immigration Attorney','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','profession_title','Immigration Lawyer','immigration-lawyer','Immigration Lawyer','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','profession_title','Deportation Defense Attorney','deportation-defense-attorney','Deportation Defense Attorney','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','specialization','Family-Based Immigration','family-based-immigration','Family-Based Immigration','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','specialization','Employment-Based Immigration','employment-based-immigration','Employment-Based Immigration','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','specialization','Deportation Defense','deportation-defense','Deportation Defense','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','specialization','Asylum & Refugee Law','asylum-refugee','Asylum & Refugee Law','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','specialization','Business Immigration','business-immigration','Business Immigration','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','specialization','DACA & TPS','daca-tps','DACA & TPS','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','specialization','Citizenship & Naturalization','citizenship-naturalization','Citizenship & Naturalization','claude_generated',7,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','product_service','Green Card Application','green-card-application','Green Card Application','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','product_service','Visa Petition Filing','visa-petition-filing','Visa Petition Filing','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','product_service','Deportation Defense','deportation-defense-svc','Deportation Defense','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','product_service','Asylum Application','asylum-application','Asylum Application','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','product_service','Citizenship Application','citizenship-application','Citizenship Application','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','topic','How to Apply for a Green Card','how-to-apply-green-card','How to Apply for a Green Card','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','topic','Path to US Citizenship','path-to-us-citizenship','Path to US Citizenship','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','topic','DACA Renewals — What You Need to Know','daca-renewals','DACA Renewals — What You Need to Know','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','tag','deportation defense','deportation-defense-tag','Deportation Defense','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','tag','green card attorney','green-card-attorney','Green Card Attorney','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','tag','visa help','visa-help','Visa Help','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','keyword','immigration attorney near me','immigration-attorney-near-me','Immigration attorney near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:immigration_attorney','keyword','green card lawyer','green-card-lawyer','Green card lawyer','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:immigration_attorney','keyword','deportation lawyer','deportation-lawyer','Deportation lawyer','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:immigration_attorney','question','How long does a green card take?','how-long-green-card','How long does a green card take?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','question','What is the difference between a visa and a green card?','visa-vs-green-card','What is the difference between a visa and a green card?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:immigration_attorney','question','Can I appeal a visa denial?','appeal-visa-denial','Can I appeal a visa denial?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
