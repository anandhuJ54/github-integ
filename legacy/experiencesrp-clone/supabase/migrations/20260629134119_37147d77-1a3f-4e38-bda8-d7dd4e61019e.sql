-- ============================================================
-- SEED: Dermatologist vertical (gcid:dermatologist)
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
WHERE gcid = 'gcid:dermatologist';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:dermatologist', 'both', 'professional', 'active',
  ARRAY['acne', 'eczema', 'psoriasis', 'rosacea', 'melanoma', 'MOHS surgery', 'biopsy', 'dermatoscopy', 'phototherapy', 'Botox', 'filler', 'chemical peel', 'laser resurfacing', 'microneedling', 'isotretinoin', 'topical retinoid', 'SPF', 'sunscreen', 'patch testing', 'allergy testing', 'skin cancer screening', 'cryotherapy', 'warts', 'seborrheic keratosis', 'lipoma', 'AB rule melanoma', 'keratosis pilaris'],
  '["Medical dermatology (acne, eczema, psoriasis)","Skin cancer screening and MOHS surgery","Cosmetic dermatology (Botox, fillers, lasers)","Chemical peels","Microneedling","Laser hair removal","Phototherapy","Biologics for psoriasis","Patch testing for allergies","Mole mapping","Cryotherapy","Scar treatment","Hair and nail disorders","Pediatric dermatology"]'::jsonb,
  ARRAY['HIPAA privacy rules', 'State medical board licensing', 'Before/after photos require written consent', 'No guaranteed cosmetic outcomes', 'FTC endorsement guidelines for before/after', 'Prescription drug advertising rules', 'No guarantees of cancer-free outcomes', 'Injectable procedures require proper disclosure'],
  '["Skin concern or annual skin cancer screening trigger","Searching for dermatologist / insurance check","New patient scheduling (often long waits)","Comprehensive skin exam","Treatment plan development","Procedure or prescription follow-up","Annual skin check recall"]'::jsonb,
  '{"primary":["Board certification (ABDS)","State medical license","Wait time for appointment","Insurance acceptance","Patient reviews on Healthgrades / Zocdoc"],"secondary":["Cosmetic vs medical focus","In-office procedures","Before/after gallery (cosmetic)","Technology (MOHS, laser)","Telehealth availability"]}'::jsonb,
  ARRAY['cleared my acne', 'found my skin cancer early', 'MOHS went perfectly', 'gentle and thorough', 'diagnosed my psoriasis correctly', 'results looked natural', 'no pushy upsells', 'attentive to my concerns', 'best skin of my life', 'changed how I think about skincare'],
  ARRAY['How to prevent skin cancer', 'When to see a dermatologist', 'Acne treatment options compared', 'Eczema management guide', 'Rosacea — triggers and treatments', 'What is MOHS surgery?', 'SPF and sunscreen guide', 'Psoriasis biologics explained', 'Botox vs filler — what''s the difference?', 'How to do a skin self-exam', 'Skincare routine for different skin types', 'Chemical peel recovery guide', 'Hyperpigmentation treatment options', 'Laser resurfacing explained', 'Hormonal acne in adults'],
  '{"primary":["MD/DO + ABDS board certification","State medical license","NPI registry","MOHS surgery training (if applicable)"],"secondary":["Fellowship in cosmetic derm","Laser and device expertise","Published research","Hospital affiliations"]}'::jsonb,
  '{"profile_completeness":0.16,"review_volume":0.25,"board_certification":0.18,"license_verified":0.15,"insurance_accepted":0.14,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true,"compliance":"HIPAA"},"review_responder":{"enabled":true,"vocabulary":"dermatology","hipaa_mode":true},"content_assistant":{"enabled":true,"topics":["skin health","acne","skin cancer prevention","skincare"]},"qa_assistant":{"enabled":true,"hipaa_mode":true}}'::jsonb,
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
  'gcid:dermatologist',
  TRUE, FALSE,
  FALSE, FALSE,
  'NPI {license_number}', 'Medical License / NPI',
  ARRAY['Board-Certified Dermatologist | NPI {license_number} | Licensed in [State]', 'Cosmetic results vary — outcomes depend on individual patient factors', 'This content is for informational purposes and is not a substitute for professional dermatologic care'],
  ARRAY['HIPAA-compliant reviews', 'no guaranteed cosmetic outcomes', 'before/after photos require written consent', 'no patient PII'],
  ARRAY['cure eczema permanently', 'guaranteed clear skin', 'remove all wrinkles', 'best Botox guaranteed', 'painless MOHS guaranteed'],
  FALSE, TRUE, FALSE,
  ARRAY['State Medical Board', 'HIPAA (HHS OCR)', 'AAD (American Academy of Dermatology)', 'FTC (advertising for cosmetic procedures)'],
  'HIPAA governs all patient records. Before/after photos for cosmetic procedures require explicit written consent and must not be misleading. Board certification by ABDS is the primary credentialing body. FTC guides apply to cosmetic claims.'
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
('gcid:dermatologist','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:dermatologist','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:dermatologist','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:dermatologist','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:dermatologist','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:dermatologist','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:dermatologist','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:dermatologist','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:dermatologist','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:dermatologist','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:dermatologist','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:dermatologist','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:dermatologist','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:dermatologist','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:dermatologist','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:dermatologist','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:dermatologist','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:dermatologist','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:dermatologist','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:dermatologist','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:dermatologist','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:dermatologist','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:dermatologist','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:dermatologist','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:dermatologist','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:dermatologist','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:dermatologist','Medical License / NPI (NPI registry)','auth_npi','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,'npiregistry.cms.hhs.gov/provider-view/{npi}','Primary healthcare credential — NPI registry'),
('gcid:dermatologist','State medical / professional license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,NULL,'State licensing board verification'),
('gcid:dermatologist','Board certification','auth_board_cert','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,60,2,NULL,'ABMS or equivalent board certification'),
('gcid:dermatologist','Hospital affiliations','auth_hospital_affil','verifiable_authority','manual','Organization','worksFor',FALSE,30,3,NULL,NULL),
('gcid:dermatologist','Medical school & residency','auth_training','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,20,4,NULL,NULL),
('gcid:dermatologist','Malpractice history (clean)','auth_malpractice','verifiable_authority','etl','Rating','ratingValue',FALSE,40,2,NULL,'Clean record required — state board lookup'),
('gcid:dermatologist','Healthgrades profile','profile_healthgrades_profile','profiles_presence','etl','Person','sameAs',TRUE,70,1,'healthgrades.com/dermatologist/{id}',NULL),
('gcid:dermatologist','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',TRUE,60,1,'zocdoc.com/doctor/{id}','Online booking integration available'),
('gcid:dermatologist','WebMD Physician Profile','profile_webmd','profiles_presence','etl','Person','sameAs',FALSE,40,2,'webmd.com/physician-directory/{id}',NULL),
('gcid:dermatologist','US News Health profile','profile_us_news','profiles_presence','etl','Person','sameAs',FALSE,35,3,'health.usnews.com/doctors/{id}',NULL),
('gcid:dermatologist','Doximity profile (physicians)','profile_doximity','profiles_presence','etl','Person','sameAs',FALSE,30,3,'doximity.com/pub/{slug}','Physician-only professional network'),
('gcid:dermatologist','Patient satisfaction scores','txn_patient_scores','transactions_outcomes','platform','Service','provider',FALSE,50,1,NULL,'HIPAA-compliant aggregate scores only'),
('gcid:dermatologist','Conditions treated','txn_conditions','transactions_outcomes','manual','MedicalCondition','possibleTreatment',FALSE,30,2,NULL,NULL),
('gcid:dermatologist','Procedures performed','txn_procedures','transactions_outcomes','manual','MedicalProcedure','provider',FALSE,30,2,NULL,NULL),
('gcid:dermatologist','Insurance plans accepted','txn_insurance','transactions_outcomes','manual','Service','termsOfService',FALSE,40,1,NULL,'Critical for patient acquisition'),
('gcid:dermatologist','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',FALSE,35,2,'zocdoc.com/dermatologist/{id}',NULL),
('gcid:dermatologist','RealSelf profile','profile_realself','profiles_presence','etl','Person','sameAs',FALSE,35,2,'realself.com/find/dermatologist/{id}',NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:dermatologist','profession_title','Dermatologist','dermatologist-title','Dermatologist','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','profession_title','Board-Certified Dermatologist','bd-cert-derm','Board-Certified Dermatologist','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','profession_title','Cosmetic Dermatologist','cosmetic-derm','Cosmetic Dermatologist','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','specialization','Medical Dermatology (Acne, Eczema, Psoriasis)','medical-derm','Medical Dermatology','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','specialization','Skin Cancer Screening & MOHS','skin-cancer-mohs','Skin Cancer & MOHS','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','specialization','Cosmetic Dermatology','cosmetic-derm-spec','Cosmetic Dermatology','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','specialization','Psoriasis & Biologics','psoriasis-biologics','Psoriasis & Biologics','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','specialization','Pediatric Dermatology','pediatric-derm','Pediatric Dermatology','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','product_service','Comprehensive Skin Exam','skin-exam','Comprehensive Skin Exam','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','product_service','Acne Treatment','acne-treatment','Acne Treatment','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','product_service','MOHS Surgery','mohs-surgery','MOHS Surgery','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','product_service','Botox & Fillers','botox-fillers','Botox & Fillers','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','product_service','Laser Treatments','laser-treatments','Laser Treatments','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','topic','How to Prevent Skin Cancer','prevent-skin-cancer','How to Prevent Skin Cancer','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','topic','Acne Treatment Options Compared','acne-treatment-options','Acne Treatment Options Compared','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','tag','skin cancer screening','skin-cancer-screening','Skin Cancer Screening','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','tag','accepting new patients','accepting-new-derm','Accepting New Patients','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:dermatologist','keyword','dermatologist near me','derm-near-me','Dermatologist near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:dermatologist','keyword','acne dermatologist','acne-derm-kw','Acne dermatologist','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:dermatologist','question','How do I know if a mole is cancerous?','mole-cancerous','How do I know if a mole is cancerous?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','question','How often should I see a dermatologist?','derm-frequency','How often should I see a dermatologist?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:dermatologist','question','What is the difference between Botox and fillers?','botox-vs-fillers','What is the difference between Botox and fillers?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
