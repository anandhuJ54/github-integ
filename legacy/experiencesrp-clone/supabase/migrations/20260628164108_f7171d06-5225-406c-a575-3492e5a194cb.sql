-- Taxonomy stub
CREATE TABLE IF NOT EXISTS exp_taxonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcid TEXT, level TEXT, term TEXT, term_slug TEXT, term_display TEXT,
  description TEXT, parent_id UUID, source TEXT,
  validated BOOLEAN DEFAULT FALSE,
  search_volume_monthly INTEGER, search_intent TEXT,
  use_srp BOOLEAN DEFAULT TRUE, use_voce BOOLEAN DEFAULT TRUE,
  use_search BOOLEAN DEFAULT TRUE, use_agents BOOLEAN DEFAULT TRUE,
  use_schema BOOLEAN DEFAULT TRUE,
  schema_type TEXT, schema_property TEXT, wikidata_id TEXT,
  score_weight DECIMAL(4,3) DEFAULT 0.000,
  is_required BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  priority SMALLINT DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gbp_categories (
  gcid              TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  slug              TEXT NOT NULL,
  service_types     JSONB DEFAULT '[]',
  more_hours_types  JSONB DEFAULT '[]',
  fetched_at        TIMESTAMPTZ NOT NULL,
  refresh_by        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_gbp_categories_slug    ON gbp_categories(slug);
CREATE INDEX idx_gbp_categories_refresh ON gbp_categories(refresh_by);
CREATE INDEX idx_gbp_categories_st      ON gbp_categories USING gin(service_types);

CREATE TABLE IF NOT EXISTS exp_category_knowledge (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcid              TEXT NOT NULL REFERENCES gbp_categories(gcid),
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('professional','location','both')),
  pricing_tier      TEXT NOT NULL CHECK (pricing_tier IN ('professional','location','enterprise')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','excluded','review_required')),
  exclusion_reason  TEXT,
  terminology       TEXT[],
  services          JSONB DEFAULT '[]',
  compliance_rules  TEXT[],
  customer_journey  JSONB DEFAULT '[]',
  ranking_factors   JSONB DEFAULT '[]',
  review_vocabulary TEXT[],
  content_topics    TEXT[],
  expertise_signals JSONB DEFAULT '[]',
  scoring_weights   JSONB DEFAULT '{"profile_completeness":0.20,"review_volume":0.20,"listing_coverage":0.15,"content_freshness":0.15,"schema_completeness":0.15,"ai_visibility":0.15}',
  ai_agents         JSONB DEFAULT '{"sdr":{"enabled":false},"receptionist":{"enabled":false},"review_responder":{"enabled":false},"content_assistant":{"enabled":false},"listing_optimizer":{"enabled":false},"qa_assistant":{"enabled":false}}',
  knowledge_pct     SMALLINT DEFAULT 0 CHECK (knowledge_pct BETWEEN 0 AND 100),
  is_launched       BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_gcid_knowledge UNIQUE (gcid)
);
CREATE INDEX idx_exp_ck_entity_type ON exp_category_knowledge(entity_type);
CREATE INDEX idx_exp_ck_status      ON exp_category_knowledge(status);
CREATE INDEX idx_exp_ck_launched    ON exp_category_knowledge(is_launched);

CREATE TABLE IF NOT EXISTS exp_category_directories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcid          TEXT NOT NULL REFERENCES gbp_categories(gcid),
  directory_key TEXT NOT NULL,
  directory_name TEXT NOT NULL,
  is_required   BOOLEAN DEFAULT FALSE,
  priority      SMALLINT DEFAULT 5,
  schema_type   TEXT,
  notes         TEXT,
  CONSTRAINT unique_cat_directory UNIQUE (gcid, directory_key)
);
CREATE INDEX idx_exp_cd_gcid     ON exp_category_directories(gcid);
CREATE INDEX idx_exp_cd_required ON exp_category_directories(gcid, is_required);

