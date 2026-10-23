-- ============================================================
-- SEED: Veterinarian vertical (gcid:veterinarian)
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
WHERE gcid = 'gcid:veterinarian';

-- 2. Knowledge model
INSERT INTO exp_category_knowledge
  (gcid, entity_type, pricing_tier, status,
   terminology, services, compliance_rules, customer_journey,
   ranking_factors, review_vocabulary, content_topics, expertise_signals,
   scoring_weights, ai_agents, knowledge_pct, is_launched)
VALUES (
  'gcid:veterinarian', 'both', 'professional', 'active',
  ARRAY['DVM', 'VMD', 'AVMA', 'vaccination', 'spay', 'neuter', 'microchip', 'heartworm', 'flea prevention', 'dental prophylaxis', 'wellness exam', 'titer test', 'radiograph', 'ultrasound', 'bloodwork', 'CBC', 'chemistry panel', 'anesthesia', 'surgery', 'zoonotic', 'exotic animal', 'emergency vet', 'ASPCA', 'AAHA accreditation', 'Fear Free', 'triage'],
  '["Annual wellness exams","Vaccinations","Spay and neuter","Dental cleanings","Emergency care","Surgical procedures","Diagnostics (X-ray, ultrasound, bloodwork)","Senior pet care","Parasite prevention","Nutritional counseling","Behavioral advice","Microchipping","End-of-life care","Exotic animal care (if applicable)","Telemedicine / virtual consults"]'::jsonb,
  ARRAY['State veterinary medical board licensing', 'No guarantee of treatment outcomes for animals', 'AVMA ethical guidelines', 'Drug dispensing regulations (DEA for controlled substances)', 'No HIPAA (animals are not people) but client privacy expected', 'VCPR (Veterinarian-Client-Patient Relationship) required for prescribing', 'No misleading claims about treatments or outcomes'],
  '["New pet / lapsed care / emergency","Searching for vet / insurance compatibility","New patient intake (pet history form)","Annual wellness or sick visit","Diagnostics and treatment plan","Follow-up care and medication","Ongoing annual relationship"]'::jsonb,
  '{"primary":["AAHA accreditation","State DVM license","Client reviews","Fear Free certification","Emergency appointment availability"],"secondary":["Exotic animal capabilities","Dental capability","In-house diagnostics","Boarding/grooming","Pet insurance acceptance"]}'::jsonb,
  ARRAY['treated my dog like family', 'went above and beyond', 'diagnosed a problem others missed', 'gentle with anxious pets', 'fear free approach', 'clean and modern clinic', 'saved my cat''s life', 'clearly explained the diagnosis', 'affordable pricing', 'recommended to all pet owners'],
  ARRAY['How often should your pet see the vet?', 'Essential vaccines for dogs and cats', 'Spaying and neutering — benefits and timing', 'Dental health for pets — why it matters', 'Signs your pet needs emergency care', 'Senior pet care guide', 'Heartworm prevention — is your pet protected?', 'Reading a pet food label', 'Puppy and kitten first vet visit guide', 'How to prepare your pet for anesthesia', 'Understanding your pet''s bloodwork', 'Microchipping your pet', 'Obesity in pets — health risks and diet tips', 'Fear-free vet visits for anxious pets', 'Pet insurance — is it worth it?'],
  '{"primary":["DVM or VMD degree","State veterinary license","AVMA membership","AAHA accreditation"],"secondary":["Fear Free certification","Board-certified specialists (DACVS, DACVIM)","Exotic animal training","In-house laboratory capability"]}'::jsonb,
  '{"profile_completeness":0.17,"review_volume":0.26,"license_verified":0.15,"aaha_accreditation":0.14,"technology":0.14,"schema_completeness":0.14}'::jsonb,
  '{"sdr":{"enabled":false},"receptionist":{"enabled":true},"review_responder":{"enabled":true,"vocabulary":"veterinary"},"content_assistant":{"enabled":true,"topics":["pet health","preventive care","pet nutrition","emergency signs"]},"qa_assistant":{"enabled":true}}'::jsonb,
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
  'gcid:veterinarian',
  TRUE, TRUE,
  TRUE, FALSE,
  'License #{license_number}', 'DVM / VMD License',
  ARRAY['Licensed Veterinarian in [State] | DVM/VMD', 'This content is for general pet health information — always consult your veterinarian for your pet''s specific needs', 'If your pet is having an emergency, call your veterinarian or the nearest emergency animal hospital immediately'],
  ARRAY['no guaranteed outcomes for animal treatment', 'no specific prescribing without a VCPR', 'no misleading treatment claims'],
  ARRAY['cure all pet diseases', 'guaranteed healthy pet', 'best vet guaranteed', 'cheapest vet in city', '100% safe surgery'],
  FALSE, FALSE, FALSE,
  ARRAY['State Veterinary Medical Board', 'AVMA (American Veterinary Medical Association)', 'DEA (controlled substance prescribing)', 'USDA APHIS (for USDA-accredited vets)'],
  'VCPR (Veterinarian-Client-Patient Relationship) is required before prescribing medications. Not subject to HIPAA (animals are not patients under HIPAA) but client privacy is still an ethical expectation. AAHA accreditation is the gold standard for quality — prominently displayed.'
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
('gcid:veterinarian','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,NULL),
('gcid:veterinarian','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,NULL),
('gcid:veterinarian','Job title','core_title','core_identity','manual','Person','jobTitle',TRUE,10,3,NULL,NULL),
('gcid:veterinarian','Primary market (city/state)','core_market','core_identity','manual','Person','areaServed',TRUE,20,2,NULL,NULL),
('gcid:veterinarian','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:veterinarian','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{slug}',NULL),
('gcid:veterinarian','Facebook page','profile_facebook','profiles_presence','oauth','Person','sameAs',FALSE,20,5,'facebook.com/{slug}',NULL),
('gcid:veterinarian','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:veterinarian','Wikidata entity','profile_wikidata','profiles_presence','manual','Person','sameAs',FALSE,40,4,'wikidata.org/wiki/{id}',NULL),
('gcid:veterinarian','VOCE professional articles','content_voce','published_content','platform','Article','author',FALSE,40,1,NULL,NULL),
('gcid:veterinarian','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,NULL),
('gcid:veterinarian','Blog / website posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:veterinarian','LinkedIn articles','content_linkedin','published_content','etl','Article','author',FALSE,15,3,NULL,NULL),
('gcid:veterinarian','Social posts','content_social','published_content','platform','SocialMediaPosting','author',FALSE,5,4,NULL,NULL),
('gcid:veterinarian','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:veterinarian','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:veterinarian','Video testimonials','media_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:veterinarian','VOCE audio reads','media_audio','media_voice','platform','AudioObject','author',FALSE,5,4,NULL,NULL),
('gcid:veterinarian','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,'Primary review source'),
('gcid:veterinarian','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,'Proprietary reviews'),
('gcid:veterinarian','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,NULL),
('gcid:veterinarian','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:veterinarian','Client testimonials','social_testimonials','social_engagement','manual','Review','review',FALSE,15,3,NULL,NULL),
('gcid:veterinarian','Firm / practice office location page','upstream_office','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:veterinarian','Brand / organization node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:veterinarian','Category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL),
('gcid:veterinarian','State DVM/VMD license','auth_dvm_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,NULL,'State veterinary medical board'),
('gcid:veterinarian','AAHA accreditation','auth_aaha','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',FALSE,60,2,'aaha.org/find-a-hospital/{id}','American Animal Hospital Association — gold standard accreditation'),
('gcid:veterinarian','Fear Free certification','auth_fear_free','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,30,3,'fearfreepets.com/find-a-professional/{id}',NULL),
('gcid:veterinarian','AVMA membership','auth_avma','verifiable_authority','manual','ProgramMembership','memberOf',FALSE,20,4,NULL,NULL),
('gcid:veterinarian','Yelp animal hospital listing','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',TRUE,60,1,'yelp.com/biz/{slug}','Highest-traffic directory for veterinary practices'),
('gcid:veterinarian','Vetstreet / VitusVet profile','profile_vetstreet','profiles_presence','etl','LocalBusiness','sameAs',FALSE,40,2,NULL,NULL),
('gcid:veterinarian','AAHA hospital finder','profile_aaha_finder','profiles_presence','etl','LocalBusiness','sameAs',FALSE,50,2,'aaha.org/find-a-hospital/{id}',NULL),
('gcid:veterinarian','PetMD vet finder','profile_petmd','profiles_presence','etl','Person','sameAs',FALSE,30,3,'petmd.com/vet/{id}',NULL),
('gcid:veterinarian','Pet insurance accepted','txn_insurance','transactions_outcomes','manual','Service','termsOfService',FALSE,40,1,NULL,'Trupanion, Nationwide, ASPCA — high patient acquisition value'),
('gcid:veterinarian','Species treated','txn_species','transactions_outcomes','manual','Service','serviceType',FALSE,30,2,NULL,'Dogs, cats, exotic — critical differentiator'),
('gcid:veterinarian','In-house diagnostics','auth_technology','verifiable_authority','manual','MedicalDevice','provider',FALSE,20,4,NULL,'Blood analyzer, digital X-ray, ultrasound')
ON CONFLICT (gcid, node_slug) DO NOTHING;

-- 5. Taxonomy (7 levels)
INSERT INTO exp_taxonomy
  (gcid, level, term, term_slug, term_display, source, priority,
   use_srp, use_voce, use_search, use_agents, use_schema)
VALUES
('gcid:veterinarian','profession_title','Veterinarian','veterinarian-title','Veterinarian','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','profession_title','DVM / VMD','dvm-vmd','DVM / VMD','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','profession_title','Veterinary Doctor','veterinary-doctor','Veterinary Doctor','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','specialization','Small Animal (Dogs & Cats)','small-animal','Small Animal (Dogs & Cats)','claude_generated',1,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','specialization','Emergency & Critical Care','emergency-vet','Emergency & Critical Care','claude_generated',2,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','specialization','Exotic Animal Care','exotic-animal','Exotic Animal Care','claude_generated',3,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','specialization','Senior Pet Care','senior-pet','Senior Pet Care','claude_generated',4,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','specialization','Dental Veterinary Care','vet-dental','Dental Veterinary Care','claude_generated',5,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','specialization','Fear Free Practice','fear-free-vet','Fear Free Practice','claude_generated',6,TRUE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','product_service','Annual Wellness Exam','annual-wellness-vet','Annual Wellness Exam','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','product_service','Vaccinations','vaccinations-vet','Vaccinations','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','product_service','Spay & Neuter','spay-neuter','Spay & Neuter','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','product_service','Dental Cleaning','dental-cleaning-vet','Dental Cleaning','claude_generated',4,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','product_service','Emergency Care','emergency-care-vet','Emergency Care','claude_generated',5,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','topic','How Often Should Your Pet See the Vet?','pet-vet-frequency','How Often Should Your Pet See the Vet?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','topic','Essential Vaccines for Dogs and Cats','pet-vaccines','Essential Vaccines for Dogs and Cats','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','topic','Signs Your Pet Needs Emergency Care','pet-emergency-signs','Signs Your Pet Needs Emergency Care','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','tag','AAHA accredited','aaha-accredited','AAHA Accredited','claude_generated',1,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','tag','Fear Free','fear-free-tag','Fear Free','claude_generated',2,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','tag','accepting new patients','accepting-new-pets','Accepting New Patients','claude_generated',3,TRUE,FALSE,TRUE,TRUE,TRUE),
('gcid:veterinarian','keyword','veterinarian near me','vet-near-me','Veterinarian near me','claude_generated',1,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:veterinarian','keyword','emergency vet near me','emergency-vet-near-me','Emergency vet near me','claude_generated',2,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:veterinarian','keyword','cat vet near me','cat-vet-near-me','Cat vet near me','claude_generated',3,FALSE,FALSE,TRUE,TRUE,FALSE),
('gcid:veterinarian','question','How much does a vet visit cost?','vet-visit-cost','How much does a vet visit cost?','claude_generated',1,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','question','What vaccines does my dog need every year?','dog-vaccines-annual','What vaccines does my dog need every year?','claude_generated',2,FALSE,TRUE,TRUE,TRUE,TRUE),
('gcid:veterinarian','question','Is pet insurance worth it?','pet-insurance-worth-it','Is pet insurance worth it?','claude_generated',3,FALSE,TRUE,TRUE,TRUE,TRUE)
ON CONFLICT (gcid, level, term_slug) DO NOTHING;
