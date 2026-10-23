-- ============================================================
-- SEED: General Dentist vertical (gcid:dentist)
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
WHERE gcid = 'gcid:dentist';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:dentist', 'both', 'professional', 'active',
  ARRAY['cavity', 'crown', 'filling', 'root canal', 'extraction', 'implant', 'bridge', 'denture', 'veneer', 'whitening', 'periodontal', 'gum disease', 'deep cleaning', 'scaling', 'planing', 'X-rays', 'radiograph', 'bite', 'occlusion', 'TMJ', 'night guard', 'fluoride', 'sealant', 'DDS', 'DMD', 'prophylaxis', 'periodontal probe', 'anesthesia', 'composite', 'amalgam', 'porcelain'],
  '["Routine cleanings and exams","Cavity fillings","Tooth extractions","Root canal therapy","Dental crowns","Dental implants","Bridges and dentures","Teeth whitening","Veneers","Periodontal treatment","Night guards and TMJ treatment","Emergency dental care","Dental X-rays","Fluoride treatments","Dental sealants","Invisalign / clear aligners"]'::jsonb,
  ARRAY['HIPAA privacy rules for patient records', 'State dental board licensing requirements', 'No guarantee of treatment outcomes', 'X-ray exposure compliance', 'OSHA infection control standards', 'Informed consent required for procedures', 'Advertising must not include misleading before/after', 'No guaranteed whitening results'],
  '["Searching for a dentist / insurance check","New patient scheduling / welcome package","Initial exam and X-rays","Treatment planning discussion","Active treatment phase","Recall appointment (every 6 months)","Emergency care when needed"]'::jsonb,
  '{"primary":["Insurance acceptance","Appointment availability","Patient reviews","Years of practice","Technology (digital X-rays, CEREC)"],"secondary":["Emergency appointment availability","Sedation options","Cosmetic dentistry skill","Kid-friendly environment","Convenient hours"]}'::jsonb,
  ARRAY['painless experience', 'explained everything before proceeding', 'gentle with nervous patients', 'beautiful smile', 'quick and efficient', 'thorough cleaning', 'honest about treatment needed', 'no surprise bills', 'great with kids', 'comfortable and modern office'],
  ARRAY['How often should you see the dentist?', 'Cavity prevention — your complete guide', 'What is a root canal and does it hurt?', 'Dental implants vs bridges — what to choose', 'Teeth whitening options compared', 'Signs of gum disease you shouldn''t ignore', 'How to choose a family dentist', 'What to expect at your first dentist visit', 'Dental anxiety — tips for nervous patients', 'Foods that damage your teeth', 'Invisalign vs traditional braces', 'The importance of dental X-rays', 'Night guards for teeth grinding', 'Children''s dental care guide', 'Dental insurance basics explained'],
  '{"primary":["DDS or DMD degree","State dental license","NPI registry","CEREC / digital dentistry technology"],"secondary":["Specialty training (implants, Invisalign, sedation)","Years of experience","Continuing education hours","Patient satisfaction scores","AACD membership (cosmetic)"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.25,"license_verified":0.16,"insurance_accepted":0.16,"technology":0.13,"schema_completeness":0.13}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true,"compliance":"HIPAA"},"review_responder":{"enabled":true,"vocabulary":"dental","hipaa_mode":true},"content_assistant":{"enabled":true,"topics":["oral health","cosmetic dentistry","preventive care"]},"qa_assistant":{"enabled":true,"hipaa_mode":true}}'::jsonb,
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
  'gcid:dentist',
  TRUE, FALSE,
  FALSE, FALSE,
  'License #{license_number}', 'Dental License / NPI',
  ARRAY['Licensed Dentist in [State] | License #{license_number}', 'Results may vary — outcomes depend on individual patient factors', 'This content is for informational purposes and is not a substitute for professional dental care'],
  ARRAY['HIPAA-compliant review responses', 'no guaranteed outcomes', 'no before/after photos without patient consent', 'no misleading whitening claims'],
  ARRAY['guaranteed cavity-free', 'guaranteed white teeth', 'painless guaranteed', 'best dentist guaranteed', 'cheapest dentist', 'instant results'],
  FALSE, TRUE, FALSE,
  ARRAY['State Dental Board', 'HIPAA (HHS OCR)', 'ADA (American Dental Association)', 'OSHA (infection control)'],
  'HIPAA governs all patient records and communication. Before/after photos require explicit written patient consent. Whitening results vary — no guarantees. State dental board governs advertising, staff supervision, and scope of practice.'
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
('gcid:dentist','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:dentist','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:dentist','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:dentist','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:dentist','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:dentist','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:dentist','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:dentist','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:dentist','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:dentist','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:dentist','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:dentist','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:dentist','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:dentist','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:dentist','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:dentist','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:dentist','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:dentist','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:dentist','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:dentist','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:dentist','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:dentist','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:dentist','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:dentist','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:dentist','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:dentist','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:dentist','State dental license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'State dental board verification — DDS or DMD'),
('gcid:dentist','NPI registry','auth_npi','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,'npiregistry.cms.hhs.gov','Required for insurance billing'),
('gcid:dentist','ADA membership','auth_ada','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,30,3,NULL,'American Dental Association — optional but trust signal'),
('gcid:dentist','Board specialty certifications','auth_board_cert','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,40,2,NULL,'ABGD, ABCD (cosmetic), implant certifications'),
('gcid:dentist','Invisalign / Align provider','auth_invisalign','verifiable_authority','etl','ProgramMembership','memberOf',FALSE,30,2,'provider.invisalign.com','Invisalign certified provider directory'),
('gcid:dentist','Healthgrades dental profile','profile_healthgrades','profiles_presence','etl','Person','sameAs',TRUE,60,1,'healthgrades.com/dentist/{id}',NULL),
('gcid:dentist','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',TRUE,60,1,'zocdoc.com/dentist/{id}',NULL),
('gcid:dentist','1-800-Dentist profile','profile_1800dentist','profiles_presence','etl','Person','sameAs',FALSE,40,2,'1800dentist.com/{id}','Major lead generation directory'),
('gcid:dentist','Yelp dental listing','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,30,3,'yelp.com/biz/{slug}',NULL),
('gcid:dentist','Dental Plans directory','profile_dentalplans','profiles_presence','etl','Person','sameAs',FALSE,30,3,'dentalplans.com/dentists/{id}',NULL),
('gcid:dentist','Patient satisfaction scores','txn_patient_scores','transactions_outcomes','platform','Service','provider',FALSE,40,1,NULL,'HIPAA-compliant aggregate only'),
('gcid:dentist','Insurance plans accepted','txn_insurance','transactions_outcomes','manual','Service','termsOfService',FALSE,50,1,NULL,'Critical for patient acquisition'),
('gcid:dentist','Services offered','txn_services','transactions_outcomes','manual','MedicalProcedure','provider',FALSE,30,2,NULL,NULL),
('gcid:dentist','Technology (digital X-ray, CEREC, 3D scan)','auth_technology','verifiable_authority','manual','MedicalDevice','provider',FALSE,20,4,NULL,'Technology signals quality of care')
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:dentist','profession_title','Dentist','dentist-title','Dentist','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','profession_title','General Dentist','general-dentist','General Dentist','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','profession_title','Family Dentist','family-dentist-title','Family Dentist','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','profession_title','Cosmetic Dentist','cosmetic-dentist','Cosmetic Dentist','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','profession_title','DDS / DMD','dds-dmd','DDS / DMD','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','specialization','Cosmetic Dentistry','cosmetic-dentistry','Cosmetic Dentistry','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','specialization','Implant Dentistry','implant-dentistry','Implant Dentistry','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','specialization','Clear Aligner Therapy (Invisalign)','invisalign-aligners','Clear Aligner Therapy','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','specialization','Periodontal Treatment','periodontal','Periodontal Treatment','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','specialization','Pediatric Dental Care','pediatric-dental','Pediatric Dental Care','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','specialization','Emergency Dental Care','emergency-dental','Emergency Dental Care','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','specialization','Sedation Dentistry','sedation-dentistry','Sedation Dentistry','claude_generated',7,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','product_service','Routine Cleaning & Exam','cleaning-exam','Routine Cleaning & Exam','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','product_service','Teeth Whitening','teeth-whitening','Teeth Whitening','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','product_service','Dental Implants','dental-implants','Dental Implants','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','product_service','Root Canal Therapy','root-canal','Root Canal Therapy','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','product_service','Invisalign','invisalign-svc','Invisalign','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','product_service','Dental Crowns','dental-crowns','Dental Crowns','claude_generated',6,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','topic','How Often Should You See the Dentist?','how-often-dentist','How Often Should You See the Dentist?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','topic','What Is a Root Canal and Does It Hurt?','root-canal-hurt','What Is a Root Canal and Does It Hurt?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','topic','Dental Implants vs Bridges','implants-vs-bridges','Dental Implants vs Bridges','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','topic','Cavity Prevention Guide','cavity-prevention','Cavity Prevention Guide','claude_generated',4,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','tag','accepting new patients','accepting-new-patients-dds','Accepting New Patients','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','tag','emergency dentist','emergency-dentist-tag','Emergency Dentist','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','tag','sedation dentistry','sedation-dentistry-tag','Sedation Dentistry','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dentist','keyword','dentist near me','dentist-near-me','Dentist near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:dentist','keyword','family dentist accepting new patients','family-dentist-new-patients','Family dentist accepting new patients','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:dentist','keyword','teeth whitening dentist','teeth-whitening-kw','Teeth whitening dentist','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:dentist','question','How much do dental implants cost?','dental-implants-cost','How much do dental implants cost?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','question','How painful is a root canal?','root-canal-pain','How painful is a root canal?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dentist','question','What does dental insurance cover?','dental-insurance-coverage','What does dental insurance cover?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