CREATE TABLE IF NOT EXISTS exp_category_secondaries (
  primary_gcid   TEXT NOT NULL REFERENCES gbp_categories(gcid),
  secondary_gcid TEXT NOT NULL REFERENCES gbp_categories(gcid),
  relevance      SMALLINT DEFAULT 5,
  notes          TEXT,
  PRIMARY KEY (primary_gcid, secondary_gcid)
);

CREATE TABLE IF NOT EXISTS exp_category_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  icon        TEXT,
  sort_order  SMALLINT DEFAULT 99
);

CREATE TABLE IF NOT EXISTS exp_category_group_memberships (
  group_id  UUID NOT NULL REFERENCES exp_category_groups(id),
  gcid      TEXT NOT NULL REFERENCES gbp_categories(gcid),
  is_primary BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (group_id, gcid)
);

CREATE TABLE IF NOT EXISTS gbp_category_changes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  change_type TEXT NOT NULL CHECK (change_type IN ('added','removed','modified')),
  gcid        TEXT NOT NULL,
  display_name TEXT,
  change_detail JSONB,
  reviewed    BOOLEAN DEFAULT FALSE,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX idx_gbp_cc_type     ON gbp_category_changes(change_type);
CREATE INDEX idx_gbp_cc_reviewed ON gbp_category_changes(reviewed);

CREATE OR REPLACE VIEW v_launched_categories AS
SELECT g.gcid, g.display_name, g.slug,
  jsonb_array_length(g.service_types) AS service_type_count,
  jsonb_array_length(g.more_hours_types) AS more_hours_count,
  k.entity_type, k.pricing_tier, k.knowledge_pct, k.is_launched, k.status
FROM gbp_categories g JOIN exp_category_knowledge k USING (gcid)
WHERE k.is_launched = TRUE ORDER BY g.display_name;

CREATE OR REPLACE VIEW v_categories_pending_knowledge AS
SELECT g.gcid, g.display_name, k.entity_type, k.status, k.knowledge_pct, k.is_launched
FROM gbp_categories g JOIN exp_category_knowledge k USING (gcid)
WHERE k.status = 'active' AND k.knowledge_pct < 80
ORDER BY k.knowledge_pct ASC;

CREATE OR REPLACE VIEW v_categories_unmapped AS
SELECT g.gcid, g.display_name FROM gbp_categories g
LEFT JOIN exp_category_knowledge k USING (gcid)
WHERE k.gcid IS NULL ORDER BY g.display_name;

CREATE TABLE IF NOT EXISTS exp_vertical_node_registry (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcid                TEXT NOT NULL REFERENCES gbp_categories(gcid),
  node_name           TEXT NOT NULL,
  node_slug           TEXT NOT NULL,
  node_description    TEXT,
  ring                TEXT NOT NULL CHECK (ring IN ('core_identity','verifiable_authority','profiles_presence','published_content','media_voice','social_engagement','transactions_outcomes','upstream_context')),
  connection_method   TEXT NOT NULL CHECK (connection_method IN ('oauth','etl','crm_sync','api','manual','rss','platform')),
  schema_type         TEXT NOT NULL,
  schema_property     TEXT,
  required_for_score  BOOLEAN DEFAULT FALSE,
  score_points        SMALLINT DEFAULT 0,
  priority            SMALLINT DEFAULT 5,
  url_pattern         TEXT,
  url_example         TEXT,
  compliance_notes    TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_category_node UNIQUE (gcid, node_slug)
);
CREATE INDEX idx_vnr_gcid     ON exp_vertical_node_registry(gcid);
CREATE INDEX idx_vnr_ring     ON exp_vertical_node_registry(gcid, ring);
CREATE INDEX idx_vnr_method   ON exp_vertical_node_registry(connection_method);
CREATE INDEX idx_vnr_required ON exp_vertical_node_registry(gcid, required_for_score);
CREATE INDEX idx_vnr_schema   ON exp_vertical_node_registry(schema_type);

