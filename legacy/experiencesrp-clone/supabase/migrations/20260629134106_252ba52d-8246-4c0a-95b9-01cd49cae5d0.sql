-- ============================================================
-- SEED: Mental Health Counselor vertical (gcid:mental_health_clinic)
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
WHERE gcid = 'gcid:mental_health_clinic';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:mental_health_clinic', 'both', 'professional', 'active',
  ARRAY['therapy', 'counseling', 'psychotherapy', 'CBT', 'DBT', 'EMDR', 'trauma', 'anxiety', 'depression', 'PTSD', 'grief', 'couples therapy', 'family therapy', 'psychologist', 'LPC', 'LCSW', 'LMFT', 'LMHC', 'psychiatrist', 'diagnosis', 'DSM-5', 'session', 'intake', 'crisis', 'telehealth', 'EAP', 'sliding scale', 'in-network', 'out-of-network'],
  '["Individual therapy","Couples counseling","Family therapy","Anxiety treatment","Depression treatment","Trauma & PTSD therapy","Grief counseling","Addiction counseling","Stress management","Life transitions counseling","Teen & adolescent therapy","LGBTQ+ affirming therapy","CBT","EMDR","Mindfulness-based therapy"]'::jsonb,
  ARRAY['HIPAA privacy and security rules', 'No disclosure of client information without consent', 'Duty to warn / Tarasoff obligations', 'Mandatory reporting requirements', 'Scope of practice per license', 'No sexual dual relationships', 'Teletherapy licensing requirements', 'Supervision requirements for unlicensed clinicians', 'No guarantee of treatment outcomes'],
  '["Recognizing need for help / researching therapy","Finding a therapist who accepts insurance / specialty match","Initial intake session / assessment","Establishing treatment goals","Ongoing weekly/biweekly sessions","Progress review and plan adjustment","Graduation / termination / referral"]'::jsonb,
  '{"primary":["State license in good standing","Specialty fit (anxiety, trauma, couples)","Insurance network participation","New client availability","Review quality and authenticity"],"secondary":["Telehealth availability","Sliding scale fees","Specialization certifications (EMDR, DBT)","Languages spoken","Cultural competency"]}'::jsonb,
  ARRAY['changed my life', 'helped me through a dark time', 'listens without judgment', 'I finally feel heard', 'gave me tools to manage anxiety', 'compassionate and skilled', 'safe space', 'helped my marriage', 'helped my teenager', 'highly recommend', 'no stigma', 'warm and welcoming'],
  ARRAY['How to find the right therapist', 'What to expect in your first therapy session', 'CBT — how it works', 'Understanding anxiety and how therapy helps', 'Therapy for depression — what to know', 'When to consider couples therapy', 'How EMDR helps trauma survivors', 'Telehealth therapy — is it effective?', 'The difference between a psychologist, LPC, LCSW, and psychiatrist', 'How to talk about mental health with your employer', 'Using your insurance for therapy', 'Self-care between therapy sessions', 'Supporting a loved one with mental illness', 'Teen therapy — how to help your child', 'Mindfulness techniques you can start today'],
  '{"primary":["State license (LPC, LCSW, LMFT, PhD)","Specialty certifications (EMDR, DBT certified)","Insurance credentialing","Supervision experience"],"secondary":["Cultural competency","Languages spoken","Training institutes","Published research or articles"]}'::jsonb,
  '{"profile_completeness":0.16,"review_volume":0.24,"license_verified":0.18,"specialty_match":0.16,"insurance_accepted":0.14,"schema_completeness":0.12}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true,"compliance":"HIPAA","tone":"warm"},"review_responder":{"enabled":true,"vocabulary":"mental_health","hipaa_mode":true},"content_assistant":{"enabled":true,"topics":["mental health education","self-care","therapy guides"]},"qa_assistant":{"enabled":true,"hipaa_mode":true}}'::jsonb,
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
  'gcid:mental_health_clinic',
  TRUE, FALSE,
  FALSE, FALSE,
  'License #{license_number}', 'Professional License',
  ARRAY['Licensed in [State] as [LPC / LCSW / LMFT / LMHC / PhD]', 'If you are in crisis, please call or text 988 (Suicide and Crisis Lifeline) or go to your nearest emergency room', 'This content is for informational purposes and is not a substitute for professional mental health care'],
  ARRAY['HIPAA-compliant review responses only', 'no specific clinical advice in content', 'no patient PII in any content', 'no testimonials without written consent', 'no diagnosis claims'],
  ARRAY['cure depression', 'cure anxiety', 'guaranteed results', 'fix your mental health', 'best therapist guaranteed', 'fast results'],
  FALSE, TRUE, FALSE,
  ARRAY['State licensing board (LCSW, LPC, LMFT, PhD board)', 'HIPAA (HHS OCR)', 'APA (American Psychological Association)', 'NASW (National Association of Social Workers)'],
  'HIPAA is paramount. Crisis protocol must be disclosed. Mandatory reporting (child/elder abuse, Tarasoff) must be in informed consent. Review responses must never confirm a client relationship. Telehealth requires state licensure where client is located.'
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
('gcid:mental_health_clinic','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:mental_health_clinic','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:mental_health_clinic','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:mental_health_clinic','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:mental_health_clinic','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:mental_health_clinic','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:mental_health_clinic','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:mental_health_clinic','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:mental_health_clinic','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:mental_health_clinic','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:mental_health_clinic','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:mental_health_clinic','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:mental_health_clinic','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:mental_health_clinic','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:mental_health_clinic','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:mental_health_clinic','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:mental_health_clinic','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:mental_health_clinic','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:mental_health_clinic','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:mental_health_clinic','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:mental_health_clinic','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:mental_health_clinic','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:mental_health_clinic','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:mental_health_clinic','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:mental_health_clinic','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:mental_health_clinic','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:mental_health_clinic','State professional license','auth_state_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'LPC, LCSW, LMFT, LMHC, PhD/PsyD — state board verification'),
('gcid:mental_health_clinic','EMDR certification','auth_emdr','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,40,2,'emdria.org/find-an-emdr-therapist/{id}','EMDR International Association certification'),
('gcid:mental_health_clinic','DBT certification','auth_dbt','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,40,2,NULL,'DBT-Linehan Board of Certification'),
('gcid:mental_health_clinic','NPI registry','auth_npi','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,60,2,'npiregistry.cms.hhs.gov','Required for insurance billing'),
('gcid:mental_health_clinic','Psychology Today profile','profile_psychology_today','profiles_presence','etl','Person','sameAs',TRUE,80,1,'psychologytoday.com/us/therapists/{id}','#1 therapist directory — high patient acquisition'),
('gcid:mental_health_clinic','TherapyDen profile','profile_therapyden','profiles_presence','etl','Person','sameAs',FALSE,50,2,'therapyden.com/therapist/{id}','Inclusive and identity-affirming focus'),
('gcid:mental_health_clinic','Zocdoc profile','profile_zocdoc','profiles_presence','etl','Person','sameAs',FALSE,50,2,'zocdoc.com/therapist/{id}',NULL),
('gcid:mental_health_clinic','Open Path Collective','profile_open_path','profiles_presence','etl','Person','sameAs',FALSE,30,3,'openpathcollective.org/therapist/{id}','Sliding scale marketplace'),
('gcid:mental_health_clinic','Headway / Alma network','profile_headway','profiles_presence','etl','Person','sameAs',FALSE,40,2,'headway.co/providers/{id}','Insurance-based therapy networks'),
('gcid:mental_health_clinic','Crisis protocol displayed','social_crisis_protocol','social_engagement','platform','HealthTopicContent','about',TRUE,50,1,NULL,'988 + local ER — REQUIRED on all platforms'),
('gcid:mental_health_clinic','Specialties treated','txn_specialties','transactions_outcomes','manual','MedicalSpecialty','specialty',FALSE,30,2,NULL,NULL),
('gcid:mental_health_clinic','Modalities offered','txn_modalities','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,NULL),
('gcid:mental_health_clinic','Insurance accepted','txn_insurance','transactions_outcomes','manual','Service','termsOfService',FALSE,50,1,NULL,'Critical for client acquisition'),
('gcid:mental_health_clinic','Sliding scale availability','txn_sliding_scale','transactions_outcomes','manual','Service','priceRange',FALSE,30,2,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:mental_health_clinic','profession_title','Therapist','therapist','Therapist','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','profession_title','Licensed Professional Counselor (LPC)','lpc','Licensed Professional Counselor (LPC)','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','profession_title','Licensed Clinical Social Worker (LCSW)','lcsw','Licensed Clinical Social Worker (LCSW)','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','profession_title','Licensed Marriage and Family Therapist (LMFT)','lmft','Licensed Marriage and Family Therapist (LMFT)','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','profession_title','Psychologist','psychologist','Psychologist (PhD/PsyD)','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','profession_title','Mental Health Counselor','mental-health-counselor','Mental Health Counselor','claude_generated',6,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','Anxiety & Stress','anxiety-stress','Anxiety & Stress','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','Depression','depression','Depression','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','Trauma & PTSD','trauma-ptsd','Trauma & PTSD','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','Couples Therapy','couples-therapy','Couples Therapy','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','Teen & Adolescent Therapy','teen-therapy','Teen & Adolescent Therapy','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','Grief & Loss','grief-loss','Grief & Loss','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','LGBTQ+ Affirming Therapy','lgbtq-affirming','LGBTQ+ Affirming Therapy','claude_generated',7,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','specialization','Addiction & Substance Use','addiction-substance','Addiction & Substance Use','claude_generated',8,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','product_service','Individual Therapy','individual-therapy','Individual Therapy','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','product_service','Couples Counseling','couples-counseling','Couples Counseling','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','product_service','Family Therapy','family-therapy','Family Therapy','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','product_service','Telehealth Therapy','telehealth-therapy','Telehealth Therapy','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','product_service','EMDR Therapy','emdr-therapy','EMDR Therapy','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','topic','How to Find the Right Therapist','find-right-therapist','How to Find the Right Therapist','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','topic','What to Expect in Your First Therapy Session','first-therapy-session','What to Expect in Your First Therapy Session','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','topic','CBT — How It Works','cbt-how-it-works','CBT — How It Works','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','tag','accepting new clients','accepting-new-clients','Accepting New Clients','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','tag','telehealth available','telehealth-available-mh','Telehealth Available','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','tag','sliding scale','sliding-scale-tag','Sliding Scale','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','keyword','therapist near me','therapist-near-me','Therapist near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:mental_health_clinic','keyword','anxiety therapist','anxiety-therapist-kw','Anxiety therapist','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:mental_health_clinic','keyword','couples therapist near me','couples-therapist-near-me','Couples therapist near me','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:mental_health_clinic','question','How do I know if I need therapy?','do-i-need-therapy','How do I know if I need therapy?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','question','What is the difference between a therapist and a psychiatrist?','therapist-vs-psychiatrist','What is the difference between a therapist and a psychiatrist?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:mental_health_clinic','question','Does therapy work for anxiety?','therapy-for-anxiety','Does therapy work for anxiety?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
