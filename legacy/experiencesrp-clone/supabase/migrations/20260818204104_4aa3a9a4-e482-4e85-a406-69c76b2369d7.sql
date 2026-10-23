-- media_items public read
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read media_items" ON public.media_items;
CREATE POLICY "Public read media_items" ON public.media_items
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.media_items TO anon, authenticated;
GRANT ALL ON public.media_items TO service_role;

INSERT INTO public.organizations (
  id, name, legal_name, slug, description, logo_url, cover_photo_url, website_url,
  canonical_url, gcid, entity_type, phone, address_street, address_city, address_state,
  address_zip, address_country, latitude, longitude, parent_org_id, hierarchy_path,
  hierarchy_depth, schema_type, same_as, search_rank_score, claimed, claimed_at, is_active
) VALUES (
  '11111111-0000-4000-8000-000000000001',
  'New American Funding',
  'New American Funding, LLC',
  'new-american-funding',
  'New American Funding is a leading mortgage lender and servicer dedicated to providing exceptional home loan solutions to individuals and families across the United States. With a strong commitment to customer service, innovation, and integrity, we strive to make the dream of homeownership a reality for all. As a direct lender, New American Funding has the flexibility to offer a wide range of loan programs, including Conventional, FHA, VA, USDA, and Jumbo loans.',
  'https://listings.experience.com/364/tier/25/logo/square/New_American_Funding_logo_1709756922.png',
  'https://listings.experience.com/364/tier/25/profile/square/New_American_Funding_profile_1741032428.png',
  'https://www.newamericanfunding.com',
  '/c/new-american-funding',
  'gcid:mortgage_lender',
  'enterprise',
  '(800) 450-2010',
  '1 MacArthur Place, Suite 800',
  'Santa Ana', 'CA', '92707', 'US',
  33.7361, -117.8677,
  NULL, 'new-american-funding', 0,
  'FinancialService',
  ARRAY['https://www.yelp.com/biz/new-american-funding-tustin-2','https://www.youtube.com/newamericanfunding'],
  NULL, true, now(), true
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, legal_name = EXCLUDED.legal_name, slug = EXCLUDED.slug,
  description = EXCLUDED.description, logo_url = EXCLUDED.logo_url,
  cover_photo_url = EXCLUDED.cover_photo_url, website_url = EXCLUDED.website_url,
  canonical_url = EXCLUDED.canonical_url, gcid = EXCLUDED.gcid,
  entity_type = EXCLUDED.entity_type, phone = EXCLUDED.phone,
  address_street = EXCLUDED.address_street, address_city = EXCLUDED.address_city,
  address_state = EXCLUDED.address_state, address_zip = EXCLUDED.address_zip,
  hierarchy_path = EXCLUDED.hierarchy_path, hierarchy_depth = EXCLUDED.hierarchy_depth,
  same_as = EXCLUDED.same_as, claimed = true, is_active = true;

INSERT INTO public.organizations (
  id, name, slug, description, logo_url, cover_photo_url, website_url, canonical_url,
  gcid, entity_type, phone, address_city, address_state, address_country,
  parent_org_id, hierarchy_path, hierarchy_depth, schema_type, same_as,
  search_rank_score, claimed, claimed_at, is_active
) VALUES (
  '11111111-0000-4000-8000-000000000002',
  'New American Funding - Bettendorf, IA',
  'bettendorf-1872',
  'New American Funding is an all-inclusive direct mortgage lender and servicer offering a variety of home loans including Conventional, FHA, VA, Jumbo and many more. Our philosophy is to guide current and future homeowners through every step of the mortgage lending process.',
  'https://listings.experience.com/364/tier/25/logo/square/New_American_Funding_logo_1709756922.png',
  'https://listings.experience.com/364/tier/7181/profile/square/New_American_Funding_-_Bettendorf_IA_profile_1741032641.png',
  'https://www.newamericanfunding.com/branches/Bettendorf',
  '/o/bettendorf-1872',
  'gcid:mortgage_broker',
  'office',
  '(563) 213-5137',
  'Bettendorf', 'IA', 'US',
  '11111111-0000-4000-8000-000000000001',
  'new-american-funding/midwest/bettendorf-1872', 1,
  'MortgageLoanOffice',
  ARRAY['https://www.youtube.com/newamericanfunding'],
  NULL, true, now(), true
) ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, slug = EXCLUDED.slug, description = EXCLUDED.description,
  logo_url = EXCLUDED.logo_url, cover_photo_url = EXCLUDED.cover_photo_url,
  website_url = EXCLUDED.website_url, canonical_url = EXCLUDED.canonical_url,
  gcid = EXCLUDED.gcid, entity_type = EXCLUDED.entity_type, phone = EXCLUDED.phone,
  address_city = EXCLUDED.address_city, address_state = EXCLUDED.address_state,
  parent_org_id = EXCLUDED.parent_org_id, hierarchy_path = EXCLUDED.hierarchy_path,
  hierarchy_depth = EXCLUDED.hierarchy_depth, same_as = EXCLUDED.same_as,
  claimed = true, is_active = true;

INSERT INTO public.professionals (
  id, first_name, last_name, display_name, slug, headline, bio, photo_url, cover_photo_url,
  canonical_url, gcid, job_title, phone, website_url, address_city, address_state, address_zip,
  primary_org_id, primary_license_number, primary_license_type, primary_license_state,
  primary_license_verified, primary_license_verified_at, markets_served, zip_codes_served,
  schema_type, same_as, search_rank_score, score_updated_at, local_rank, local_rank_of,
  claimed, claimed_at, claim_method, compliance_complete, compliance_score, is_active
) VALUES (
  '22222222-0000-4000-8000-000000000001',
  'Amber', 'Ernst', 'New American Funding - Amber Ernst Team', 'amber-ernst',
  'Senior Loan Consultant · NMLS # 406037',
  'With more than 19 years of experience in this ever-changing industry, I am an expert in helping people achieve the dream of homeownership. I specialize in customer service and with that comes great communication skills. Couple that with my knowledge of VA, FHA, USDA, and conventional loans—you are guaranteed to come to the closing table and purchase the home of your dreams, all while understanding and comprehending the entire process. In my free time, I enjoy running, horseback riding, and spending time with my wonderful family—Michael (husband), Gavin, Hailey, and Ava.',
  'https://listings.experience.com/364/agent/67841/profile/square/New_American_Funding_-_Amber_Ernst_Team_profile_1683580105.png',
  NULL,
  '/p/amber-ernst',
  'gcid:mortgage_broker',
  'Senior Loan Consultant',
  '(563) 579-1097',
  'https://www.newamericanfunding.com/mortgage-loans/AmberErnst',
  'Bettendorf', 'IA', '52722',
  '11111111-0000-4000-8000-000000000002',
  '406037', 'license', 'IA', true, now(),
  ARRAY['Bettendorf, IA','Davenport, IA','De Witt, IA','Eldridge, IA'],
  ARRAY['52722','52807','52806','52804','52803','52742','52748'],
  'MortgageLoanOfficer',
  ARRAY[
    'https://www.zillow.com/lender-profile/AmberErnst',
    'https://facebook.com/730601607048056',
    'https://www.instagram.com/amberernsthomeloans',
    'https://www.linkedin.com/in/amber-ernst-team/',
    'https://twitter.com/AmberErnstTeam',
    'https://reviews.lendingtree.com/amber-ernst/406037',
    'https://www.youtube.com/newamericanfunding'
  ],
  801, now(), 1, 148,
  true, now(), 'platform', true, 96, true
) ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name, slug = EXCLUDED.slug, headline = EXCLUDED.headline,
  bio = EXCLUDED.bio, photo_url = EXCLUDED.photo_url, canonical_url = EXCLUDED.canonical_url,
  gcid = EXCLUDED.gcid, job_title = EXCLUDED.job_title, phone = EXCLUDED.phone,
  website_url = EXCLUDED.website_url, address_city = EXCLUDED.address_city,
  address_state = EXCLUDED.address_state, address_zip = EXCLUDED.address_zip,
  primary_org_id = EXCLUDED.primary_org_id,
  primary_license_number = EXCLUDED.primary_license_number,
  primary_license_verified = true, markets_served = EXCLUDED.markets_served,
  zip_codes_served = EXCLUDED.zip_codes_served, same_as = EXCLUDED.same_as,
  search_rank_score = EXCLUDED.search_rank_score, local_rank = EXCLUDED.local_rank,
  local_rank_of = EXCLUDED.local_rank_of, claimed = true, is_active = true;

INSERT INTO public.professionals (
  id, first_name, last_name, display_name, slug, canonical_url, gcid, job_title,
  address_city, address_state, primary_org_id, primary_license_number, primary_license_type,
  primary_license_state, primary_license_verified, schema_type, claimed, is_active
) VALUES (
  '22222222-0000-4000-8000-000000000002',
  'Joy', 'Schneckloth', 'Joy Schneckloth', 'joy-schneckloth', '/p/joy-schneckloth',
  'gcid:mortgage_broker', 'Loan Consultant', 'Bettendorf', 'IA',
  '11111111-0000-4000-8000-000000000002', '1136784', 'license', 'IA', false,
  'MortgageLoanOfficer', false, true
) ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name, slug = EXCLUDED.slug,
  canonical_url = EXCLUDED.canonical_url, job_title = EXCLUDED.job_title,
  primary_org_id = EXCLUDED.primary_org_id,
  primary_license_number = EXCLUDED.primary_license_number, is_active = true;

DELETE FROM public.aggregate_ratings WHERE entity_id IN (
  '11111111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000002',
  '22222222-0000-4000-8000-000000000001');

INSERT INTO public.aggregate_ratings (entity_type, entity_id, source, rating_value, review_count) VALUES
  ('organization','11111111-0000-4000-8000-000000000001','all',4.88,462446),
  ('organization','11111111-0000-4000-8000-000000000001','experience.com',4.87,371900),
  ('organization','11111111-0000-4000-8000-000000000001','zillow',4.97,24500),
  ('organization','11111111-0000-4000-8000-000000000001','google',4.92,58200),
  ('organization','11111111-0000-4000-8000-000000000001','facebook',4.88,5000),
  ('organization','11111111-0000-4000-8000-000000000002','all',4.96,3766),
  ('organization','11111111-0000-4000-8000-000000000002','experience.com',4.95,3000),
  ('organization','11111111-0000-4000-8000-000000000002','zillow',5.00,15),
  ('organization','11111111-0000-4000-8000-000000000002','google',4.98,664),
  ('organization','11111111-0000-4000-8000-000000000002','facebook',5.00,73),
  ('professional','22222222-0000-4000-8000-000000000001','all',4.97,2606),
  ('professional','22222222-0000-4000-8000-000000000001','experience.com',4.96,2100),
  ('professional','22222222-0000-4000-8000-000000000001','zillow',5.00,4),
  ('professional','22222222-0000-4000-8000-000000000001','google',4.99,420),
  ('professional','22222222-0000-4000-8000-000000000001','facebook',5.00,45);

DELETE FROM public.credentials WHERE professional_id IN (
  '22222222-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000002');

INSERT INTO public.credentials (
  professional_id, credential_type, name, identifier, issuing_org, issuing_org_url,
  issuing_state, valid_from, is_current, verified, verified_at, verification_url,
  verification_method, schema_credential_category
) VALUES
  ('22222222-0000-4000-8000-000000000001','license','NMLS Mortgage Loan Originator License','406037',
   'Nationwide Multistate Licensing System (NMLS)','https://www.nmlsconsumeraccess.org','IA',
   '2006-01-01', true, true, now(), 'https://www.nmlsconsumeraccess.org/EntityDetails.aspx?ID=406037',
   'authority_verified','license'),
  ('22222222-0000-4000-8000-000000000002','license','NMLS Mortgage Loan Originator License','1136784',
   'Nationwide Multistate Licensing System (NMLS)','https://www.nmlsconsumeraccess.org','IA',
   NULL, true, false, NULL, NULL, NULL, 'license');

DELETE FROM public.graph_nodes WHERE entity_id IN (
  '11111111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000002',
  '22222222-0000-4000-8000-000000000001');

INSERT INTO public.graph_nodes (entity_type, entity_id, ring, node_type, title, schema_type, schema_property, source, is_active)
SELECT 'organization','11111111-0000-4000-8000-000000000001',3,'product_service',t,'Service','makesOffer','manual',true
FROM unnest(ARRAY['Conventional','FHA','VA','USDA','Jumbo','Non-QM','Cash-Out Refinance','30-Year Fixed','15-Year Fixed','ARM','Reverse Mortgage']) t;

INSERT INTO public.graph_nodes (entity_type, entity_id, ring, node_type, title, schema_type, schema_property, source, is_active)
SELECT 'organization','11111111-0000-4000-8000-000000000002',3,'product_service',t,'Service','makesOffer','manual',true
FROM unnest(ARRAY['FHA Home Loan','VA Home Loan','Jumbo Home Loan','Mortgage Refinance']) t;

INSERT INTO public.graph_nodes (entity_type, entity_id, ring, node_type, title, schema_type, schema_property, source, is_active)
SELECT 'professional','22222222-0000-4000-8000-000000000001',3,'product_service',t,'Service','makesOffer','manual',true
FROM unnest(ARRAY['Mortgage Loan Officer','FHA Home Loan','VA Home Loan','Jumbo Home Loan','Down Payment Assistance','Conventional Home Loan','Home Renovation Loan','Mortgage Refinance']) t;

INSERT INTO public.graph_nodes (entity_type, entity_id, ring, node_type, title, schema_type, schema_property, source, is_active)
SELECT 'professional','22222222-0000-4000-8000-000000000001',3,'specialty',t,'Thing','knowsAbout','manual',true
FROM unnest(ARRAY['Mortgage Lending','Purchase','Refinance','Conventional Loan','VA Loan','FHA Loan','Reverse Mortgage','Construction Loan']) t;

INSERT INTO public.graph_nodes (entity_type, entity_id, ring, node_type, title, url, schema_type, schema_property, source, source_id, verified, is_active) VALUES
  ('organization','11111111-0000-4000-8000-000000000001',2,'social_profile','Google',NULL,'Organization','sameAs','api',NULL,true,true),
  ('organization','11111111-0000-4000-8000-000000000001',2,'social_profile','Yelp','https://www.yelp.com/biz/new-american-funding-tustin-2','Organization','sameAs','api',NULL,true,true),
  ('organization','11111111-0000-4000-8000-000000000001',2,'social_profile','YouTube','https://www.youtube.com/newamericanfunding','Organization','sameAs','api',NULL,true,true),
  ('organization','11111111-0000-4000-8000-000000000002',2,'social_profile','Google',NULL,'Organization','sameAs','api',NULL,true,true),
  ('organization','11111111-0000-4000-8000-000000000002',2,'social_profile','YouTube','https://www.youtube.com/newamericanfunding','Organization','sameAs','api',NULL,true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','Zillow','https://www.zillow.com/lender-profile/AmberErnst','Person','sameAs','api',NULL,true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','Facebook','https://facebook.com/730601607048056','Person','sameAs','oauth',NULL,true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','Instagram','https://www.instagram.com/amberernsthomeloans','Person','sameAs','oauth',NULL,true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','LinkedIn','https://www.linkedin.com/in/amber-ernst-team/','Person','sameAs','oauth',NULL,true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','Google',NULL,'Person','sameAs','api','ChIJiyUEqjc34ocR3pb0gL5myug',true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','X','https://twitter.com/AmberErnstTeam','Person','sameAs','oauth',NULL,true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','LendingTree','https://reviews.lendingtree.com/amber-ernst/406037','Person','sameAs','etl',NULL,true,true),
  ('professional','22222222-0000-4000-8000-000000000001',2,'social_profile','YouTube','https://www.youtube.com/newamericanfunding','Person','sameAs','api',NULL,true,true);

INSERT INTO public.graph_nodes (entity_type, entity_id, ring, node_type, title, extracted_data, schema_type, source, is_active) VALUES
  ('organization','11111111-0000-4000-8000-000000000001',0,'profile_attributes','Profile attributes',
   '{"year_started":2003,"timezone":"PST","nmls_id":"6606","disclaimer":"NMLS Consumer Access © 2026 New American Funding, LLC. All Rights Reserved. NMLS ID#6606. Corporate Office: 1 MacArthur Place, Suite 800, Santa Ana, CA 92707. 800.450.2010"}'::jsonb,
   'Organization','manual',true),
  ('organization','11111111-0000-4000-8000-000000000002',0,'profile_attributes','Profile attributes',
   '{"year_started":2003,"timezone":"CST","nmls_id":"6606","region":"Midwest","disclaimer":"NMLS Consumer Access © 2026 New American Funding, LLC. All Rights Reserved. NMLS ID#6606. Corporate Office: 1 MacArthur Place, Suite 800, Santa Ana, CA 92707. 800.450.2010"}'::jsonb,
   'Organization','manual',true),
  ('professional','22222222-0000-4000-8000-000000000001',0,'profile_attributes','Profile attributes',
   '{"year_started":2006,"years_experience":19,"timezone":"CST","nmls_id":"406037","badges":["Top 5%","Claimed","Pro","License Verified"],"prequalify_url":"https://www.newamericanfunding.com/lfj-lps/prequal/?src=2640338","region":"Midwest","disclaimer":"NMLS Consumer Access © 2026 New American Funding, LLC. All Rights Reserved. NMLS ID#6606. Corporate Office: 1 MacArthur Place, Suite 800, Santa Ana, CA 92707. 800.450.2010","serving_areas":[{"city":"Bettendorf","state":"IA","zips":["52722"]},{"city":"Davenport","state":"IA","zips":["52807","52806","52804","52803"]},{"city":"De Witt","state":"IA","zips":["52742"]},{"city":"Eldridge","state":"IA","zips":["52748"]}]}'::jsonb,
   'Person','manual',true);

DELETE FROM public.reviews WHERE entity_id = '22222222-0000-4000-8000-000000000001';

INSERT INTO public.reviews (
  entity_type, entity_id, rating, body, reviewer_name, review_date, source,
  reply_body, reply_date, reply_source, sentiment, is_verified, is_featured, schema_type,
  locations_mentioned
) VALUES
  ('professional','22222222-0000-4000-8000-000000000001',5.0,
   'I loved how each step of the process was explained to us in detail and we always had an understanding of the next steps. The team processed our loan in a timely matter and were very professional and respectful.',
   'McKenna C','2026-02-11','experience.com',
   'Thank you so much, McKenna! We''re so glad everything felt clear along the way. Congrats on your new home!',
   '2026-02-12','owner','positive',true,true,'Review',ARRAY['Moline, IL']),
  ('professional','22222222-0000-4000-8000-000000000001',5.0,
   'Amber made the impossible possible for us. As a federal employee who was furloughed for 43 days, we should not have been able to close on this home, but they made it happen.',
   'Jovita A M','2025-11-17','experience.com',
   'Aww Jovita, we are SO happy for you and thankful to be part of the turn around!',
   '2025-11-18','owner','positive',true,true,'Review',ARRAY['Walcott, IA']),
  ('professional','22222222-0000-4000-8000-000000000001',5.0,
   'The enthusiasm, the knowledge, the organization, the communication, the genuineness, the support and the availability of these ladies was amazing! They made my first home buying experience easy!',
   'Julie J A','2025-10-20','experience.com',
   'Thank you Julie! Congratulations on your first home — it was a joy working with you.',
   '2025-10-21','owner','positive',true,false,'Review',ARRAY['Davenport, IA']),
  ('professional','22222222-0000-4000-8000-000000000001',4.83,
   'Working with Amber Ernst and the team was an absolute pleasure from start to finish. They made it feel smooth and manageable. Highly professional.',
   'Hagan A','2026-06-17','experience.com',
   'Thank you, Hagan! We appreciate you trusting our team with your home loan.',
   '2026-06-18','owner','positive',true,false,'Review',ARRAY['De Witt, IA']),
  ('professional','22222222-0000-4000-8000-000000000001',5.0,
   'Amber has such a great team. Through all the challenges an Army PCS brings, the team kept me informed, stress free and was transparent the entire process.',
   'Jovanee J','2026-06-19','google',
   NULL, NULL, NULL,'positive',false,false,'Review',NULL);