INSERT INTO gbp_categories (gcid, display_name, slug, fetched_at, refresh_by)
VALUES ('gcid:mortgage_broker','Mortgage Broker','mortgage_broker', NOW(), NOW() + INTERVAL '30 days')
ON CONFLICT (gcid) DO NOTHING;

INSERT INTO exp_vertical_node_registry
  (gcid, node_name, node_slug, ring, connection_method, schema_type, schema_property, required_for_score, score_points, priority, url_pattern, compliance_notes)
VALUES
('gcid:mortgage_broker','Full name + headshot','core_name_photo','core_identity','manual','Person','name,image',TRUE,50,1,NULL,'Name must match NMLS registration'),
('gcid:mortgage_broker','Professional bio','core_bio','core_identity','manual','Person','description',TRUE,20,2,NULL,'Cannot include rate guarantees per RESPA'),
('gcid:mortgage_broker','NMLS ID','core_nmls','core_identity','manual','Person','identifier',TRUE,50,1,NULL,'Required — NMLS ID is the primary license identifier'),
('gcid:mortgage_broker','NMLS Consumer Access','auth_nmls_license','verifiable_authority','etl','EducationalOccupationalCredential','hasCredential',TRUE,100,1,'nmlsconsumeraccess.org/EntityDetails.aspx/{id}','Must match exactly — regulators check this'),
('gcid:mortgage_broker','State mortgage license','auth_state_license','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',TRUE,50,2,NULL,'Required in states where applicable'),
('gcid:mortgage_broker','MBA or finance degree','auth_degree','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,20,5,NULL,NULL),
('gcid:mortgage_broker','Industry certifications (CMB, CMC)','auth_certifications','verifiable_authority','manual','EducationalOccupationalCredential','hasCredential',FALSE,15,4,NULL,NULL),
('gcid:mortgage_broker','Google Business Profile','profile_gbp','profiles_presence','oauth','LocalBusiness','sameAs',TRUE,80,1,'google.com/maps?cid={id}',NULL),
('gcid:mortgage_broker','Zillow mortgage profile','profile_zillow','profiles_presence','etl','Person','sameAs',TRUE,60,2,'zillow.com/mortgage/lender/{id}',NULL),
('gcid:mortgage_broker','Bankrate profile','profile_bankrate','profiles_presence','etl','Person','sameAs',FALSE,30,3,'bankrate.com/mortgages/mortgage-brokers/{id}',NULL),
('gcid:mortgage_broker','LendingTree profile','profile_lendingtree','profiles_presence','etl','Person','sameAs',FALSE,30,4,'lendingtree.com/lender/{id}',NULL),
('gcid:mortgage_broker','LinkedIn profile','profile_linkedin','profiles_presence','oauth','Person','sameAs',TRUE,40,2,'linkedin.com/in/{id}',NULL),
('gcid:mortgage_broker','Yelp business page','profile_yelp','profiles_presence','etl','LocalBusiness','sameAs',FALSE,20,5,'yelp.com/biz/{id}',NULL),
('gcid:mortgage_broker','Personal website','profile_website','profiles_presence','etl','WebSite','url',FALSE,30,3,NULL,NULL),
('gcid:mortgage_broker','VOCE market update articles','content_voce_articles','published_content','platform','Article','author',FALSE,40,1,NULL,'Cannot include specific rate predictions per RESPA'),
('gcid:mortgage_broker','Q&A authored answers','content_qa','published_content','platform','FAQPage','mainEntity',FALSE,20,2,NULL,'Compliance review before publish'),
('gcid:mortgage_broker','Blog / WordPress posts','content_blog','published_content','rss','BlogPosting','author',FALSE,20,3,NULL,NULL),
('gcid:mortgage_broker','Social posts (LinkedIn, FB)','content_social','published_content','platform','SocialMediaPosting','author',FALSE,10,4,NULL,'Ad disclosure required if promoting rates'),
('gcid:mortgage_broker','YouTube channel','media_youtube','media_voice','oauth','VideoObject','author',FALSE,30,1,'youtube.com/channel/{id}',NULL),
('gcid:mortgage_broker','Podcast episodes','media_podcast','media_voice','rss','PodcastEpisode','author',FALSE,20,2,NULL,NULL),
('gcid:mortgage_broker','Video testimonials','media_video_testimonials','media_voice','manual','VideoObject','author',FALSE,15,3,NULL,NULL),
('gcid:mortgage_broker','VOCE audio reads','media_audio_reads','media_voice','platform','AudioObject','author',FALSE,10,4,NULL,NULL),
('gcid:mortgage_broker','GBP reviews','social_gbp_reviews','social_engagement','oauth','Review','review',TRUE,80,1,NULL,NULL),
('gcid:mortgage_broker','Experience.com platform reviews','social_exp_reviews','social_engagement','platform','Review','review',TRUE,60,1,NULL,NULL),
('gcid:mortgage_broker','Zillow reviews','social_zillow_reviews','social_engagement','etl','Review','review',FALSE,30,2,NULL,NULL),
('gcid:mortgage_broker','Review replies','social_review_replies','social_engagement','platform','Comment','comment',TRUE,40,1,NULL,'Replies cannot include rate specifics per RESPA'),
('gcid:mortgage_broker','Professional connections','social_connections','social_engagement','platform','Person','knows',FALSE,20,3,NULL,NULL),
('gcid:mortgage_broker','Closed loan volume','txn_loan_volume','transactions_outcomes','crm_sync','Service','provider',FALSE,60,1,NULL,'Aggregate only — no individual loan details'),
('gcid:mortgage_broker','Market coverage (zip codes served)','txn_markets','transactions_outcomes','crm_sync','Service','areaServed',FALSE,40,2,NULL,NULL),
('gcid:mortgage_broker','Loan type mix (FHA, VA, Jumbo)','txn_loan_types','transactions_outcomes','crm_sync','Service','serviceType',FALSE,30,3,NULL,NULL),
('gcid:mortgage_broker','Encompass CRM integration','txn_encompass','transactions_outcomes','crm_sync','Service','provider',FALSE,50,1,NULL,'Enterprise feature — requires org-level setup'),
('gcid:mortgage_broker','Company / lender location page','upstream_location','upstream_context','platform','LocalBusiness','employee',FALSE,0,1,NULL,NULL),
('gcid:mortgage_broker','Brand / lender org node','upstream_brand','upstream_context','platform','Organization','worksFor',FALSE,0,1,NULL,NULL),
('gcid:mortgage_broker','Mortgage category knowledge model','upstream_category','upstream_context','platform','Thing','knowsAbout',FALSE,0,1,NULL,NULL)
ON CONFLICT (gcid, node_slug) DO NOTHING;

CREATE OR REPLACE VIEW v_category_node_registry AS
SELECT g.gcid, g.display_name AS category_name, n.ring, n.priority, n.node_name,
  n.connection_method, n.schema_type, n.required_for_score, n.score_points, n.url_pattern, n.compliance_notes
FROM gbp_categories g JOIN exp_vertical_node_registry n USING (gcid)
WHERE n.is_active = TRUE
ORDER BY g.display_name, n.ring, n.priority;

CREATE OR REPLACE VIEW v_category_score_potential AS
SELECT gcid, ring, COUNT(*) AS node_count,
  SUM(score_points) AS total_points_available,
  SUM(CASE WHEN required_for_score THEN score_points ELSE 0 END) AS required_points
FROM exp_vertical_node_registry
WHERE is_active = TRUE
GROUP BY gcid, ring
ORDER BY gcid, ring;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'exp_taxonomy','gbp_categories','exp_category_knowledge',
    'exp_category_directories','exp_category_secondaries',
    'exp_category_groups','exp_category_group_memberships',
    'gbp_category_changes','exp_vertical_node_registry'
  ] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Public read %I" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Public read %I" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t, t);
  END LOOP;
END$$;