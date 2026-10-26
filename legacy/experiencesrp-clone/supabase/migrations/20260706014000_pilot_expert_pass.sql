-- PILOT 99% PASS: expert-audit enrichment + semantic-misfit removal + edge fixes.
-- Every row fixture-gated (the gate corrected the auditor twice during authoring).

-- 1) Semantic misfits (wrong-vertical directories)
DELETE FROM exp_vertical_node_registry WHERE gcid='gcid:chiropractor' AND node_name='Psychology Today Profile';
DELETE FROM exp_vertical_node_registry WHERE gcid='gcid:veterinarian' AND node_name='Healthgrades Veterinary Profile';

-- 2) Union near-duplicate presence variants (keep one per directory)
DELETE FROM exp_vertical_node_registry WHERE gcid='gcid:pediatric_dentist' AND node_name IN
 ('Healthgrades Provider Profile','Zocdoc Listing','WebMD Provider Listing','Vitals Provider Profile','Yelp Business Profile');
DELETE FROM exp_vertical_node_registry WHERE gcid='gcid:family_restaurant' AND node_name IN
 ('OpenTable Listing','OpenTable or Resy Profile','Yelp Verified Listing','Yelp Guest Manager Listing','Yelp Business Page');
DELETE FROM exp_vertical_node_registry WHERE gcid='gcid:auto_repair_shop' AND node_name='Yelp Business Listing' AND EXISTS
 (SELECT 1 FROM exp_vertical_node_registry x WHERE x.gcid='gcid:auto_repair_shop' AND x.node_name='Yelp Business Profile');

-- 3) Referral/partner edges: knowsAbout (topics) -> affiliation on Person facet (truthful relationship edge)
UPDATE exp_vertical_node_registry SET schema_type='Person', schema_property='affiliation',
  notes=trim(notes || ' [expert pass: partner relationships are affiliation, not knowsAbout]')
WHERE gcid IN ('gcid:chiropractor','gcid:auto_repair_shop','gcid:family_restaurant','gcid:veterinarian',
               'gcid:pediatric_dentist','gcid:insurance_agency','gcid:financial_planner','gcid:lawyer',
               'gcid:hotel','gcid:electrician','gcid:church')
  AND ring='entity_graph' AND schema_property='knowsAbout'
  AND (node_name ILIKE '%partner%' OR node_name ILIKE '%network%' OR node_name ILIKE '%affiliation%' OR node_name ILIKE '%relationship%');

