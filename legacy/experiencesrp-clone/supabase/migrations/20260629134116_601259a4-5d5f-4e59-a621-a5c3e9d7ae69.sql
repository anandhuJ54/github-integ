-- ============================================================
-- SEED: Optometrist vertical (gcid:optometrist)
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
WHERE gcid = 'gcid:optometrist';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:optometrist', 'both', 'professional', 'active',
  ARRAY['visual acuity', 'refraction', 'prescription', 'myopia', 'hyperopia', 'astigmatism', 'presbyopia', 'glaucoma', 'macular degeneration', 'diabetic eye disease', 'dry eye', 'OD', 'contact lens fitting', 'IOL', 'OCT', 'visual field', 'fundus', 'dilation', 'tonometry', 'color vision', 'low vision', 'orthokeratology', 'scleral lenses', 'LASIK co-management'],
  '["Comprehensive eye exams","Contact lens fitting and evaluation","Glasses prescriptions","Glaucoma screening and management","Diabetic eye exams","Dry eye treatment","Pediatric eye exams","LASIK co-management","Emergency eye care","Low vision services","Vision therapy","Ocular disease management"]'::jsonb,
  ARRAY['HIPAA privacy rules', 'State optometry board licensing', 'No guarantee of vision correction outcomes', 'FTC contact lens rule (must provide prescription)', 'ANSI lens standards', 'No misleading ''cure'' claims for eye disease', 'Telehealth optometry regulations vary by state'],
  '["Annual eye care reminder / new prescription need","Insurance verification / searching for optometrist","Scheduling comprehensive exam","Exam, refraction, and glasses/contacts prescription","Frame selection or contact fitting","Follow-up or specialty care","Annual recall"]'::jsonb,
  '{"primary":["State OD license","Insurance acceptance (VSP, EyeMed, Spectera)","Patient reviews","Technology (OCT, digital imaging)","Appointment availability"],"secondary":["Specialty (dry eye, ortho-k, pediatric)","Contact lens specialization","Telehealth availability","Hours and location"]}'::jsonb,
  ARRAY['thorough eye exam', 'found a problem my old eye doctor missed', 'great selection of frames', 'explained my prescription clearly', 'good with kids', 'gentle and professional', 'modern equipment', 'quick appointment', 'took my insurance', 'helped with my dry eyes'],
  ARRAY['How often should you have an eye exam?', 'Signs you need new glasses', 'Contact lenses vs glasses — pros and cons', 'Dry eye syndrome — causes and treatments', 'Glaucoma — the silent vision thief', 'Diabetic eye disease explained', 'What happens at a comprehensive eye exam', 'Kids and screen time — protecting their vision', 'LASIK — am I a good candidate?', 'Myopia control for children', 'UV protection and sunglasses', 'Vision insurance explained', 'Why do I need reading glasses after 40?', 'Digital eye strain at work', 'Macular degeneration prevention'],
  '{"primary":["OD degree","State optometry license","NPI registry","Board certification in specialty (FAAO)"],"secondary":["Fellowship in specialty area","Advanced diagnostic technology","Dry eye certification","Contact lens specialty experience"]}'::jsonb,
  '{"profile_completeness":0.16,"review_volume":0.25,"license_verified":0.17,"insurance_accepted":0.17,"technology":0.13,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true,"compliance":"HIPAA"},"review_responder":{"enabled":true,"vocabulary":"optometry","hipaa_mode":true},"content_assistant":{"enabled":true,"topics":["eye health","vision care","dry eye","pediatric vision"]},"qa_assistant":{"enabled":true,"hipaa_mode":true}}'::jsonb,
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
  'gcid:optometrist',
  TRUE, FALSE,
  FALSE, FALSE,
  'NPI {license_number}', 'OD License / NPI',
  ARRAY['Doctor of Optometry | NPI {license_number} | Licensed in [State]', 'This content is for informational purposes and is not a substitute for a professional eye exam', 'Vision correction results vary — consult your eye doctor'],
  ARRAY['HIPAA-compliant reviews', 'no guaranteed vision outcomes', 'no misleading cure claims for eye disease', 'no patient PII'],
  ARRAY['cure glaucoma', 'guaranteed perfect vision', 'LASIK always works', 'best vision correction guaranteed', 'eliminate need for glasses guaranteed'],
  FALSE, TRUE, FALSE,
  ARRAY['State Board of Optometry', 'HIPAA (HHS OCR)', 'AOA (American Optometric Association)', 'FTC (contact lens prescription rule)'],
  'FTC Contact Lens Rule requires providing patients their contact lens prescription without requiring a purchase. HIPAA governs all patient records. State optometry boards regulate scope of practice (prescription authority varies).'
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
('gcid:optometrist','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:optometrist','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:optometrist','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:optometrist','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:optometrist','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:optometrist','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:optometrist','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:optometrist','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:optometrist','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:optometrist','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:optometrist','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:optometrist','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:optometrist','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:optometrist','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:optometrist','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:optometrist','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:optometrist','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:optometrist','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:optometrist','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:optometrist','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:optometrist','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:optometrist','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:optometrist','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:optometrist','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:optometrist','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:optometrist','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:optometrist','State OD license','auth_od_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'State optometry board — OD degree'),
('gcid:optometrist','NPI registry','auth_npi','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,'npiregistry.cms.hhs.gov',NULL),
('gcid:optometrist','FAAO fellowship','auth_faao','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,40,2,NULL,'Fellow of the American Academy of Optometry'),
('gcid:optometrist','Healthgrades profile','profile_healthgrades','profiles_presence','etl','Person','sameAs',TRUE,60,1,'healthgrades.com/optometrist/{id}',NULL),
('gcid:optometrist','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',TRUE,60,1,'zocdoc.com/optometrist/{id}',NULL),
('gcid:optometrist','VSP provider directory','profile_vsp','profiles_presence','etl','Person','sameAs',FALSE,50,2,'vsp.com/find-a-provider/{id}','VSP is the largest vision insurance network'),
('gcid:optometrist','EyeMed provider directory','profile_eyemed','profiles_presence','etl','Person','sameAs',FALSE,40,2,'eyemed.com/find-a-provider/{id}',NULL),
('gcid:optometrist','Insurance accepted','txn_insurance','transactions_outcomes','manual','Service','termsOfService',FALSE,50,1,NULL,'VSP, EyeMed, Spectera critical'),
('gcid:optometrist','Services offered','txn_services','transactions_outcomes','manual','MedicalProcedure','provider',FALSE,30,2,NULL,NULL),
('gcid:optometrist','Technology (OCT, corneal topography)','auth_technology','verifiable_authority','manual','MedicalDevice','provider',FALSE,20,4,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:optometrist','profession_title','Optometrist','optometrist-title','Optometrist','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','profession_title','Doctor of Optometry (OD)','doctor-optometry','Doctor of Optometry (OD)','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','profession_title','Eye Doctor','eye-doctor','Eye Doctor','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','specialization','Dry Eye Treatment','dry-eye-treatment','Dry Eye Treatment','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','specialization','Pediatric Eye Care','pediatric-eye','Pediatric Eye Care','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','specialization','Contact Lens Specialty','contact-lens-specialty','Contact Lens Specialty','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','specialization','Myopia Control (Ortho-K)','myopia-control','Myopia Control','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','specialization','Ocular Disease Management','ocular-disease','Ocular Disease Management','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','product_service','Comprehensive Eye Exam','comprehensive-eye-exam','Comprehensive Eye Exam','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','product_service','Contact Lens Fitting','contact-lens-fitting','Contact Lens Fitting','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','product_service','Glasses Prescription','glasses-rx','Glasses Prescription','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','product_service','Dry Eye Treatment','dry-eye-svc','Dry Eye Treatment','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','topic','How Often Should You Have an Eye Exam?','eye-exam-frequency','How Often Should You Have an Eye Exam?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','topic','Signs You Need New Glasses','need-new-glasses','Signs You Need New Glasses','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','tag','accepts VSP','accepts-vsp','Accepts VSP','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','tag','same-day appointments','same-day-eye','Same-Day Appointments','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:optometrist','keyword','optometrist near me','optometrist-near-me','Optometrist near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:optometrist','keyword','eye exam near me','eye-exam-near-me','Eye exam near me','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:optometrist','question','What does an eye exam include?','eye-exam-includes','What does an eye exam include?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','question','How much does an eye exam cost without insurance?','eye-exam-cost','How much does an eye exam cost without insurance?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:optometrist','question','Can an optometrist treat glaucoma?','optometrist-glaucoma','Can an optometrist treat glaucoma?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
