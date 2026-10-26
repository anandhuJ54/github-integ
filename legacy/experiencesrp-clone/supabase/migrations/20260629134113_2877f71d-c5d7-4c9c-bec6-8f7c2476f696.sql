-- ============================================================
-- SEED: Chiropractor vertical (gcid:chiropractor)
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
WHERE gcid = 'gcid:chiropractor';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:chiropractor', 'both', 'professional', 'active',
  ARRAY['adjustment', 'manipulation', 'subluxation', 'decompression', 'spinal alignment', 'extremity adjusting', 'soft tissue', 'trigger point', 'active release', 'instrument-assisted', 'Activator', 'drop table', 'diversified technique', 'flexion-distraction', 'CBP', 'sacroiliac', 'lumbar', 'cervical', 'thoracic', 'disc herniation', 'sciatica', 'posture correction', 'X-ray', 'COA'],
  '["Spinal adjustments","Back pain treatment","Neck pain treatment","Sciatica treatment","Sports injury care","Posture correction","Headache treatment","Disc herniation care","Auto accident injury care","Pediatric chiropractic","Pregnancy chiropractic","Extremity adjusting","Soft tissue therapy","Nutritional counseling","Spinal decompression"]'::jsonb,
  ARRAY['State chiropractic board licensing', 'HIPAA privacy rules', 'No ''cure'' or ''treat disease'' language', 'No guaranteed outcomes', 'Scope of practice limits (not a medical doctor)', 'Spinal X-ray justification required in some states', 'Insurance billing compliance', 'No anti-vaccination messaging in content'],
  '["Back/neck pain trigger or referral","Searching for chiropractor / insurance check","Initial consultation and X-rays","Treatment plan discussion","Active care phase (multiple visits/week)","Maintenance or wellness care","Discharge or ongoing care"]'::jsonb,
  '{"primary":["State chiropractic license","Patient reviews","Insurance acceptance","X-ray / diagnostic capability","Technique specialization"],"secondary":["Years of experience","Sports chiropractic credentials","Auto accident expertise","Same-day appointment availability","Modern equipment"]}'::jsonb,
  ARRAY['fixed my back pain', 'got me out of pain fast', 'gentle with adjustments', 'explained what was wrong', 'no more headaches', 'helped after my car accident', 'my go-to for maintenance care', 'life-changing results', 'professional and caring', 'no more sciatica'],
  ARRAY['Can a chiropractor help with back pain?', 'Chiropractic vs physical therapy — what to choose', 'What happens at a chiropractic adjustment?', 'Sciatica treatment options', 'How chiropractic helps with headaches', 'Chiropractic care during pregnancy', 'Chiropractic for athletes', 'Does chiropractic hurt?', 'How often should you see a chiropractor?', 'Text neck and chiropractic', 'Disc herniation — non-surgical options', 'Chiropractic for children', 'Auto accident injury and chiropractic', 'Understanding your spine', 'Posture correction techniques'],
  '{"primary":["DC degree","State chiropractic license","NPI registry","Board specialty certifications (CCSP, CCEP)"],"secondary":["Technique certifications (Active Release, Graston)","Sports chiropractic experience","Auto accident case experience","Published content"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.26,"license_verified":0.16,"insurance_accepted":0.15,"specialty":0.14,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true,"compliance":"HIPAA"},"review_responder":{"enabled":true,"vocabulary":"chiropractic","hipaa_mode":true},"content_assistant":{"enabled":true,"topics":["back pain","spinal health","sports injury","posture"]},"qa_assistant":{"enabled":true,"hipaa_mode":true}}'::jsonb,
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
  'gcid:chiropractor',
  TRUE, FALSE,
  FALSE, FALSE,
  'NPI {license_number}', 'DC License / NPI',
  ARRAY['Licensed Chiropractor in [State] | NPI {license_number}', 'Chiropractic care may not be appropriate for all conditions — consult your healthcare provider', 'Results vary by individual'],
  ARRAY['HIPAA-compliant reviews', 'no cure language', 'no guaranteed outcomes', 'no misleading scope of practice claims', 'no anti-vax content'],
  ARRAY['cure back pain', 'cure sciatica', 'guaranteed relief', 'best chiropractor guaranteed', 'treat all diseases', 'miracle adjustment'],
  FALSE, TRUE, FALSE,
  ARRAY['State Chiropractic Board', 'HIPAA (HHS OCR)', 'ACA (American Chiropractic Association)', 'CMS (Medicare billing)'],
  'Chiropractors must avoid ''cure'' or ''treat disease'' language that exceeds scope. HIPAA governs all patient records. X-ray use must meet clinical necessity standards. No guaranteed outcome statements.'
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
('gcid:chiropractor','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:chiropractor','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:chiropractor','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:chiropractor','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:chiropractor','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:chiropractor','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:chiropractor','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:chiropractor','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:chiropractor','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:chiropractor','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:chiropractor','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:chiropractor','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:chiropractor','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:chiropractor','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:chiropractor','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:chiropractor','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:chiropractor','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:chiropractor','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:chiropractor','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:chiropractor','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:chiropractor','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:chiropractor','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:chiropractor','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:chiropractor','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:chiropractor','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:chiropractor','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:chiropractor','State chiropractic license','auth_dc_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'State chiropractic board — DC or CCE-accredited program'),
('gcid:chiropractor','NPI registry','auth_npi','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,80,1,'npiregistry.cms.hhs.gov',NULL),
('gcid:chiropractor','CCSP / sports chiro certification','auth_ccsp','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,40,2,NULL,'Certified Chiropractic Sports Practitioner'),
('gcid:chiropractor','Active Release Technique (ART) certification','auth_art','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,30,3,NULL,NULL),
('gcid:chiropractor','Healthgrades profile','profile_healthgrades','profiles_presence','etl','Person','sameAs',TRUE,60,1,'healthgrades.com/chiropractor/{id}',NULL),
('gcid:chiropractor','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',FALSE,50,2,'zocdoc.com/chiropractor/{id}',NULL),
('gcid:chiropractor','Chiro-Find directory','profile_chiro_find','profiles_presence','etl','Person','sameAs',FALSE,30,3,'chiro.org/find-a-chiropractor/{id}',NULL),
('gcid:chiropractor','Insurance plans accepted','txn_insurance','transactions_outcomes','manual','Service','termsOfService',FALSE,50,1,NULL,NULL),
('gcid:chiropractor','Conditions treated','txn_conditions','transactions_outcomes','manual','MedicalCondition','possibleTreatment',FALSE,30,2,NULL,NULL),
('gcid:chiropractor','Techniques offered','txn_techniques','transactions_outcomes','manual','Service','serviceType',FALSE,20,3,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:chiropractor','profession_title','Chiropractor','chiropractor-title','Chiropractor','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','profession_title','Doctor of Chiropractic (DC)','doctor-chiropractic','Doctor of Chiropractic (DC)','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','profession_title','Sports Chiropractor','sports-chiropractor','Sports Chiropractor','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','specialization','Back & Neck Pain','back-neck-pain','Back & Neck Pain','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','specialization','Sports Chiropractic','sports-chiro','Sports Chiropractic','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','specialization','Auto Accident Injury','auto-accident-chiro','Auto Accident Injury','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','specialization','Pregnancy Chiropractic','pregnancy-chiro','Pregnancy Chiropractic','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','specialization','Pediatric Chiropractic','pediatric-chiro','Pediatric Chiropractic','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','specialization','Spinal Decompression','spinal-decompression','Spinal Decompression','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','product_service','Spinal Adjustment','spinal-adjustment','Spinal Adjustment','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','product_service','Sciatica Treatment','sciatica-treatment','Sciatica Treatment','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','product_service','Soft Tissue Therapy','soft-tissue','Soft Tissue Therapy','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','product_service','Spinal Decompression Therapy','spinal-decompression-svc','Spinal Decompression Therapy','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','topic','Can a Chiropractor Help with Back Pain?','chiro-back-pain','Can a Chiropractor Help with Back Pain?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','topic','What Happens at a Chiropractic Adjustment?','chiro-adjustment-explained','What Happens at a Chiropractic Adjustment?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','tag','walk-ins welcome','walk-ins-chiro','Walk-Ins Welcome','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','tag','auto accident','auto-accident-tag','Auto Accident','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:chiropractor','keyword','chiropractor near me','chiropractor-near-me','Chiropractor near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:chiropractor','keyword','back pain chiropractor','back-pain-chiro-kw','Back pain chiropractor','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:chiropractor','question','How many chiropractic visits do I need?','chiro-visits','How many chiropractic visits do I need?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','question','Is chiropractic covered by insurance?','chiro-insurance','Is chiropractic covered by insurance?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:chiropractor','question','Does a chiropractic adjustment hurt?','chiro-hurt','Does a chiropractic adjustment hurt?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