-- 4) Expert enrichment nodes
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:chiropractor','NBCE Board Certification','nbce_board_certification','authority','etl','MedicalBusiness','hasCredential.name',false,0,900,'National Board of Chiropractic Examiners Parts I-IV'),
('gcid:chiropractor','Webster Technique Certification','webster_technique_certification','authority','etl','MedicalBusiness','hasCredential.name',false,0,901,'ICPA prenatal certification'),
('gcid:chiropractor','Cox Flexion-Distraction Certification','cox_flexion-distraction_certification','authority','manual','MedicalBusiness','hasCredential.name',false,0,902,''),
('gcid:chiropractor','Graston / IASTM Certification','graston___iastm_certification','authority','manual','MedicalBusiness','hasCredential.name',false,0,903,''),
('gcid:chiropractor','Medicare Acceptance','medicare_acceptance','services','crm_sync','MedicalBusiness','additionalProperty.value',false,0,904,'Distinct payer + compliance realm'),
('gcid:chiropractor','New Patient Special Offer','new_patient_special_offer','conversion','platform','MedicalBusiness','makesOffer',false,0,905,'Intro exam+X-ray offer — primary acquisition lever'),
('gcid:chiropractor','Walk-In / Same-Day Availability','walk-in___same-day_availability','services','manual','MedicalBusiness','additionalProperty.value',false,0,906,'Backs ''emergency chiropractor near me'''),
('gcid:chiropractor','On-Site X-Ray / Imaging','on-site_x-ray___imaging','services','manual','MedicalBusiness','additionalProperty.value',false,0,907,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:lawyer','State Bar Number','state_bar_number','authority','etl','Attorney','hasCredential.identifier',false,0,900,''),
('gcid:lawyer','Bar Admissions (per state/court)','bar_admissions_per_state_court','authority','etl','Attorney','hasCredential.validIn',false,0,901,''),
('gcid:lawyer','Martindale AV Preeminent Rating','martindale_av_preeminent_rating','reputation','etl','Attorney','aggregateRating.ratingValue',false,0,903,'Peer-review rating source'),
('gcid:lawyer','Free Consultation Offer','free_consultation_offer','conversion','platform','Attorney','makesOffer',false,0,904,''),
('gcid:lawyer','Contingency Fee Availability','contingency_fee_availability','services','manual','Attorney','additionalProperty.value',false,0,905,''),
('gcid:lawyer','Representative Case Results','representative_case_results','authority','manual','Attorney','additionalProperty.value',false,0,906,'Verdicts/settlements — compliance-sensitive claims'),
('gcid:lawyer','Languages Spoken','languages_spoken','identity','manual','Person','knowsLanguage',false,0,907,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:hotel','Star Rating Classification','star_rating_classification','identity','etl','Hotel','starRating',false,0,900,''),
('gcid:hotel','Amenity Set (pool/wifi/parking/gym)','amenity_set_pool_wifi_parking_gym','services','manual','Hotel','amenityFeature',false,0,905,''),
('gcid:hotel','Direct Booking Engine','direct_booking_engine','conversion','platform','Hotel','potentialAction',false,0,906,'ReserveAction — commission-free direct'),
('gcid:hotel','Meetings & Events Space','meetings__events_space','services','manual','Hotel','additionalProperty.value',false,0,907,''),
('gcid:hotel','Loyalty Program','loyalty_program','engagement','crm_sync','Hotel','memberOf',false,0,908,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:pediatric_dentist','Medicaid / CHIP Acceptance','medicaid___chip_acceptance','services','crm_sync','Dentist','additionalProperty.value',false,0,901,'Decisive access factor in pediatric dentistry'),
('gcid:pediatric_dentist','Sedation Options (nitrous/oral/GA)','sedation_options_nitrous_oral_ga','services','manual','Dentist','additionalProperty.value',false,0,902,''),
('gcid:pediatric_dentist','Hospital Privileges','hospital_privileges','entity_graph','crm_sync','Person','affiliation',false,0,903,''),
('gcid:pediatric_dentist','Special Needs Dentistry','special_needs_dentistry','services','manual','Dentist','additionalProperty.value',false,0,904,''),
('gcid:pediatric_dentist','In-House Membership Plan','in-house_membership_plan','conversion','platform','Dentist','makesOffer',false,0,905,''),
('gcid:pediatric_dentist','Emergency Dental Availability','emergency_dental_availability','services','manual','Dentist','additionalProperty.value',false,0,906,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:veterinarian','State Veterinary License','state_veterinary_license','authority','etl','VeterinaryCare','hasCredential.identifier',false,0,900,''),
('gcid:veterinarian','USDA Accreditation','usda_accreditation','authority','etl','VeterinaryCare','hasCredential.name',false,0,901,'Required for health certificates/travel'),
('gcid:veterinarian','AAHA Accreditation','aaha_accreditation','authority','etl','VeterinaryCare','memberOf',false,0,902,'Practice-level accreditation'),
('gcid:veterinarian','Fear Free Certification','fear_free_certification','authority','etl','VeterinaryCare','hasCredential.name',false,0,903,''),
('gcid:veterinarian','After-Hours / Emergency Availability','after-hours___emergency_availability','services','manual','LocalBusiness','additionalProperty.value',false,0,904,'[place facet]'),
('gcid:veterinarian','CareCredit / Pet Insurance Acceptance','carecredit___pet_insurance_acceptance','services','crm_sync','LocalBusiness','additionalProperty.value',false,0,905,'[place facet]'),
('gcid:veterinarian','Online Pharmacy','online_pharmacy','services','platform','LocalBusiness','additionalProperty.value',false,0,906,'[place facet]'),
('gcid:veterinarian','Exotic Animal Care','exotic_animal_care','services','manual','LocalBusiness','additionalProperty.value',false,0,907,'[place facet]');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:insurance_agency','NPN Number','npn_number','authority','etl','InsuranceAgency','hasCredential.identifier',false,0,900,'National Producer Number'),
('gcid:insurance_agency','State DOI Licenses','state_doi_licenses','authority','etl','InsuranceAgency','hasCredential.validIn',false,0,901,''),
('gcid:insurance_agency','Carrier Appointments','carrier_appointments','entity_graph','crm_sync','Person','affiliation',false,0,902,'Which carriers the agency writes for'),
('gcid:insurance_agency','Free Quote Offer','free_quote_offer','conversion','platform','InsuranceAgency','makesOffer',false,0,904,''),
('gcid:insurance_agency','AHIP Medicare Certification','ahip_medicare_certification','authority','etl','InsuranceAgency','hasCredential.name',false,0,905,''),
('gcid:insurance_agency','Trusted Choice Membership','trusted_choice_membership','entity_graph','etl','InsuranceAgency','memberOf',false,0,906,''),
('gcid:insurance_agency','Claims Advocacy Service','claims_advocacy_service','services','manual','InsuranceAgency','hasOfferCatalog',false,0,907,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:financial_planner','Series 65/66 Registration','series_65_66_registration','authority','etl','FinancialService','hasCredential.name',false,0,901,''),
('gcid:financial_planner','CRD Number','crd_number','authority','etl','FinancialService','hasCredential.identifier',false,0,902,''),
('gcid:financial_planner','SEC IAPD Profile','sec_iapd_profile','presence','etl','FinancialService','sameAs',false,0,904,''),
('gcid:financial_planner','Fee-Only vs Fee-Based Structure','fee-only_vs_fee-based_structure','identity','manual','FinancialService','additionalProperty.value',false,0,905,''),
('gcid:financial_planner','Free Initial Consultation','free_initial_consultation','conversion','platform','FinancialService','makesOffer',false,0,908,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:electrician','State Contractor License Number','state_contractor_license_number','authority','etl','Electrician','hasCredential.identifier',false,0,900,''),
('gcid:electrician','Master vs Journeyman Level','master_vs_journeyman_level','authority','etl','Electrician','hasCredential.credentialCategory',false,0,901,''),
('gcid:electrician','Bonded and Insured Status','bonded_and_insured_status','authority','crm_sync','Electrician','additionalProperty.value',false,0,902,''),
('gcid:electrician','24/7 Emergency Service','24_7_emergency_service','services','manual','Electrician','additionalProperty.value',false,0,903,''),
('gcid:electrician','Free Estimate Offer','free_estimate_offer','conversion','platform','Electrician','makesOffer',false,0,904,''),
('gcid:electrician','EV Charger Installation','ev_charger_installation','services','manual','Electrician','hasOfferCatalog',false,0,905,'High-growth service line'),
('gcid:electrician','Generator Installation (Generac Dealer)','generator_installation_generac_dealer','services','crm_sync','Electrician','hasOfferCatalog',false,0,906,''),
('gcid:electrician','Permit Pull Service','permit_pull_service','services','manual','Electrician','additionalProperty.value',false,0,907,''),
('gcid:electrician','Labor Warranty Terms','labor_warranty_terms','services','manual','Electrician','additionalProperty.value',false,0,908,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:auto_repair_shop','ASE Certifications (per tech)','ase_certifications_per_tech','authority','etl','AutoRepair','hasCredential.name',false,0,900,''),
('gcid:auto_repair_shop','ASE Blue Seal Shop Recognition','ase_blue_seal_shop_recognition','authority','etl','AutoRepair','hasCredential.name',false,0,901,''),
('gcid:auto_repair_shop','AAA Approved Auto Repair','aaa_approved_auto_repair','entity_graph','etl','AutoRepair','memberOf',false,0,902,''),
('gcid:auto_repair_shop','NAPA AutoCare Warranty Network','napa_autocare_warranty_network','entity_graph','crm_sync','AutoRepair','memberOf',false,0,903,'Nationwide 24mo/24k warranty backing'),
('gcid:auto_repair_shop','Loaner Car / Shuttle Service','loaner_car___shuttle_service','services','manual','AutoRepair','additionalProperty.value',false,0,904,''),
('gcid:auto_repair_shop','Digital Vehicle Inspection Reports','digital_vehicle_inspection_reports','services','platform','AutoRepair','additionalProperty.value',false,0,905,''),
('gcid:auto_repair_shop','Repair Financing (Synchrony Car Care)','repair_financing_synchrony_car_care','conversion','crm_sync','AutoRepair','makesOffer',false,0,907,''),
('gcid:auto_repair_shop','Fleet Services','fleet_services','services','manual','AutoRepair','hasOfferCatalog',false,0,908,''),
('gcid:auto_repair_shop','Towing Partnership','towing_partnership','entity_graph','crm_sync','Person','affiliation',false,0,909,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:family_restaurant','Menu URL','menu_url','services','platform','FoodEstablishment','hasMenu',false,0,900,''),
('gcid:family_restaurant','Accepts Reservations','accepts_reservations','conversion','platform','FoodEstablishment','acceptsReservations',false,0,901,''),
('gcid:family_restaurant','Cuisine Types','cuisine_types','identity','manual','FoodEstablishment','servesCuisine',false,0,902,''),
('gcid:family_restaurant','Delivery Partners (DoorDash/UberEats)','delivery_partners_doordash_ubereats','entity_graph','crm_sync','Person','affiliation',false,0,903,''),
('gcid:family_restaurant','Kids Menu and High Chairs','kids_menu_and_high_chairs','services','manual','FoodEstablishment','additionalProperty.value',false,0,904,''),
('gcid:family_restaurant','Dietary Options (vegetarian/GF)','dietary_options_vegetarian_gf','services','manual','FoodEstablishment','additionalProperty.value',false,0,905,''),
('gcid:family_restaurant','Private Events and Catering','private_events_and_catering','services','manual','FoodEstablishment','hasOfferCatalog',false,0,906,''),
('gcid:family_restaurant','Health Inspection Grade','health_inspection_grade','authority','etl','FoodEstablishment','additionalProperty.value',false,0,907,''),
('gcid:family_restaurant','Daily Specials / Happy Hour','daily_specials___happy_hour','conversion','platform','FoodEstablishment','makesOffer',false,0,908,''),
('gcid:family_restaurant','Loyalty / Rewards Program','loyalty___rewards_program','engagement','platform','FoodEstablishment','memberOf',false,0,909,'');
INSERT INTO exp_vertical_node_registry (gcid,node_name,node_slug,ring,connection_method,schema_type,schema_property,required_for_score,score_points,priority,notes) VALUES
('gcid:church','Denomination / Affiliation','denomination___affiliation','identity','manual','Organization','memberOf',false,0,900,'Denomination as parent body via memberOf (Church<Place<Organization? no: memberOf via Organization facet)'),
('gcid:church','Service Times','service_times','identity','manual','Church','event',false,0,901,''),
('gcid:church','Livestream URL','livestream_url','presence','platform','Organization','sameAs',false,0,902,''),
('gcid:church','Online Giving','online_giving','conversion','platform','Organization','potentialAction',false,0,903,'DonateAction'),
('gcid:church','Youth and Children Ministries','youth_and_children_ministries','services','manual','Organization','hasOfferCatalog',false,0,904,''),
('gcid:church','Small Groups Program','small_groups_program','services','manual','Organization','hasOfferCatalog',false,0,905,''),
('gcid:church','Sermon Podcast Archive','sermon_podcast_archive','content','rss','Person','subjectOf',false,0,906,''),
('gcid:church','Nursery and Childcare','nursery_and_childcare','services','manual','Church','amenityFeature',false,0,907,''),
('gcid:church','Wedding and Event Venue','wedding_and_event_venue','services','manual','Organization','hasOfferCatalog',false,0,908,''),
('gcid:church','Senior Pastor','senior_pastor','entity_graph','manual','Organization','employee',false,0,909,'');

-- 5) Expert enrichment taxonomy (uniqueness index makes this idempotent)
INSERT INTO exp_taxonomy (gcid,level,term,term_slug,term_display,source,schema_type,schema_property,search_intent) VALUES
('gcid:chiropractor','topic','TMJ and Jaw Pain','tmj_and_jaw_pain','TMJ and Jaw Pain','expert_pass','DefinedTerm','about',NULL),
('gcid:chiropractor','topic','Vertigo and Dizziness','vertigo_and_dizziness','Vertigo and Dizziness','expert_pass','DefinedTerm','about',NULL),
('gcid:chiropractor','topic','Plantar Fasciitis','plantar_fasciitis','Plantar Fasciitis','expert_pass','DefinedTerm','about',NULL),
('gcid:chiropractor','specialization','Webster Technique (Prenatal)','webster_technique_prenatal','Webster Technique (Prenatal)','expert_pass','DefinedTerm','knowsAbout',NULL),
('gcid:lawyer','keyword','free consultation lawyer near me','free_consultation_lawyer_near_me','free consultation lawyer near me','expert_pass',NULL,NULL,'transactional'),
('gcid:lawyer','negative_keyword','law school admissions','law_school_admissions','law school admissions','expert_pass',NULL,NULL,NULL),
('gcid:lawyer','negative_keyword','paralegal jobs','paralegal_jobs','paralegal jobs','expert_pass',NULL,NULL,NULL),
('gcid:lawyer','question','How much does a lawyer cost?','how_much_does_a_lawyer_cost','How much does a lawyer cost?','expert_pass','Question','name',NULL),
('gcid:hotel','keyword','hotels near me tonight','hotels_near_me_tonight','hotels near me tonight','expert_pass',NULL,NULL,'urgency'),
('gcid:hotel','keyword','pet friendly hotel in {city}','pet_friendly_hotel_in_city','pet friendly hotel in {city}','expert_pass',NULL,NULL,'local'),
('gcid:hotel','audience','Business Travelers','business_travelers','Business Travelers','expert_pass','Audience','audience',NULL),
('gcid:hotel','audience','Families with Children','families_with_children','Families with Children','expert_pass','Audience','audience',NULL),
('gcid:pediatric_dentist','audience','Children with Special Healthcare Needs','children_with_special_healthcare_needs','Children with Special Healthcare Needs','expert_pass','Audience','audience',NULL),
('gcid:pediatric_dentist','content_title','First Dental Visit by Age One: Why It Matters','first_dental_visit_by_age_one_why_it_matters','First Dental Visit by Age One: Why It Matters','expert_pass','Article','headline',NULL),
('gcid:pediatric_dentist','keyword','pediatric dentist that accepts medicaid','pediatric_dentist_that_accepts_medicaid','pediatric dentist that accepts medicaid','expert_pass',NULL,NULL,'transactional'),
('gcid:veterinarian','audience','Exotic Pet Owners','exotic_pet_owners','Exotic Pet Owners','expert_pass','Audience','audience',NULL),
('gcid:veterinarian','negative_keyword','veterinary school requirements','veterinary_school_requirements','veterinary school requirements','expert_pass',NULL,NULL,NULL),
('gcid:veterinarian','negative_keyword','vet tech jobs','vet_tech_jobs','vet tech jobs','expert_pass',NULL,NULL,NULL),
('gcid:veterinarian','keyword','emergency vet near me open now','emergency_vet_near_me_open_now','emergency vet near me open now','expert_pass',NULL,NULL,'urgency'),
('gcid:insurance_agency','keyword','bundle home and auto insurance','bundle_home_and_auto_insurance','bundle home and auto insurance','expert_pass',NULL,NULL,'transactional'),
('gcid:insurance_agency','keyword','independent insurance agent near me','independent_insurance_agent_near_me','independent insurance agent near me','expert_pass',NULL,NULL,'local'),
('gcid:insurance_agency','question','What is the difference between an insurance agent and a broker?','what_is_the_difference_between_an_insurance_agent_and_a_brok','What is the difference between an insurance agent and a broker?','expert_pass','Question','name',NULL),
('gcid:financial_planner','negative_keyword','CFP exam prep','cfp_exam_prep','CFP exam prep','expert_pass',NULL,NULL,NULL),
('gcid:financial_planner','keyword','fee only financial planner near me','fee_only_financial_planner_near_me','fee only financial planner near me','expert_pass',NULL,NULL,'local'),
('gcid:financial_planner','question','What is a fiduciary financial advisor?','what_is_a_fiduciary_financial_advisor','What is a fiduciary financial advisor?','expert_pass','Question','name',NULL),
('gcid:electrician','keyword','EV charger installation cost','ev_charger_installation_cost','EV charger installation cost','expert_pass',NULL,NULL,'informational'),
('gcid:electrician','keyword','emergency electrician near me','emergency_electrician_near_me','emergency electrician near me','expert_pass',NULL,NULL,'urgency'),
('gcid:electrician','keyword','panel upgrade near me','panel_upgrade_near_me','panel upgrade near me','expert_pass',NULL,NULL,'local'),
('gcid:auto_repair_shop','keyword','mechanic near me open now','mechanic_near_me_open_now','mechanic near me open now','expert_pass',NULL,NULL,'urgency'),
('gcid:auto_repair_shop','keyword','auto repair financing','auto_repair_financing','auto repair financing','expert_pass',NULL,NULL,'transactional'),
('gcid:family_restaurant','keyword','kid friendly restaurants near me','kid_friendly_restaurants_near_me','kid friendly restaurants near me','expert_pass',NULL,NULL,'local'),
('gcid:family_restaurant','keyword','restaurants with private party rooms','restaurants_with_private_party_rooms','restaurants with private party rooms','expert_pass',NULL,NULL,'service'),
('gcid:church','audience','Young Families','young_families','Young Families','expert_pass','Audience','audience',NULL),
('gcid:church','keyword','churches near me with youth programs','churches_near_me_with_youth_programs','churches near me with youth programs','expert_pass',NULL,NULL,'local')
ON CONFLICT (coalesce(gcid,'__global__'), level, term_slug) DO NOTHING;
