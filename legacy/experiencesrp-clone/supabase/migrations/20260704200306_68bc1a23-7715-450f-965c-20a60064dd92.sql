-- ============================================================
-- 20260704180000_directory_packs.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS public.exp_directory_packs (
  directory_key       text PRIMARY KEY,
  directory_name      text NOT NULL,
  canonical_domain    text,
  url_pattern         text,
  schema_type         text NOT NULL DEFAULT 'WebSite',
  schema_property     text NOT NULL DEFAULT 'sameAs',
  tier                smallint NOT NULL DEFAULT 3
                        CHECK (tier BETWEEN 1 AND 4),
  pack_family         text NOT NULL DEFAULT 'universal',
  connection_method   text NOT NULL DEFAULT 'manual'
                        CHECK (connection_method IN ('oauth','etl','crm_sync','api','manual','rss','platform')),
  verification_status text NOT NULL DEFAULT 'verified'
                        CHECK (verification_status IN ('verified','unverified')),
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dirpacks_family ON public.exp_directory_packs(pack_family);
CREATE INDEX IF NOT EXISTS idx_dirpacks_tier   ON public.exp_directory_packs(tier);
CREATE INDEX IF NOT EXISTS idx_dirpacks_active ON public.exp_directory_packs(is_active);

GRANT SELECT ON public.exp_directory_packs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_directory_packs TO authenticated;
GRANT ALL ON public.exp_directory_packs TO service_role;

ALTER TABLE public.exp_directory_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read exp_directory_packs" ON public.exp_directory_packs;
CREATE POLICY "Public read exp_directory_packs"
  ON public.exp_directory_packs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Auth write exp_directory_packs" ON public.exp_directory_packs;
CREATE POLICY "Auth write exp_directory_packs"
  ON public.exp_directory_packs FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.exp_category_directory_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gcid          text NOT NULL REFERENCES public.gbp_categories(gcid),
  directory_key text NOT NULL REFERENCES public.exp_directory_packs(directory_key),
  source        text NOT NULL DEFAULT 'family'
                  CHECK (source IN ('universal','family','manual')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unique_gcid_directory UNIQUE (gcid, directory_key)
);

CREATE INDEX IF NOT EXISTS idx_catdir_gcid ON public.exp_category_directory_map(gcid);
CREATE INDEX IF NOT EXISTS idx_catdir_dir  ON public.exp_category_directory_map(directory_key);

GRANT SELECT ON public.exp_category_directory_map TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exp_category_directory_map TO authenticated;
GRANT ALL ON public.exp_category_directory_map TO service_role;

ALTER TABLE public.exp_category_directory_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read exp_category_directory_map" ON public.exp_category_directory_map;
CREATE POLICY "Public read exp_category_directory_map"
  ON public.exp_category_directory_map FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Auth write exp_category_directory_map" ON public.exp_category_directory_map;
CREATE POLICY "Auth write exp_category_directory_map"
  ON public.exp_category_directory_map FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- 20260704180100_seed_universal_directories.sql
-- ============================================================
INSERT INTO public.exp_directory_packs
  (directory_key, directory_name, canonical_domain, url_pattern, schema_type, schema_property, tier, pack_family, connection_method, verification_status, notes)
VALUES
('google_business_profile','Google Business Profile','google.com','google.com/maps?cid={id}','LocalBusiness','sameAs',1,'universal','oauth','verified','Primary local listing'),
('apple_maps','Apple Business Connect','apple.com','maps.apple.com/place?auid={id}','LocalBusiness','sameAs',1,'universal','manual','verified',NULL),
('bing_places','Bing Places','bing.com','bing.com/maps','LocalBusiness','sameAs',1,'universal','manual','verified',NULL),
('facebook','Facebook Page','facebook.com','facebook.com/{id}','Organization','sameAs',1,'universal','oauth','verified',NULL),
('yelp','Yelp','yelp.com','yelp.com/biz/{id}','LocalBusiness','sameAs',1,'universal','etl','verified',NULL),
('foursquare','Foursquare','foursquare.com','foursquare.com/v/{id}','LocalBusiness','sameAs',2,'universal','api','verified','Data aggregator, feeds many downstream'),
('data_axle','Data Axle','data-axle.com',NULL,'LocalBusiness','sameAs',2,'universal','etl','verified','Aggregator (formerly Infogroup)'),
('localeze','Neustar Localeze','neustarlocaleze.biz',NULL,'LocalBusiness','sameAs',2,'universal','etl','verified','Aggregator'),
('yellow_pages','Yellow Pages','yellowpages.com','yellowpages.com/{id}','LocalBusiness','sameAs',2,'universal','etl','verified',NULL),
('better_business_bureau','Better Business Bureau','bbb.org','bbb.org/us/{id}','Organization','sameAs',2,'universal','manual','verified',NULL),
('nextdoor','Nextdoor','nextdoor.com','nextdoor.com/pages/{id}','LocalBusiness','sameAs',2,'universal','manual','verified',NULL),
('manta','Manta','manta.com','manta.com/c/{id}','Organization','sameAs',2,'universal','etl','verified',NULL),
('trustpilot','Trustpilot','trustpilot.com','trustpilot.com/review/{id}','Organization','sameAs',2,'universal','etl','verified',NULL),
('mapquest','MapQuest','mapquest.com',NULL,'LocalBusiness','sameAs',2,'universal','etl','verified',NULL),
('superpages','Superpages','superpages.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm URL pattern'),
('citysearch','Citysearch','citysearch.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('hotfrog','Hotfrog','hotfrog.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('brownbook','Brownbook','brownbook.net',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('ezlocal','EZlocal','ezlocal.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('chamberofcommerce','ChamberofCommerce.com','chamberofcommerce.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('elocal','eLocal','elocal.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('cylex','Cylex','cylex.us.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('n49','n49','n49.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm'),
('showmelocal','ShowMeLocal','showmelocal.com',NULL,'LocalBusiness','sameAs',3,'universal','etl','unverified','to-confirm')
ON CONFLICT (directory_key) DO NOTHING;

-- ============================================================
-- 20260704180200_seed_vertical_directory_packs.sql
-- ============================================================
INSERT INTO public.exp_directory_packs
  (directory_key, directory_name, canonical_domain, url_pattern, schema_type, schema_property, tier, pack_family, connection_method, verification_status, notes)
VALUES
('healthgrades','Healthgrades','healthgrades.com','healthgrades.com/physician/{id}','WebSite','sameAs',2,'medical','etl','verified',NULL),
('zocdoc','Zocdoc','zocdoc.com','zocdoc.com/doctor/{id}','WebSite','sameAs',2,'medical','etl','verified',NULL),
('vitals','Vitals','vitals.com','vitals.com/doctors/{id}','WebSite','sameAs',2,'medical','etl','verified',NULL),
('webmd','WebMD Physician Directory','webmd.com','doctor.webmd.com/doctor/{id}','WebSite','sameAs',2,'medical','etl','verified',NULL),
('us_news_health','US News Health','health.usnews.com','health.usnews.com/doctors/{id}','WebSite','sameAs',2,'medical','etl','verified',NULL),
('psychology_today','Psychology Today','psychologytoday.com','psychologytoday.com/us/{id}','WebSite','sameAs',2,'medical','etl','verified','Mental health / therapy'),
('doximity','Doximity','doximity.com',NULL,'WebSite','sameAs',3,'medical','etl','verified','Physician network'),
('castle_connolly','Castle Connolly Top Doctors','castleconnolly.com',NULL,'WebSite','sameAs',3,'medical','etl','verified',NULL),
('ratemds','RateMDs','ratemds.com',NULL,'WebSite','sameAs',3,'medical','etl','verified',NULL),
('wellness_com','Wellness.com','wellness.com',NULL,'WebSite','sameAs',3,'medical','etl','unverified','to-confirm'),
('avvo','Avvo','avvo.com','avvo.com/attorneys/{id}','WebSite','sameAs',2,'legal','etl','verified',NULL),
('justia','Justia','justia.com','lawyers.justia.com/lawyer/{id}','WebSite','sameAs',2,'legal','etl','verified',NULL),
('martindale','Martindale-Hubbell','martindale.com','martindale.com/{id}','WebSite','sameAs',2,'legal','etl','verified',NULL),
('findlaw','FindLaw','findlaw.com','lawyers.findlaw.com/profile/{id}','WebSite','sameAs',2,'legal','etl','verified',NULL),
('super_lawyers','Super Lawyers','superlawyers.com','superlawyers.com/{id}','WebSite','sameAs',3,'legal','etl','verified',NULL),
('best_lawyers','Best Lawyers','bestlawyers.com',NULL,'WebSite','sameAs',3,'legal','etl','verified',NULL),
('lawyers_com','Lawyers.com','lawyers.com',NULL,'WebSite','sameAs',3,'legal','etl','verified',NULL),
('nolo','Nolo','nolo.com',NULL,'WebSite','sameAs',3,'legal','etl','unverified','to-confirm'),
('angi','Angi','angi.com','angi.com/companylist/{id}','WebSite','sameAs',2,'home_services','etl','verified','formerly Angie''s List'),
('homeadvisor','HomeAdvisor','homeadvisor.com','homeadvisor.com/rated.{id}','WebSite','sameAs',2,'home_services','etl','verified',NULL),
('thumbtack','Thumbtack','thumbtack.com','thumbtack.com/{id}','WebSite','sameAs',2,'home_services','etl','verified',NULL),
('houzz','Houzz','houzz.com','houzz.com/pro/{id}','WebSite','sameAs',2,'home_services','etl','verified','Design/remodel'),
('buildzoom','BuildZoom','buildzoom.com',NULL,'WebSite','sameAs',3,'home_services','etl','verified',NULL),
('porch','Porch','porch.com',NULL,'WebSite','sameAs',3,'home_services','etl','verified',NULL),
('bark','Bark.com','bark.com',NULL,'WebSite','sameAs',3,'home_services','etl','verified',NULL),
('networx','Networx','networx.com',NULL,'WebSite','sameAs',3,'home_services','etl','unverified','to-confirm'),
('opentable','OpenTable','opentable.com','opentable.com/r/{id}','WebSite','sameAs',2,'restaurants','etl','verified',NULL),
('resy','Resy','resy.com','resy.com/cities/{id}','WebSite','sameAs',2,'restaurants','etl','verified',NULL),
('tripadvisor','TripAdvisor','tripadvisor.com','tripadvisor.com/Restaurant_Review-{id}','WebSite','sameAs',2,'restaurants','etl','verified',NULL),
('zomato','Zomato','zomato.com','zomato.com/{id}','WebSite','sameAs',3,'restaurants','etl','verified',NULL),
('grubhub','Grubhub','grubhub.com','grubhub.com/restaurant/{id}','WebSite','sameAs',2,'restaurants','etl','verified','Delivery'),
('doordash','DoorDash','doordash.com','doordash.com/store/{id}','WebSite','sameAs',2,'restaurants','etl','verified','Delivery'),
('ubereats','Uber Eats','ubereats.com','ubereats.com/store/{id}','WebSite','sameAs',2,'restaurants','etl','verified','Delivery'),
('the_infatuation','The Infatuation','theinfatuation.com',NULL,'WebSite','sameAs',3,'restaurants','etl','verified',NULL),
('eater','Eater','eater.com',NULL,'WebSite','sameAs',3,'restaurants','etl','verified',NULL),
('zagat','Zagat','zagat.com',NULL,'WebSite','sameAs',3,'restaurants','etl','unverified','status uncertain'),
('dealerrater','DealerRater','dealerrater.com','dealerrater.com/dealer/{id}','WebSite','sameAs',2,'auto','etl','verified',NULL),
('cars_com','Cars.com','cars.com','cars.com/dealers/{id}','WebSite','sameAs',2,'auto','etl','verified',NULL),
('cargurus','CarGurus','cargurus.com','cargurus.com/Cars/m-{id}','WebSite','sameAs',2,'auto','etl','verified',NULL),
('autotrader','AutoTrader','autotrader.com',NULL,'WebSite','sameAs',3,'auto','etl','verified',NULL),
('edmunds','Edmunds','edmunds.com','edmunds.com/dealerships/{id}','WebSite','sameAs',3,'auto','etl','verified',NULL),
('repairpal','RepairPal','repairpal.com','repairpal.com/shop/{id}','WebSite','sameAs',2,'auto','etl','verified','Repair shops'),
('booksy','Booksy','booksy.com','booksy.com/{id}','WebSite','sameAs',2,'beauty_wellness','etl','verified',NULL),
('styleseat','StyleSeat','styleseat.com','styleseat.com/{id}','WebSite','sameAs',2,'beauty_wellness','etl','verified',NULL),
('vagaro','Vagaro','vagaro.com','vagaro.com/{id}','WebSite','sameAs',2,'beauty_wellness','etl','verified',NULL),
('mindbody','Mindbody','mindbodyonline.com',NULL,'WebSite','sameAs',2,'beauty_wellness','etl','verified','Fitness/wellness booking'),
('classpass','ClassPass','classpass.com',NULL,'WebSite','sameAs',3,'beauty_wellness','etl','verified',NULL),
('wellnessliving','WellnessLiving','wellnessliving.com',NULL,'WebSite','sameAs',3,'beauty_wellness','etl','unverified','to-confirm'),
('thomasnet','ThomasNet','thomasnet.com','thomasnet.com/profile/{id}','WebSite','sameAs',2,'b2b_industrial','etl','verified',NULL),
('kompass','Kompass','kompass.com',NULL,'WebSite','sameAs',3,'b2b_industrial','etl','verified',NULL),
('industrynet','IndustryNet','industrynet.com',NULL,'WebSite','sameAs',3,'b2b_industrial','etl','verified',NULL),
('globalspec','GlobalSpec','globalspec.com',NULL,'WebSite','sameAs',3,'b2b_industrial','etl','verified',NULL),
('grainger','Grainger','grainger.com',NULL,'WebSite','sameAs',3,'b2b_industrial','etl','verified','Supplier network'),
('dun_bradstreet','Dun & Bradstreet','dnb.com',NULL,'WebSite','sameAs',3,'b2b_industrial','etl','verified',NULL),
('clutch','Clutch.co','clutch.co','clutch.co/profile/{id}','WebSite','sameAs',2,'professional_services','etl','verified',NULL),
('linkedin','LinkedIn Company Page','linkedin.com','linkedin.com/company/{id}','WebSite','sameAs',2,'professional_services','etl','verified',NULL),
('upcity','UpCity','upcity.com',NULL,'WebSite','sameAs',3,'professional_services','etl','verified',NULL),
('designrush','DesignRush','designrush.com',NULL,'WebSite','sameAs',3,'professional_services','etl','verified',NULL),
('g2','G2','g2.com','g2.com/products/{id}','WebSite','sameAs',3,'professional_services','etl','verified','Software'),
('expertise_com','Expertise.com','expertise.com',NULL,'WebSite','sameAs',3,'professional_services','etl','verified','Own platform network'),
('niche','Niche','niche.com','niche.com/{id}','WebSite','sameAs',2,'education','etl','verified',NULL),
('greatschools','GreatSchools','greatschools.org','greatschools.org/{id}','WebSite','sameAs',2,'education','etl','verified',NULL),
('petersons','Peterson''s','petersons.com',NULL,'WebSite','sameAs',3,'education','etl','verified',NULL),
('college_board','College Board','collegeboard.org',NULL,'WebSite','sameAs',3,'education','etl','verified',NULL),
('weddingwire','WeddingWire','weddingwire.com','weddingwire.com/biz/{id}','WebSite','sameAs',2,'events_travel','etl','verified',NULL),
('the_knot','The Knot','theknot.com','theknot.com/marketplace/{id}','WebSite','sameAs',2,'events_travel','etl','verified',NULL),
('eventbrite','Eventbrite','eventbrite.com','eventbrite.com/o/{id}','WebSite','sameAs',2,'events_travel','etl','verified',NULL),
('viator','Viator','viator.com',NULL,'WebSite','sameAs',3,'events_travel','etl','verified','Tours/activities'),
('getyourguide','GetYourGuide','getyourguide.com',NULL,'WebSite','sameAs',3,'events_travel','etl','verified',NULL),
('booking_com','Booking.com','booking.com',NULL,'WebSite','sameAs',3,'events_travel','etl','verified','Lodging'),
('expedia','Expedia','expedia.com',NULL,'WebSite','sameAs',3,'events_travel','etl','verified','Lodging/travel')
ON CONFLICT (directory_key) DO NOTHING;