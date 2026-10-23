-- ============================================================
-- SEED: Family Physician vertical (gcid:doctor)
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
WHERE gcid = 'gcid:doctor';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:doctor', 'both', 'professional', 'active',
  ARRAY['primary care', 'preventive care', 'chronic disease management', 'acute illness', 'annual physical', 'EHR', 'telehealth', 'referral', 'specialist', 'co-pay', 'prior authorization', 'HIPAA', 'PHI', 'PCM', 'EMR', 'formulary', 'in-network', 'out-of-network', 'wellness visit', 'care coordination', 'family medicine', 'internal medicine', 'board certified', 'residency', 'fellowship'],
  '["Annual wellness exams","Sick visit care","Chronic disease management (diabetes, hypertension, asthma)","Preventive screenings","Vaccinations","Minor procedures","Telehealth visits","Prescription management","Referrals to specialists","Women''s health","Men''s health","Pediatric care","Mental health screening","Urgent care"]'::jsonb,
  ARRAY['HIPAA privacy and security rules', 'No sharing of PHI without patient consent', 'No guarantee of specific health outcomes', 'Advertising must not include patient testimonials without written consent', 'Credentialing required for insurance billing', 'State medical board requirements', 'Emergency treatment disclosure'],
  '["Searching for a new doctor / insurance change","Checking insurance acceptance / availability","New patient intake / health history","Annual exam or acute visit","Ongoing care relationship","Specialist referral coordination","Health record transfer"]'::jsonb,
  '{"primary":["Insurance plans accepted","Appointment availability","Patient reviews on Healthgrades / Zocdoc","Board certification","Years of experience"],"secondary":["Telehealth availability","Office hours and location","EHR patient portal","Bedside manner reviews","Same-day appointment availability"]}'::jsonb,
  ARRAY['listens to my concerns', 'explains everything clearly', 'never feels rushed', 'easy to get an appointment', 'takes my insurance', 'warm and professional', 'my family doctor for years', 'follows up promptly', 'easy to reach by portal', 'best doctor I''ve had'],
  ARRAY['When to see your doctor vs urgent care', 'Annual physical — what to expect', 'Managing high blood pressure without medication', 'Diabetes prevention and management', 'Top preventive screenings by age', 'Understanding your lab results', 'How to talk to your doctor about mental health', 'Telehealth — how it works', 'Vaccinations for adults', 'Best foods for heart health', 'Cholesterol explained', 'Managing chronic pain', 'Sleep and your health', 'What your annual blood work tells you', 'Finding a doctor who accepts your insurance'],
  '{"primary":["ABFM / ABIM board certification","NPI registry in good standing","State medical license","Patient satisfaction scores"],"secondary":["Hospital affiliations","Residency program","Years of experience","Telehealth availability","Languages spoken"]}'::jsonb,
  '{"profile_completeness":0.16,"review_volume":0.26,"board_certification":0.16,"license_verified":0.16,"insurance_accepted":0.14,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true,"compliance":"HIPAA"},"review_responder":{"enabled":true,"vocabulary":"healthcare","hipaa_mode":true},"content_assistant":{"enabled":true,"topics":["preventive care","chronic disease","wellness"]},"qa_assistant":{"enabled":true,"hipaa_mode":true}}'::jsonb,
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
  'gcid:doctor',
  TRUE, FALSE,
  FALSE, FALSE,
  'NPI {license_number}', 'Medical License / NPI',
  ARRAY['NPI {license_number} | Licensed in [State]', 'This content is for informational purposes only and does not constitute medical advice', 'Always consult your healthcare provider for personal medical guidance'],
  ARRAY['no specific medical advice in content', 'HIPAA-compliant review responses only', 'no patient PII in any content', 'no testimonials without written consent', 'no guaranteed health outcomes'],
  ARRAY['guaranteed cure', 'guaranteed treatment results', 'best doctor guaranteed', 'treat any disease', 'miracle treatment', '100% effective'],
  FALSE, TRUE, FALSE,
  ARRAY['State Medical Board', 'HIPAA (HHS OCR)', 'CMS (Medicare/Medicaid)', 'Joint Commission (if hospital affiliated)'],
  'HIPAA dominates all content and communication. Patient testimonials require explicit written authorization. Review responses must not confirm or deny patient status. Health content must include a ''not medical advice'' disclaimer. All advertising must comply with state medical board advertising rules.'
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
('gcid:doctor','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:doctor','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:doctor','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:doctor','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:doctor','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:doctor','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:doctor','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:doctor','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:doctor','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:doctor','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:doctor','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:doctor','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:doctor','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:doctor','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:doctor','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:doctor','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:doctor','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:doctor','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:doctor','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:doctor','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:doctor','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:doctor','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:doctor','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:doctor','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:doctor','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:doctor','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:doctor','Medical License / NPI (NPI registry)','auth_npi','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,'npiregistry.cms.hhs.gov/provider-view/{npi}','Primary healthcare credential — NPI registry'),
('gcid:doctor','State medical / professional license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,NULL,'State licensing board verification'),
('gcid:doctor','Board certification','auth_board_cert','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,60,2,NULL,'ABMS or equivalent board certification'),
('gcid:doctor','Hospital affiliations','auth_hospital_affil','verifiable_authority','manual','Organization','worksFor',FALSE,30,3,NULL,NULL),
('gcid:doctor','Medical school & residency','auth_training','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,20,4,NULL,NULL),
('gcid:doctor','Malpractice history (clean)','auth_malpractice','verifiable_authority','etl','Rating','ratingValue',FALSE,40,2,NULL,'Clean record required — state board lookup'),
('gcid:doctor','Healthgrades profile','profile_healthgrades_profile','profiles_presence','etl','Person','sameAs',TRUE,70,1,'healthgrades.com/physician/{id}',NULL),
('gcid:doctor','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',TRUE,60,1,'zocdoc.com/doctor/{id}','Online booking integration available'),
('gcid:doctor','WebMD Physician Profile','profile_webmd','profiles_presence','etl','Person','sameAs',FALSE,40,2,'webmd.com/physician-directory/{id}',NULL),
('gcid:doctor','US News Health profile','profile_us_news','profiles_presence','etl','Person','sameAs',FALSE,35,3,'health.usnews.com/doctors/{id}',NULL),
('gcid:doctor','Doximity profile (physicians)','profile_doximity','profiles_presence','etl','Person','sameAs',FALSE,30,3,'doximity.com/pub/{slug}','Physician-only professional network'),
('gcid:doctor','Patient satisfaction scores','txn_patient_scores','transactions_outcomes','platform','Service','provider',FALSE,50,1,NULL,'HIPAA-compliant aggregate scores only'),
('gcid:doctor','Conditions treated','txn_conditions','transactions_outcomes','manual','MedicalCondition','possibleTreatment',FALSE,30,2,NULL,NULL),
('gcid:doctor','Procedures performed','txn_procedures','transactions_outcomes','manual','MedicalProcedure','provider',FALSE,30,2,NULL,NULL),
('gcid:doctor','Insurance plans accepted','txn_insurance','transactions_outcomes','manual','Service','termsOfService',FALSE,40,1,NULL,'Critical for patient acquisition'),
('gcid:doctor','Vitals.com profile','profile_vitals','profiles_presence','etl','Person','sameAs',FALSE,35,2,'vitals.com/doctors/{id}',NULL),
('gcid:doctor','Castle Connolly profile','profile_castle_connolly','profiles_presence','etl','Person','sameAs',FALSE,35,2,'castleconnolly.com/doctors/{id}',NULL),
('gcid:doctor','RateMDs profile','profile_ratemds','profiles_presence','etl','Person','sameAs',FALSE,35,2,'ratemds.com/doctor/{id}',NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:doctor','profession_title','Family Physician','family-physician','Family Physician','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','profession_title','Primary Care Physician','primary-care-physician','Primary Care Physician','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','profession_title','Family Medicine Doctor','family-medicine-doctor','Family Medicine Doctor','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','profession_title','General Practitioner','general-practitioner','General Practitioner','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','profession_title','Internist','internist','Internist','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','specialization','Preventive Care','preventive-care','Preventive Care','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','specialization','Chronic Disease Management','chronic-disease','Chronic Disease Management','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','specialization','Telehealth Primary Care','telehealth-primary','Telehealth Primary Care','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','specialization','Geriatric Care','geriatric-care','Geriatric Care','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','specialization','Pediatric Primary Care','pediatric-primary','Pediatric Primary Care','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','specialization','Sports Medicine','sports-medicine','Sports Medicine','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','product_service','Annual Wellness Exam','annual-wellness','Annual Wellness Exam','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','product_service','Sick Visit','sick-visit','Sick Visit','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','product_service','Telehealth Visit','telehealth-visit','Telehealth Visit','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','product_service','Chronic Disease Management','chronic-mgmt','Chronic Disease Management','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','product_service','Preventive Screenings','preventive-screenings','Preventive Screenings','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','topic','When to See Your Doctor vs Urgent Care','doctor-vs-urgent-care','When to See Your Doctor vs Urgent Care','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','topic','Annual Physical — What to Expect','annual-physical','Annual Physical — What to Expect','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','topic','Managing High Blood Pressure','managing-blood-pressure','Managing High Blood Pressure','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','topic','Understanding Your Lab Results','understanding-lab-results','Understanding Your Lab Results','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','tag','accepting new patients','accepting-new-patients','Accepting New Patients','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','tag','telehealth available','telehealth-available','Telehealth Available','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','tag','same-day appointments','same-day','Same-Day Appointments','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:doctor','keyword','family doctor near me','family-doctor-near-me','Family doctor near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:doctor','keyword','primary care physician near me','pcp-near-me','Primary care physician near me','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:doctor','keyword','doctor accepting new patients','accepting-new-patients-kw','Doctor accepting new patients','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:doctor','question','How do I find a primary care doctor?','find-primary-care','How do I find a primary care doctor?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','question','What happens at an annual physical?','annual-physical-q','What happens at an annual physical?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:doctor','question','How often should I see my doctor?','how-often-doctor','How often should I see my doctor?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
