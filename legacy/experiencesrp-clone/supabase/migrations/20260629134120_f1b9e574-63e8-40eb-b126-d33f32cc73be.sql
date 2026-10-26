-- ============================================================
-- SEED: Plastic Surgeon vertical (gcid:plastic_surgeon)
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
WHERE gcid = 'gcid:plastic_surgeon';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:plastic_surgeon', 'both', 'professional', 'active',
  ARRAY['rhinoplasty', 'breast augmentation', 'tummy tuck', 'liposuction', 'facelift', 'blepharoplasty', 'abdominoplasty', 'BBL', 'brow lift', 'necklift', 'mommy makeover', 'TRAM flap', 'DIEP flap', 'tissue expander', 'implant', 'microsurgery', 'scar revision', 'skin grafting', 'ABPS', 'RealSelf', 'board certification', 'accredited surgery center', 'anesthesiology', 'post-op care', 'recovery timeline'],
  '["Breast augmentation","Rhinoplasty","Facelift","Tummy tuck","Liposuction","Blepharoplasty (eyelid surgery)","Brow lift","Neck lift","Mommy makeover","Breast reconstruction","Body contouring","Scar revision","Gynecomastia surgery","Labiaplasty","Ear surgery (otoplasty)","Non-surgical treatments (Botox, fillers)"]'::jsonb,
  ARRAY['HIPAA privacy rules', 'State medical board licensing', 'ABPS board certification for credibility', 'Before/after photos require explicit written consent — FTC guidelines', 'No guaranteed cosmetic outcomes', 'Truth in advertising for cosmetic results', 'Informed consent for all procedures', 'Accredited surgical facility required for most procedures', 'No ''safe surgery'' guarantees'],
  '["Considering a procedure / researching surgeons","Online research and before/after review","Initial consultation / virtual consult","Pre-op labs, instructions, and clearance","Surgery day","Recovery and post-op follow-up","Final result review (3-6 months)"]'::jsonb,
  '{"primary":["ABPS board certification","Before/after photo quality and authenticity","RealSelf reputation score","Accredited surgical facility","Patient reviews"],"secondary":["Natural-looking results aesthetic","Recovery support","Years of experience with specific procedure","Body contouring specialization","Revision surgery experience"]}'::jsonb,
  ARRAY['results looked completely natural', 'changed my confidence', 'cared about my outcome not just the sale', 'thorough consultation', 'recovery was manageable', 'best decision I ever made', 'listened to exactly what I wanted', 'precise and artistic results', 'accredited facility felt safe', 'trusted immediately'],
  ARRAY['Am I a good candidate for plastic surgery?', 'What to ask your plastic surgeon at a consultation', 'Rhinoplasty recovery — week by week', 'Breast augmentation — implant types compared', 'Tummy tuck vs liposuction — what''s the difference?', 'How to find a board-certified plastic surgeon', 'Mommy makeover — what procedures are included?', 'Facelift recovery timeline', 'Non-surgical alternatives to plastic surgery', 'How to minimize scarring after surgery', 'Body dysmorphic disorder and cosmetic surgery', 'What is a TRAM flap breast reconstruction?', 'Liposuction — what it can and can''t do', 'Choosing between saline and silicone implants', 'Preparing for plastic surgery — the full checklist'],
  '{"primary":["ABPS board certification","State medical license","NPI registry","Accredited surgical facility (AAAASF, JCAHO, AAAHC)"],"secondary":["Fellowship training","Subspecialty (breast reconstruction, hand surgery)","RealSelf reputation","Published research","Before/after gallery quality"]}'::jsonb,
  '{"profile_completeness":0.15,"review_volume":0.22,"board_certification":0.22,"before_after_gallery":0.16,"license_verified":0.14,"schema_completeness":0.11}'::jsonb,
  '{"sdr":{"enabled":true,"tone":"consultative","compliance":"HIPAA_FTC"},"receptionist":{"enabled":true,"compliance":"HIPAA"},"review_responder":{"enabled":true,"vocabulary":"plastic_surgery","hipaa_mode":true},"content_assistant":{"enabled":true,"topics":["cosmetic surgery guides","recovery tips","procedure education"]},"qa_assistant":{"enabled":true,"hipaa_mode":true}}'::jsonb,
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
  'gcid:plastic_surgeon',
  TRUE, FALSE,
  FALSE, FALSE,
  'NPI {license_number}', 'Medical License / NPI',
  ARRAY['Board-Certified Plastic Surgeon | ABPS | NPI {license_number} | Licensed in [State]', 'Individual results vary — cosmetic surgery outcomes depend on patient anatomy, technique, and healing', 'Before/after photos are of actual patients with consent — individual results may differ'],
  ARRAY['HIPAA-compliant reviews', 'no guaranteed cosmetic outcomes', 'before/after photos require written consent', 'no ''safe surgery'' guarantees', 'FTC-compliant testimonials'],
  ARRAY['guaranteed results', 'risk-free surgery', 'best plastic surgeon guaranteed', 'cheapest plastic surgery', 'pain-free recovery guaranteed', 'look 20 years younger guaranteed'],
  FALSE, TRUE, FALSE,
  ARRAY['State Medical Board', 'HIPAA (HHS OCR)', 'ABPS (American Board of Plastic Surgery)', 'ASPS (American Society of Plastic Surgeons)', 'FTC (cosmetic advertising)'],
  'ABPS board certification is the gold standard — only ABPS-certified surgeons can call themselves board-certified plastic surgeons. Before/after photos are heavily regulated by FTC and require written consent. HIPAA applies to all patient records. Surgical facility must be accredited.'
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
('gcid:plastic_surgeon','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:plastic_surgeon','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:plastic_surgeon','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:plastic_surgeon','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:plastic_surgeon','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:plastic_surgeon','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:plastic_surgeon','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:plastic_surgeon','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:plastic_surgeon','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:plastic_surgeon','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:plastic_surgeon','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:plastic_surgeon','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:plastic_surgeon','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:plastic_surgeon','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:plastic_surgeon','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:plastic_surgeon','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:plastic_surgeon','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:plastic_surgeon','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:plastic_surgeon','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:plastic_surgeon','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:plastic_surgeon','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:plastic_surgeon','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:plastic_surgeon','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:plastic_surgeon','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:plastic_surgeon','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:plastic_surgeon','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:plastic_surgeon','ABPS board certification','auth_abps','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,'abplsurg.org/verify','American Board of Plastic Surgery — primary credential'),
('gcid:plastic_surgeon','State medical license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,NULL,'State medical board'),
('gcid:plastic_surgeon','NPI registry','auth_npi','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,70,1,'npiregistry.cms.hhs.gov',NULL),
('gcid:plastic_surgeon','ASPS membership','auth_asps','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,40,2,'plasticsurgery.org/find-a-plastic-surgeon/{id}','American Society of Plastic Surgeons'),
('gcid:plastic_surgeon','Accredited surgical facility','auth_accredited_facility','verifiable_authority','manual','MedicalClinic','location',TRUE,60,1,NULL,'AAAASF, JCAHO, or AAAHC accreditation required'),
('gcid:plastic_surgeon','Healthgrades profile','profile_healthgrades','profiles_presence','etl','Person','sameAs',TRUE,60,1,'healthgrades.com/plastic-surgeon/{id}',NULL),
('gcid:plastic_surgeon','RealSelf profile','profile_realself','profiles_presence','etl','Person','sameAs',TRUE,80,1,'realself.com/find/plastic-surgeon/{id}','Leading cosmetic surgery review platform'),
('gcid:plastic_surgeon','ASPS Find a Surgeon','profile_asps_finder','profiles_presence','etl','Person','sameAs',FALSE,60,2,'plasticsurgery.org/find-a-plastic-surgeon/{id}',NULL),
('gcid:plastic_surgeon','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',FALSE,40,2,'zocdoc.com/plastic-surgeon/{id}',NULL),
('gcid:plastic_surgeon','Procedures performed (aggregate)','txn_procedures','transactions_outcomes','manual','MedicalProcedure','provider',FALSE,40,1,NULL,'Most-performed procedures — no patient PII'),
('gcid:plastic_surgeon','Before/after gallery','txn_gallery','transactions_outcomes','platform','ImageObject','about',FALSE,60,1,NULL,'Consented patient photos — FTC compliant')
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:plastic_surgeon','profession_title','Plastic Surgeon','plastic-surgeon-title','Plastic Surgeon','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','profession_title','Board-Certified Plastic Surgeon','bd-cert-ps','Board-Certified Plastic Surgeon','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','profession_title','Cosmetic Surgeon','cosmetic-surgeon','Cosmetic Surgeon','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','specialization','Breast Surgery','breast-surgery','Breast Surgery','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','specialization','Body Contouring','body-contouring','Body Contouring','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','specialization','Facial Plastic Surgery','facial-plastic','Facial Plastic Surgery','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','specialization','Breast Reconstruction','breast-reconstruction','Breast Reconstruction','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','specialization','Mommy Makeover','mommy-makeover','Mommy Makeover','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','product_service','Rhinoplasty','rhinoplasty','Rhinoplasty','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','product_service','Breast Augmentation','breast-augmentation','Breast Augmentation','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','product_service','Tummy Tuck','tummy-tuck','Tummy Tuck','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','product_service','Liposuction','liposuction','Liposuction','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','product_service','Facelift','facelift','Facelift','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','topic','Am I a Good Candidate for Plastic Surgery?','ps-candidate','Am I a Good Candidate for Plastic Surgery?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','topic','How to Find a Board-Certified Plastic Surgeon','find-board-cert-ps','How to Find a Board-Certified Plastic Surgeon','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','tag','ABPS certified','abps-certified','ABPS Certified','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','tag','natural results','natural-results','Natural Results','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','keyword','plastic surgeon near me','plastic-surgeon-near-me','Plastic surgeon near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:plastic_surgeon','keyword','rhinoplasty surgeon','rhinoplasty-surgeon','Rhinoplasty surgeon','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:plastic_surgeon','question','How do I choose a plastic surgeon?','choose-plastic-surgeon','How do I choose a plastic surgeon?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','question','What is the recovery like after a facelift?','facelift-recovery','What is the recovery like after a facelift?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:plastic_surgeon','question','How long do breast implants last?','implant-lifespan','How long do breast implants last?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
