-- ============================================================
-- Experience.com Platform — Complete Data Model v2.0
-- ============================================================

CREATE TABLE IF NOT EXISTS exp_category_compliance (
  gcid                        TEXT PRIMARY KEY REFERENCES gbp_categories(gcid),
  display_license_on_profile  BOOLEAN DEFAULT FALSE,
  display_license_on_content  BOOLEAN DEFAULT FALSE,
  display_license_on_ads      BOOLEAN DEFAULT FALSE,
  display_license_on_email    BOOLEAN DEFAULT FALSE,
  license_display_format      TEXT,
  license_label               TEXT,
  required_disclaimers        TEXT[],
  disclaimer_placement        TEXT[],
  content_restrictions        TEXT[],
  prohibited_phrases          TEXT[],
  required_disclosures        TEXT[],
  age_gate_required           BOOLEAN DEFAULT FALSE,
  age_gate_minimum            SMALLINT DEFAULT 18,
  age_gate_type               TEXT,
  hipaa_applies               BOOLEAN DEFAULT FALSE,
  coppa_applies               BOOLEAN DEFAULT FALSE,
  glba_applies                BOOLEAN DEFAULT FALSE,
  ferpa_applies               BOOLEAN DEFAULT FALSE,
  regulated_by                TEXT[],
  advertising_rules_url       TEXT,
  compliance_notes            TEXT,
  review_verification_required BOOLEAN DEFAULT FALSE,
  review_transaction_required  BOOLEAN DEFAULT FALSE,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO exp_category_compliance
  (gcid, display_license_on_profile, display_license_on_content, display_license_on_ads,
   license_display_format, license_label, required_disclaimers, content_restrictions,
   prohibited_phrases, age_gate_required, hipaa_applies, glba_applies, regulated_by)
VALUES
('gcid:mortgage_broker', TRUE, TRUE, TRUE,
 'NMLS #{license_number}', 'NMLS ID',
 ARRAY['#{license_number} | Licensed in #{state}', 'Equal Housing Lender'],
 ARRAY['no rate guarantees','no approval guarantees','no specific rate quotes without APR disclosure'],
 ARRAY['guaranteed approval','best rate guaranteed','lowest rate','no cost loan'],
 FALSE, FALSE, TRUE,
 ARRAY['CFPB','NMLS','State Banking Departments','HUD'])
ON CONFLICT (gcid) DO NOTHING;

-- Additional compliance seeds (real_estate, lawyer, doctor, dentist, financial, cannabis, insurance, accounting)
INSERT INTO exp_category_compliance
  (gcid, display_license_on_profile, display_license_on_content, display_license_on_ads,
   license_display_format, license_label, required_disclaimers, content_restrictions,
   prohibited_phrases, age_gate_required, hipaa_applies, glba_applies, regulated_by)
SELECT * FROM (VALUES
('gcid:real_estate_agents', TRUE, TRUE, FALSE,
 'DRE #{license_number}', 'RE License',
 ARRAY['Licensed Real Estate Agent | #{license_number}'],
 ARRAY['no price guarantees','no investment advice'],
 ARRAY['guaranteed sale','guaranteed price','risk-free investment'],
 FALSE, FALSE, FALSE,
 ARRAY['NAR','State Real Estate Commission','DRE']),
('gcid:lawyer', TRUE, TRUE, TRUE,
 'Bar #{license_number}', 'Bar Number',
 ARRAY['Prior results do not guarantee similar outcomes','Attorney Advertising'],
 ARRAY['no outcome guarantees','no settlement guarantees'],
 ARRAY['guaranteed win','guaranteed settlement','we never lose'],
 FALSE, FALSE, FALSE,
 ARRAY['State Bar Association','ABA']),
('gcid:doctor', TRUE, FALSE, FALSE,
 'License #{license_number}', 'Medical License',
 ARRAY['This content is for informational purposes only and does not constitute medical advice'],
 ARRAY['no diagnosis claims','no treatment guarantees','no cure claims'],
 ARRAY['cures','guaranteed results','FDA approved treatment'],
 FALSE, TRUE, FALSE,
 ARRAY['State Medical Board','AMA','CMS']),
('gcid:dentist', TRUE, FALSE, FALSE,
 'License #{license_number}', 'Dental License',
 ARRAY['This content is for informational purposes only'],
 ARRAY['no treatment guarantees','no pain-free guarantees'],
 ARRAY['guaranteed results','permanent cure','painless guaranteed'],
 FALSE, TRUE, FALSE,
 ARRAY['State Dental Board','ADA']),
('gcid:financial_planner', TRUE, TRUE, TRUE,
 'CRD #{license_number}', 'CRD Number',
 ARRAY['Investment advice involves risk. Past performance does not guarantee future results.'],
 ARRAY['no return guarantees','no performance guarantees'],
 ARRAY['guaranteed returns','risk-free investment','guaranteed income'],
 FALSE, FALSE, TRUE,
 ARRAY['SEC','FINRA','State Securities Regulators']),
('gcid:cannabis_store', TRUE, FALSE, FALSE,
 'License #{license_number}', 'Cannabis License',
 ARRAY['For use only by adults 21 and older','Keep out of reach of children'],
 ARRAY['no health claims','no medical claims','no cure claims'],
 ARRAY['cures','treats','heals','FDA approved'],
 TRUE, FALSE, FALSE,
 ARRAY['State Cannabis Control Board','Local Municipality']),
('gcid:insurance_agency', TRUE, TRUE, FALSE,
 'License #{license_number}', 'Insurance License',
 ARRAY['Licensed Insurance Agent | #{license_number}'],
 ARRAY['no coverage guarantees','no claim approval guarantees'],
 ARRAY['guaranteed coverage','all claims paid','never denied'],
 FALSE, FALSE, FALSE,
 ARRAY['State Insurance Commission','NAIC']),
('gcid:accounting', TRUE, FALSE, FALSE,
 'CPA #{license_number}', 'CPA License',
 ARRAY['This content is for informational purposes and does not constitute tax or financial advice'],
 ARRAY['no tax outcome guarantees'],
 ARRAY['guaranteed refund','guaranteed audit protection'],
 FALSE, FALSE, FALSE,
 ARRAY['AICPA','State Board of Accountancy','IRS'])
) AS v(gcid, display_license_on_profile, display_license_on_content, display_license_on_ads,
   license_display_format, license_label, required_disclaimers, content_restrictions,
   prohibited_phrases, age_gate_required, hipaa_applies, glba_applies, regulated_by)
WHERE EXISTS (SELECT 1 FROM gbp_categories g WHERE g.gcid = v.gcid)
ON CONFLICT (gcid) DO NOTHING;

CREATE TABLE IF NOT EXISTS exp_category_ui_config (
  gcid                    TEXT PRIMARY KEY REFERENCES gbp_categories(gcid),
  profile_sections        JSONB NOT NULL DEFAULT '[]',
  onboarding_steps        JSONB NOT NULL DEFAULT '[]',
  required_fields         TEXT[],
  recommended_fields      TEXT[],
  schema_template         TEXT,
  profile_page_template   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id    UUID UNIQUE NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  full_name           TEXT,
  avatar_url          TEXT,
  phone               TEXT,
  system_role         TEXT NOT NULL DEFAULT 'user' CHECK (system_role IN ('super_admin','support','sales','user')),
  email_verified      BOOLEAN DEFAULT FALSE,
  phone_verified      BOOLEAN DEFAULT FALSE,
  is_active           BOOLEAN DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  login_count         INTEGER DEFAULT 0,
  notification_prefs  JSONB DEFAULT '{}',
  ui_prefs            JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_email  ON user_accounts(email);
CREATE INDEX idx_users_supa   ON user_accounts(supabase_user_id);

CREATE TABLE IF NOT EXISTS user_roles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_accounts(id),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('owner','org_admin','branch_manager','agent','editor','viewer','billing')),
  can_edit_profile    BOOLEAN,
  can_manage_users    BOOLEAN,
  can_publish_content BOOLEAN,
  can_view_analytics  BOOLEAN,
  can_manage_billing  BOOLEAN,
  can_login_as        BOOLEAN DEFAULT FALSE,
  invited_by      UUID REFERENCES user_accounts(id),
  invited_at      TIMESTAMPTZ,
  accepted_at     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_entity_role UNIQUE (user_id, entity_type, entity_id)
);
CREATE INDEX idx_roles_user    ON user_roles(user_id);
CREATE INDEX idx_roles_entity  ON user_roles(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::TEXT,
  email           TEXT NOT NULL,
  full_name       TEXT,
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  role            TEXT NOT NULL,
  prefill_data    JSONB DEFAULT '{}',
  invited_by      UUID REFERENCES user_accounts(id),
  invited_at      TIMESTAMPTZ DEFAULT NOW(),
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','expired','revoked')),
  accepted_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_invites_email  ON invitations(email);
CREATE INDEX idx_invites_token  ON invitations(token);
CREATE INDEX idx_invites_entity ON invitations(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES user_accounts(id),
  impersonating   UUID REFERENCES user_accounts(id),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  field_changes   JSONB,
  ip_address      INET,
  user_agent      TEXT,
  request_id      TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_user    ON audit_log(user_id);
CREATE INDEX idx_audit_entity  ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS organizations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  legal_name          TEXT,
  slug                TEXT NOT NULL UNIQUE,
  description         TEXT,
  short_description   TEXT,
  logo_url            TEXT,
  cover_photo_url     TEXT,
  website_url         TEXT,
  canonical_url       TEXT,
  gcid                TEXT REFERENCES gbp_categories(gcid),
  entity_type         TEXT CHECK (entity_type IN ('brand','franchise','enterprise','firm','office','location')),
  is_single_pro_office BOOLEAN DEFAULT FALSE,
  phone               TEXT,
  email               TEXT,
  address_street      TEXT,
  address_city        TEXT,
  address_state       TEXT,
  address_zip         TEXT,
  address_country     TEXT DEFAULT 'US',
  latitude            DECIMAL(9,6),
  longitude           DECIMAL(9,6),
  parent_org_id       UUID REFERENCES organizations(id),
  hierarchy_path      TEXT,
  hierarchy_depth     SMALLINT DEFAULT 0,
  gbp_place_id        TEXT,
  gbp_cid             TEXT,
  gbp_connected       BOOLEAN DEFAULT FALSE,
  gbp_last_sync       TIMESTAMPTZ,
  schema_type         TEXT DEFAULT 'Organization',
  wikidata_id         TEXT,
  same_as             TEXT[],
  search_rank_score   SMALLINT DEFAULT 0,
  score_updated_at    TIMESTAMPTZ,
  claimed             BOOLEAN DEFAULT FALSE,
  claimed_at          TIMESTAMPTZ,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_orgs_gcid       ON organizations(gcid);
CREATE INDEX idx_orgs_parent     ON organizations(parent_org_id);
CREATE INDEX idx_orgs_hierarchy  ON organizations(hierarchy_path);
CREATE INDEX idx_orgs_geo        ON organizations(latitude, longitude);
CREATE INDEX idx_orgs_slug       ON organizations(slug);

CREATE TABLE IF NOT EXISTS sso_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) UNIQUE,
  provider        TEXT NOT NULL,
  issuer_url      TEXT,
  client_id       TEXT,
  client_secret   TEXT,
  metadata_url    TEXT,
  attribute_map   JSONB DEFAULT '{}',
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS professionals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  display_name        TEXT,
  slug                TEXT NOT NULL UNIQUE,
  headline            TEXT,
  bio                 TEXT,
  short_bio           TEXT,
  photo_url           TEXT,
  cover_photo_url     TEXT,
  canonical_url       TEXT,
  gcid                TEXT REFERENCES gbp_categories(gcid),
  job_title           TEXT,
  phone               TEXT,
  email               TEXT,
  website_url         TEXT,
  address_city        TEXT,
  address_state       TEXT,
  address_zip         TEXT,
  primary_org_id      UUID REFERENCES organizations(id),
  primary_license_number    TEXT,
  primary_license_type      TEXT,
  primary_license_state     TEXT,
  primary_license_verified  BOOLEAN DEFAULT FALSE,
  primary_license_verified_at TIMESTAMPTZ,
  gbp_place_id        TEXT,
  gbp_connected       BOOLEAN DEFAULT FALSE,
  gbp_last_sync       TIMESTAMPTZ,
  languages           TEXT[],
  markets_served      TEXT[],
  zip_codes_served    TEXT[],
  schema_type         TEXT DEFAULT 'Person',
  wikidata_id         TEXT,
  same_as             TEXT[],
  search_rank_score   SMALLINT DEFAULT 0,
  score_updated_at    TIMESTAMPTZ,
  local_rank          SMALLINT,
  local_rank_of       SMALLINT,
  local_rank_updated  TIMESTAMPTZ,
  user_id             UUID REFERENCES user_accounts(id),
  claimed             BOOLEAN DEFAULT FALSE,
  claimed_at          TIMESTAMPTZ,
  claim_method        TEXT,
  claim_confidence    SMALLINT,
  compliance_complete BOOLEAN DEFAULT FALSE,
  compliance_score    SMALLINT DEFAULT 0,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pros_gcid      ON professionals(gcid);
CREATE INDEX idx_pros_org       ON professionals(primary_org_id);
CREATE INDEX idx_pros_license   ON professionals(primary_license_number, primary_license_type);
CREATE INDEX idx_pros_geo       ON professionals(address_city, address_state);
CREATE INDEX idx_pros_score     ON professionals(gcid, search_rank_score DESC);
CREATE INDEX idx_pros_slug      ON professionals(slug);
CREATE INDEX idx_pros_user      ON professionals(user_id);

CREATE TABLE IF NOT EXISTS professional_org_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES professionals(id),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  role            TEXT,
  is_primary      BOOLEAN DEFAULT TRUE,
  start_date      DATE,
  end_date        DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_pro_org UNIQUE (professional_id, org_id, is_primary)
);
CREATE INDEX idx_pom_pro ON professional_org_memberships(professional_id);
CREATE INDEX idx_pom_org ON professional_org_memberships(org_id);

CREATE TABLE IF NOT EXISTS entity_compliance (
  entity_type               TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id                 UUID NOT NULL,
  license_displayed         BOOLEAN DEFAULT FALSE,
  license_display_verified  BOOLEAN DEFAULT FALSE,
  disclaimers_shown         BOOLEAN DEFAULT FALSE,
  disclaimers_accepted      BOOLEAN DEFAULT FALSE,
  disclaimers_accepted_at   TIMESTAMPTZ,
  age_gate_active           BOOLEAN DEFAULT FALSE,
  age_gate_verified_at      TIMESTAMPTZ,
  terms_accepted            BOOLEAN DEFAULT FALSE,
  terms_accepted_at         TIMESTAMPTZ,
  terms_version             TEXT,
  privacy_accepted          BOOLEAN DEFAULT FALSE,
  privacy_accepted_at       TIMESTAMPTZ,
  gdpr_consent              BOOLEAN DEFAULT FALSE,
  gdpr_consent_at           TIMESTAMPTZ,
  ccpa_opt_out              BOOLEAN DEFAULT FALSE,
  compliance_score          SMALLINT DEFAULT 0,
  missing_items             TEXT[],
  last_reviewed             TIMESTAMPTZ,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX idx_compliance_entity ON entity_compliance(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS content_compliance_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcid            TEXT REFERENCES gbp_categories(gcid),
  rule_name       TEXT NOT NULL,
  rule_type       TEXT NOT NULL CHECK (rule_type IN ('prohibited_phrase','required_disclosure','age_gate','license_display','category_restriction')),
  rule_value      TEXT NOT NULL,
  applies_to      TEXT[] NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('block','warn','require_disclosure')),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ccr_gcid  ON content_compliance_rules(gcid);
CREATE INDEX idx_ccr_type  ON content_compliance_rules(rule_type);

INSERT INTO content_compliance_rules (gcid, rule_name, rule_type, rule_value, applies_to, severity)
SELECT * FROM (VALUES
('gcid:mortgage_broker','mortgage_no_rate_guarantee','prohibited_phrase','guaranteed rate',ARRAY['article','sdr','social_post','email'],'block'),
('gcid:mortgage_broker','mortgage_no_approval_guarantee','prohibited_phrase','guaranteed approval',ARRAY['article','sdr','social_post','email'],'block'),
('gcid:mortgage_broker','mortgage_nmls_required','license_display','NMLS #{license_number}',ARRAY['article','email','sdr'],'require_disclosure'),
('gcid:mortgage_broker','mortgage_equal_housing','required_disclosure','Equal Housing Lender',ARRAY['article','email'],'require_disclosure'),
('gcid:lawyer','legal_no_outcome_guarantee','prohibited_phrase','guaranteed win',ARRAY['article','sdr','social_post'],'block'),
('gcid:lawyer','legal_attorney_advertising','required_disclosure','Attorney Advertising',ARRAY['article','social_post'],'require_disclosure'),
('gcid:lawyer','legal_past_results','required_disclosure','Prior results do not guarantee similar outcomes',ARRAY['article'],'require_disclosure'),
('gcid:doctor','medical_no_diagnosis','prohibited_phrase','diagnoses',ARRAY['article','qa','social_post'],'block'),
('gcid:doctor','medical_not_advice','required_disclosure','This content is for informational purposes only and does not constitute medical advice',ARRAY['article','qa'],'require_disclosure'),
('gcid:financial_planner','finance_no_guarantee','prohibited_phrase','guaranteed returns',ARRAY['article','sdr','social_post','email'],'block'),
('gcid:financial_planner','finance_past_performance','required_disclosure','Past performance does not guarantee future results',ARRAY['article','email'],'require_disclosure'),
(NULL,'no_discriminatory_language','category_restriction','discriminatory content',ARRAY['article','review_reply','sdr','social_post','qa'],'block'),
(NULL,'no_spam_language','prohibited_phrase','act now limited time',ARRAY['email','sdr'],'warn')
) AS v(gcid, rule_name, rule_type, rule_value, applies_to, severity)
WHERE v.gcid IS NULL OR EXISTS (SELECT 1 FROM gbp_categories g WHERE g.gcid = v.gcid);

CREATE TABLE IF NOT EXISTS oauth_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization','user')),
  entity_id           UUID NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  provider_email      TEXT,
  provider_name       TEXT,
  access_token        TEXT,
  refresh_token       TEXT,
  token_expires_at    TIMESTAMPTZ,
  scopes              TEXT[],
  enables             TEXT[],
  last_sync_at        TIMESTAMPTZ,
  sync_status         TEXT DEFAULT 'pending' CHECK (sync_status IN ('pending','active','error','expired','revoked')),
  sync_error          TEXT,
  sync_count          INTEGER DEFAULT 0,
  is_active           BOOLEAN DEFAULT TRUE,
  connected_at        TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_entity_provider UNIQUE (entity_type, entity_id, provider)
);
CREATE INDEX idx_oauth_entity   ON oauth_connections(entity_type, entity_id);
CREATE INDEX idx_oauth_provider ON oauth_connections(provider);
CREATE INDEX idx_oauth_expires  ON oauth_connections(token_expires_at);

CREATE TABLE IF NOT EXISTS crm_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  crm_type        TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}',
  field_map       JSONB DEFAULT '{}',
  sync_direction  TEXT DEFAULT 'inbound' CHECK (sync_direction IN ('inbound','outbound','both')),
  sync_frequency  TEXT DEFAULT 'realtime',
  last_sync_at    TIMESTAMPTZ,
  sync_status     TEXT DEFAULT 'pending',
  records_synced  INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_crm_org ON crm_integrations(org_id);

CREATE TABLE IF NOT EXISTS sync_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type          TEXT NOT NULL,
  entity_type       TEXT,
  entity_id         UUID,
  integration_id    UUID,
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','complete','failed','partial')),
  records_processed INTEGER DEFAULT 0,
  records_failed    INTEGER DEFAULT 0,
  error_log         JSONB,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  duration_ms       INTEGER,
  triggered_by      TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sync_entity ON sync_jobs(entity_type, entity_id);
CREATE INDEX idx_sync_status ON sync_jobs(status, job_type);
CREATE INDEX idx_sync_created ON sync_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS claim_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id         UUID NOT NULL,
  claimant_user_id  UUID REFERENCES user_accounts(id),
  claimant_email    TEXT NOT NULL,
  claimant_name     TEXT,
  confidence_score  SMALLINT NOT NULL,
  confidence_signals JSONB DEFAULT '{}',
  match_method      TEXT,
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','auto_approved','manual_review','approved','rejected','conflict')),
  reviewed_by       UUID REFERENCES user_accounts(id),
  reviewed_at       TIMESTAMPTZ,
  review_notes      TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_claim_entity  ON claim_queue(entity_type, entity_id);
CREATE INDEX idx_claim_status  ON claim_queue(status);
CREATE INDEX idx_claim_email   ON claim_queue(claimant_email);

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_accounts(id),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  current_step    SMALLINT DEFAULT 1,
  steps_completed TEXT[] DEFAULT '{}',
  steps_skipped   TEXT[] DEFAULT '{}',
  is_complete     BOOLEAN DEFAULT FALSE,
  completed_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_entity_onboarding UNIQUE (user_id, entity_type, entity_id)
);
CREATE INDEX idx_onboarding_user   ON onboarding_progress(user_id);
CREATE INDEX idx_onboarding_entity ON onboarding_progress(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS etl_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  source_type     TEXT NOT NULL,
  source_url      TEXT,
  source_name     TEXT,
  crawled_at      TIMESTAMPTZ,
  raw_data        JSONB,
  data_quality    SMALLINT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_etl_entity ON etl_sources(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id           UUID NOT NULL,
  ring                SMALLINT NOT NULL CHECK (ring BETWEEN 0 AND 7),
  node_type           TEXT NOT NULL,
  node_registry_id    UUID REFERENCES exp_vertical_node_registry(id),
  title               TEXT,
  url                 TEXT,
  raw_data            JSONB,
  extracted_data      JSONB,
  schema_type         TEXT,
  schema_property     TEXT,
  source              TEXT NOT NULL CHECK (source IN ('oauth','etl','crm_sync','api','manual','rss','platform','user')),
  source_id           TEXT,
  source_url          TEXT,
  fetched_at          TIMESTAMPTZ,
  refresh_by          TIMESTAMPTZ,
  refresh_required    BOOLEAN DEFAULT FALSE,
  verified            BOOLEAN DEFAULT FALSE,
  verified_at         TIMESTAMPTZ,
  verified_by         TEXT,
  score_points        SMALLINT DEFAULT 0,
  score_counted       BOOLEAN DEFAULT FALSE,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_nodes_entity   ON graph_nodes(entity_type, entity_id);
CREATE INDEX idx_nodes_ring     ON graph_nodes(entity_type, entity_id, ring);
CREATE INDEX idx_nodes_type     ON graph_nodes(node_type);
CREATE INDEX idx_nodes_refresh  ON graph_nodes(refresh_required, refresh_by);
CREATE INDEX idx_nodes_source   ON graph_nodes(source, source_id);

CREATE TABLE IF NOT EXISTS graph_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id    UUID NOT NULL REFERENCES graph_nodes(id),
  to_node_id      UUID NOT NULL REFERENCES graph_nodes(id),
  edge_type       TEXT NOT NULL CHECK (edge_type IN ('authored_by','published_by','works_for','branch_of','has_credential','alumni_of','member_of','same_as','knows_about','area_served','offers','reviewed_by','part_of_series','mentions','about','subject_of')),
  schema_property TEXT,
  weight          DECIMAL(3,2) DEFAULT 1.0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_edge UNIQUE (from_node_id, to_node_id, edge_type)
);
CREATE INDEX idx_edges_from ON graph_edges(from_node_id);
CREATE INDEX idx_edges_to   ON graph_edges(to_node_id);
CREATE INDEX idx_edges_type ON graph_edges(edge_type);

CREATE TABLE IF NOT EXISTS wikidata_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term            TEXT NOT NULL UNIQUE,
  wikidata_id     TEXT NOT NULL,
  wikipedia_url   TEXT,
  wikidata_url    TEXT GENERATED ALWAYS AS ('https://www.wikidata.org/wiki/' || wikidata_id) STORED,
  description     TEXT,
  gcid_relevance  TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wikidata_term ON wikidata_mappings(term);

INSERT INTO wikidata_mappings (term, wikidata_id, wikipedia_url, gcid_relevance) VALUES
('Mortgage Origination','Q1936930','https://en.wikipedia.org/wiki/Mortgage_loan',ARRAY['gcid:mortgage_broker']),
('FHA Loans','Q1406183','https://en.wikipedia.org/wiki/FHA_insured_loan',ARRAY['gcid:mortgage_broker']),
('VA Loans','Q7908416','https://en.wikipedia.org/wiki/VA_loan',ARRAY['gcid:mortgage_broker']),
('Real Estate','Q179049','https://en.wikipedia.org/wiki/Real_estate',ARRAY['gcid:real_estate_agents']),
('Criminal Defense Law','Q993404','https://en.wikipedia.org/wiki/Criminal_defense_lawyer',ARRAY['gcid:lawyer']),
('Family Law','Q1006786','https://en.wikipedia.org/wiki/Family_law',ARRAY['gcid:lawyer']),
('Personal Injury Law','Q1060440','https://en.wikipedia.org/wiki/Personal_injury',ARRAY['gcid:lawyer']),
('General Dentistry','Q189553','https://en.wikipedia.org/wiki/Dentistry',ARRAY['gcid:dentist']),
('Financial Planning','Q1080058','https://en.wikipedia.org/wiki/Financial_plan',ARRAY['gcid:financial_planner']),
('Accounting','Q4026','https://en.wikipedia.org/wiki/Accounting',ARRAY['gcid:accounting'])
ON CONFLICT (term) DO NOTHING;

CREATE TABLE IF NOT EXISTS credentials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id     UUID NOT NULL REFERENCES professionals(id),
  graph_node_id       UUID REFERENCES graph_nodes(id),
  credential_type     TEXT NOT NULL CHECK (credential_type IN ('license','degree','certification','designation','membership','award','recognition')),
  name                TEXT NOT NULL,
  identifier          TEXT,
  issuing_org         TEXT NOT NULL,
  issuing_org_url     TEXT,
  issuing_state       TEXT,
  valid_from          DATE,
  valid_until         DATE,
  is_current          BOOLEAN DEFAULT TRUE,
  verified            BOOLEAN DEFAULT FALSE,
  verified_at         TIMESTAMPTZ,
  verification_url    TEXT,
  verification_method TEXT,
  schema_credential_category TEXT,
  wikidata_id         TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_creds_pro  ON credentials(professional_id);
CREATE INDEX idx_creds_type ON credentials(credential_type);
CREATE INDEX idx_creds_id   ON credentials(identifier, issuing_org);

CREATE TABLE IF NOT EXISTS reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id           UUID NOT NULL,
  graph_node_id       UUID REFERENCES graph_nodes(id),
  rating              DECIMAL(2,1) NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title               TEXT,
  body                TEXT,
  reviewer_name       TEXT,
  reviewer_photo_url  TEXT,
  review_date         DATE NOT NULL,
  source              TEXT NOT NULL,
  source_review_id    TEXT,
  source_url          TEXT,
  reply_body          TEXT,
  reply_date          TIMESTAMPTZ,
  reply_source        TEXT,
  sentiment           TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  sentiment_score     DECIMAL(3,2),
  keywords_extracted  TEXT[],
  locations_mentioned TEXT[],
  services_mentioned  TEXT[],
  compliance_checked  BOOLEAN DEFAULT FALSE,
  compliance_passed   BOOLEAN,
  compliance_flags    TEXT[],
  is_featured         BOOLEAN DEFAULT FALSE,
  is_flagged          BOOLEAN DEFAULT FALSE,
  flag_reason         TEXT,
  flag_status         TEXT CHECK (flag_status IN ('pending','reviewing','resolved','dismissed')),
  is_verified         BOOLEAN DEFAULT FALSE,
  schema_type         TEXT DEFAULT 'Review',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_reviews_entity  ON reviews(entity_type, entity_id);
CREATE INDEX idx_reviews_source  ON reviews(source, source_review_id);
CREATE INDEX idx_reviews_date    ON reviews(entity_id, review_date DESC);
CREATE INDEX idx_reviews_flagged ON reviews(is_flagged) WHERE is_flagged = TRUE;

CREATE TABLE IF NOT EXISTS review_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  name            TEXT NOT NULL,
  campaign_type   TEXT NOT NULL CHECK (campaign_type IN ('email','sms','qr','manual')),
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','active','paused','complete')),
  subject         TEXT,
  message_body    TEXT,
  redirect_url    TEXT,
  target_platform TEXT DEFAULT 'google',
  sent_count      INTEGER DEFAULT 0,
  opened_count    INTEGER DEFAULT 0,
  clicked_count   INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  includes_required_disclosures BOOLEAN DEFAULT FALSE,
  compliance_approved BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_campaigns_entity ON review_campaigns(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS content_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_type         TEXT NOT NULL CHECK (author_type IN ('professional','organization')),
  author_id           UUID NOT NULL,
  graph_node_id       UUID REFERENCES graph_nodes(id),
  content_type        TEXT NOT NULL CHECK (content_type IN ('article','blog_post','qa_answer','social_post','landing_page','how_to','guide','press_release','guest_article')),
  title               TEXT NOT NULL,
  slug                TEXT,
  body                TEXT,
  excerpt             TEXT,
  cover_image_url     TEXT,
  gcid                TEXT REFERENCES gbp_categories(gcid),
  topic_ids           UUID[],
  tag_ids             UUID[],
  keywords            TEXT[],
  meta_title          TEXT,
  meta_description    TEXT,
  canonical_url       TEXT,
  schema_type         TEXT DEFAULT 'Article',
  locations_mentioned TEXT[],
  markets_covered     TEXT[],
  compliance_checked  BOOLEAN DEFAULT FALSE,
  compliance_passed   BOOLEAN,
  compliance_flags    TEXT[],
  disclosures_appended TEXT[],
  published_url       TEXT,
  voce_published      BOOLEAN DEFAULT FALSE,
  social_shared       BOOLEAN DEFAULT FALSE,
  audio_url           TEXT,
  audio_generated     BOOLEAN DEFAULT FALSE,
  views               INTEGER DEFAULT 0,
  shares              INTEGER DEFAULT 0,
  ai_mentions         INTEGER DEFAULT 0,
  status              TEXT DEFAULT 'draft' CHECK (status IN ('draft','compliance_review','approved','published','archived')),
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_content_author    ON content_items(author_type, author_id);
CREATE INDEX idx_content_type      ON content_items(content_type, status);
CREATE INDEX idx_content_gcid      ON content_items(gcid);
CREATE INDEX idx_content_published ON content_items(published_at DESC);
CREATE INDEX idx_content_compliance ON content_items(compliance_passed) WHERE compliance_passed = FALSE;

CREATE TABLE IF NOT EXISTS media_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id           UUID NOT NULL,
  graph_node_id       UUID REFERENCES graph_nodes(id),
  media_type          TEXT NOT NULL CHECK (media_type IN ('youtube_video','podcast_episode','podcast_series','video_testimonial','webinar','course','audio_read')),
  title               TEXT NOT NULL,
  description         TEXT,
  thumbnail_url       TEXT,
  duration_seconds    INTEGER,
  source_platform     TEXT,
  source_id           TEXT,
  source_url          TEXT,
  embed_url           TEXT,
  topics_extracted    TEXT[],
  tags_extracted      TEXT[],
  schema_type         TEXT,
  published_at        DATE,
  series_id           UUID REFERENCES media_items(id),
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_media_entity ON media_items(entity_type, entity_id);
CREATE INDEX idx_media_type   ON media_items(media_type);
CREATE INDEX idx_media_source ON media_items(source_platform, source_id);

CREATE TABLE IF NOT EXISTS transaction_signals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id     UUID NOT NULL REFERENCES professionals(id),
  graph_node_id       UUID REFERENCES graph_nodes(id),
  transaction_type    TEXT NOT NULL,
  service_type        TEXT,
  city                TEXT,
  state               TEXT,
  zip_code            TEXT,
  neighborhood        TEXT,
  county              TEXT,
  price_range_low     INTEGER,
  price_range_high    INTEGER,
  price_bucket        TEXT,
  transaction_date    DATE,
  transaction_year    SMALLINT,
  transaction_quarter SMALLINT,
  source              TEXT,
  source_id           TEXT,
  pii_stripped        BOOLEAN DEFAULT TRUE,
  aggregated          BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_txn_pro  ON transaction_signals(professional_id);
CREATE INDEX idx_txn_geo  ON transaction_signals(zip_code, city, state);
CREATE INDEX idx_txn_date ON transaction_signals(professional_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS search_rank_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id           UUID NOT NULL,
  gcid                TEXT REFERENCES gbp_categories(gcid),
  total_score         SMALLINT NOT NULL DEFAULT 0,
  max_possible        SMALLINT NOT NULL DEFAULT 850,
  score_pct           DECIMAL(5,2),
  score_reviews           SMALLINT DEFAULT 0,
  score_profile           SMALLINT DEFAULT 0,
  score_listings          SMALLINT DEFAULT 0,
  score_content           SMALLINT DEFAULT 0,
  score_web_analytics     SMALLINT DEFAULT 0,
  score_connections       SMALLINT DEFAULT 0,
  local_rank          SMALLINT,
  local_rank_of       SMALLINT,
  local_market        TEXT,
  top_pct             SMALLINT,
  previous_score      SMALLINT,
  score_change_7d     SMALLINT,
  score_change_30d    SMALLINT,
  gaps                JSONB,
  next_milestone      SMALLINT,
  next_milestone_gap  SMALLINT,
  calculated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_entity_score UNIQUE (entity_type, entity_id)
);
CREATE INDEX idx_srs_entity  ON search_rank_scores(entity_type, entity_id);
CREATE INDEX idx_srs_gcid    ON search_rank_scores(gcid, total_score DESC);
CREATE INDEX idx_srs_market  ON search_rank_scores(local_market, total_score DESC);

CREATE TABLE IF NOT EXISTS score_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  total_score     SMALLINT NOT NULL,
  score_reviews   SMALLINT,
  score_profile   SMALLINT,
  score_listings  SMALLINT,
  score_content   SMALLINT,
  local_rank      SMALLINT,
  snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_entity_score_date UNIQUE (entity_type, entity_id, snapshot_date)
);
CREATE INDEX idx_score_hist_entity ON score_history(entity_type, entity_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS plg_rules (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gcid                TEXT REFERENCES gbp_categories(gcid),
  rule_name           TEXT NOT NULL UNIQUE,
  rule_type           TEXT NOT NULL CHECK (rule_type IN ('banner','modal','email','push','score_card','dashboard_tip','upgrade_prompt')),
  trigger_condition   JSONB NOT NULL,
  priority            SMALLINT DEFAULT 5,
  headline            TEXT NOT NULL,
  body                TEXT NOT NULL,
  cta_text            TEXT NOT NULL,
  cta_action          TEXT NOT NULL,
  cta_url             TEXT,
  requires_upgrade    BOOLEAN DEFAULT FALSE,
  upgrade_tier        TEXT,
  icon                TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO plg_rules (gcid, rule_name, rule_type, trigger_condition, priority, headline, body, cta_text, cta_action, requires_upgrade) VALUES
(NULL,'no_gbp_connected','banner','{"node_missing":"gbp"}',1,'Connect Google to boost your score','Pull in your reviews, photos, and business details automatically. Earn up to 80 points instantly.','Connect Google','connect_gbp',FALSE),
(NULL,'no_license_verified','score_card','{"credential_verified":false}',1,'Verify your license','Verified licenses are the top trust signal in your category. Earn 100 points.','Verify Now','verify_license',FALSE),
(NULL,'reviews_lt_10','score_card','{"score_bucket":"reviews","count_lt":10}',2,'You need more reviews','Top professionals in your market average 47 reviews. Start a campaign.','Launch Campaign','launch_review_campaign',FALSE),
(NULL,'unanswered_reviews','banner','{"unanswered_reviews_gt":0}',1,'You have unanswered reviews','Replying to reviews earns up to 100 points and shows customers you care.','Reply Now','open_reviews',FALSE),
(NULL,'no_voce_article','dashboard_tip','{"content_count_lt":1}',3,'Write your first article','Professionals who publish monthly rank 40 percent higher in local search. Takes 5 minutes.','Write Article','open_voce',FALSE),
(NULL,'score_lt_500','modal','{"total_score_lt":500}',4,'You are in the bottom 40 percent in your market','Here is a 3-step plan to reach the top 20 percent this month.','See My Plan','open_score_plan',FALSE),
(NULL,'score_gt_700','dashboard_tip','{"total_score_gt":700}',5,'You are in the top 20 percent in your market','Here is what separates top 5 percent professionals from where you are now.','See What is Next','open_insights',FALSE),
(NULL,'no_crm_connected','upgrade_prompt','{"ring_missing":6}',3,'Unlock transaction signals','Connect your CRM to add 60 points and show verified transaction history in your market.','Connect CRM','upgrade_crm',TRUE),
(NULL,'compliance_incomplete','banner','{"compliance_score_lt":100}',1,'Complete your compliance checklist','Your profile is missing required information for your category.','View Checklist','open_compliance',FALSE)
ON CONFLICT (rule_name) DO NOTHING;
CREATE INDEX idx_plg_gcid ON plg_rules(gcid);
CREATE INDEX idx_plg_type ON plg_rules(rule_type, is_active);

CREATE TABLE IF NOT EXISTS plg_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  rule_id         UUID NOT NULL REFERENCES plg_rules(id),
  fired_at        TIMESTAMPTZ DEFAULT NOW(),
  dismissed_at    TIMESTAMPTZ,
  converted_at    TIMESTAMPTZ,
  conversion_type TEXT
);
CREATE INDEX idx_plg_events_entity ON plg_events(entity_type, entity_id);
CREATE INDEX idx_plg_events_rule   ON plg_events(rule_id);

CREATE TABLE IF NOT EXISTS listings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id           UUID NOT NULL,
  graph_node_id       UUID REFERENCES graph_nodes(id),
  directory_key       TEXT NOT NULL,
  directory_name      TEXT NOT NULL,
  directory_url       TEXT,
  status              TEXT NOT NULL CHECK (status IN ('not_submitted','pending','published','error','claimed','unclaimed')),
  listing_url         TEXT,
  external_id         TEXT,
  last_submitted      TIMESTAMPTZ,
  last_verified       TIMESTAMPTZ,
  data_hash           TEXT,
  name_match          BOOLEAN,
  phone_match         BOOLEAN,
  address_match       BOOLEAN,
  has_drift           BOOLEAN DEFAULT FALSE,
  drift_fields        TEXT[],
  score_points        SMALLINT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_entity_directory UNIQUE (entity_type, entity_id, directory_key)
);
CREATE INDEX idx_listings_entity    ON listings(entity_type, entity_id);
CREATE INDEX idx_listings_status    ON listings(status);
CREATE INDEX idx_listings_drift     ON listings(has_drift) WHERE has_drift = TRUE;

CREATE TABLE IF NOT EXISTS schema_cache (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization','content')),
  entity_id           UUID NOT NULL,
  page_type           TEXT NOT NULL,
  schema_json         JSONB NOT NULL,
  node_count          SMALLINT,
  generated_at        TIMESTAMPTZ DEFAULT NOW(),
  invalidated_at      TIMESTAMPTZ,
  is_valid            BOOLEAN DEFAULT TRUE,
  CONSTRAINT unique_entity_page_schema UNIQUE (entity_type, entity_id, page_type)
);
CREATE INDEX idx_schema_entity  ON schema_cache(entity_type, entity_id);
CREATE INDEX idx_schema_invalid ON schema_cache(is_valid) WHERE is_valid = FALSE;

CREATE TABLE IF NOT EXISTS schema_validation_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  page_url        TEXT NOT NULL,
  page_type       TEXT NOT NULL,
  validation_tool TEXT DEFAULT 'google_rich_results',
  result          TEXT CHECK (result IN ('pass','warnings','errors','fail')),
  errors          JSONB DEFAULT '[]',
  warnings        JSONB DEFAULT '[]',
  rich_results    TEXT[],
  validated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_schema_val_entity ON schema_validation_log(entity_type, entity_id);
CREATE INDEX idx_schema_val_result ON schema_validation_log(result);

CREATE TABLE IF NOT EXISTS index_intelligence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     TEXT NOT NULL,
  entity_id       UUID NOT NULL,
  page_url        TEXT NOT NULL UNIQUE,
  page_type       TEXT NOT NULL,
  submitted_at    TIMESTAMPTZ,
  sitemap_included BOOLEAN DEFAULT TRUE,
  indexed         BOOLEAN DEFAULT FALSE,
  indexed_at      TIMESTAMPTZ,
  last_crawled_at TIMESTAMPTZ,
  index_status    TEXT,
  coverage_state  TEXT,
  impressions_28d INTEGER DEFAULT 0,
  clicks_28d      INTEGER DEFAULT 0,
  avg_position    DECIMAL(5,1),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_index_intel_entity  ON index_intelligence(entity_type, entity_id);
CREATE INDEX idx_index_intel_status  ON index_intelligence(index_status);
CREATE INDEX idx_index_intel_indexed ON index_intelligence(indexed);

CREATE TABLE IF NOT EXISTS aggregate_ratings (
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id       UUID NOT NULL,
  source          TEXT NOT NULL,
  rating_value    DECIMAL(3,2),
  review_count    INTEGER DEFAULT 0,
  rating_1        INTEGER DEFAULT 0,
  rating_2        INTEGER DEFAULT 0,
  rating_3        INTEGER DEFAULT 0,
  rating_4        INTEGER DEFAULT 0,
  rating_5        INTEGER DEFAULT 0,
  last_review_date DATE,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (entity_type, entity_id, source)
);

CREATE TABLE IF NOT EXISTS enterprise_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) UNIQUE,
  feature_listings      BOOLEAN DEFAULT TRUE,
  feature_reviews       BOOLEAN DEFAULT TRUE,
  feature_campaigns     BOOLEAN DEFAULT TRUE,
  feature_voce          BOOLEAN DEFAULT FALSE,
  feature_ai_agents     BOOLEAN DEFAULT FALSE,
  feature_crm_sync      BOOLEAN DEFAULT FALSE,
  feature_api_access    BOOLEAN DEFAULT FALSE,
  feature_websites      BOOLEAN DEFAULT FALSE,
  feature_analytics     BOOLEAN DEFAULT FALSE,
  brand_voice           TEXT,
  compliance_rules_override TEXT[],
  pii_restrictions      TEXT[],
  review_pii_filter     BOOLEAN DEFAULT FALSE,
  allow_org_posts       BOOLEAN DEFAULT FALSE,
  require_post_approval BOOLEAN DEFAULT TRUE,
  pricing_tier          TEXT DEFAULT 'professional',
  contract_start        DATE,
  contract_end          DATE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES organizations(id),
  user_id         UUID REFERENCES user_accounts(id),
  key_hash        TEXT NOT NULL UNIQUE,
  key_prefix      TEXT NOT NULL,
  name            TEXT NOT NULL,
  scopes          TEXT[] NOT NULL,
  rate_limit_rpm  INTEGER DEFAULT 100,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_apikeys_org  ON api_keys(org_id);
CREATE INDEX idx_apikeys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('professional','organization')),
  entity_id           UUID NOT NULL,
  plan_id             TEXT NOT NULL,
  plan_name           TEXT NOT NULL,
  billing_cycle       TEXT CHECK (billing_cycle IN ('monthly','annual','multi_year')),
  stripe_customer_id  TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at       TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end  TIMESTAMPTZ,
  cancel_at           TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  status              TEXT DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','canceled','unpaid','incomplete')),
  features_included   TEXT[],
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_entity_subscription UNIQUE (entity_type, entity_id)
);
CREATE INDEX idx_subs_entity ON subscriptions(entity_type, entity_id);
CREATE INDEX idx_subs_stripe ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subs_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS terms_acceptance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_accounts(id),
  document_type   TEXT NOT NULL CHECK (document_type IN ('terms_of_service','privacy_policy','category_disclosure','hipaa_authorization','age_verification','marketing_consent')),
  document_version TEXT NOT NULL,
  accepted        BOOLEAN NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  accepted_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_terms_user ON terms_acceptance(user_id, document_type);

-- Views
CREATE OR REPLACE VIEW v_professional_profile AS
SELECT
  p.id, p.slug, p.display_name, p.job_title, p.headline, p.bio,
  p.photo_url, p.address_city, p.address_state, p.gcid,
  g.display_name AS category_name,
  p.primary_license_number, p.primary_license_type, p.primary_license_verified,
  p.markets_served, p.same_as, p.claimed,
  p.compliance_complete, p.compliance_score,
  s.total_score, s.score_pct, s.local_rank, s.local_rank_of,
  s.top_pct, s.score_change_7d, s.gaps,
  ar.rating_value AS avg_rating, ar.review_count,
  o.name AS org_name, o.slug AS org_slug,
  c.display_license_on_profile, c.license_display_format, c.required_disclaimers, c.age_gate_required,
  sub.plan_id AS subscription_plan
FROM professionals p
LEFT JOIN gbp_categories g ON p.gcid = g.gcid
LEFT JOIN search_rank_scores s ON s.entity_type = 'professional' AND s.entity_id = p.id
LEFT JOIN aggregate_ratings ar ON ar.entity_type = 'professional' AND ar.entity_id = p.id AND ar.source = 'all'
LEFT JOIN organizations o ON p.primary_org_id = o.id
LEFT JOIN exp_category_compliance c ON p.gcid = c.gcid
LEFT JOIN subscriptions sub ON sub.entity_type = 'professional' AND sub.entity_id = p.id
WHERE p.is_active = TRUE;

CREATE OR REPLACE VIEW v_market_leaderboard AS
SELECT p.slug, p.display_name, p.job_title, p.photo_url,
  p.address_city, p.address_state, p.gcid,
  s.total_score, s.local_rank, s.top_pct,
  ar.rating_value, ar.review_count
FROM professionals p
JOIN search_rank_scores s ON s.entity_type = 'professional' AND s.entity_id = p.id
JOIN aggregate_ratings ar ON ar.entity_type = 'professional' AND ar.entity_id = p.id AND ar.source = 'all'
WHERE p.is_active = TRUE
ORDER BY p.gcid, p.address_city, s.total_score DESC;

CREATE OR REPLACE VIEW v_compliance_status AS
SELECT p.id, p.slug, p.display_name, p.gcid,
  c.gcid AS compliance_gcid, c.display_license_on_profile, c.age_gate_required, c.hipaa_applies,
  ec.license_displayed, ec.disclaimers_shown, ec.terms_accepted, ec.compliance_score, ec.missing_items
FROM professionals p
LEFT JOIN exp_category_compliance c ON p.gcid = c.gcid
LEFT JOIN entity_compliance ec ON ec.entity_type = 'professional' AND ec.entity_id = p.id
WHERE p.is_active = TRUE;

CREATE OR REPLACE VIEW v_plg_next_actions AS
SELECT p.id, p.slug, p.display_name, p.gcid,
  s.total_score, s.next_milestone, s.next_milestone_gap, s.gaps
FROM professionals p
JOIN search_rank_scores s ON s.entity_type = 'professional' AND s.entity_id = p.id
WHERE s.gaps IS NOT NULL
ORDER BY s.next_milestone_gap ASC;

CREATE OR REPLACE VIEW v_schema_regeneration_queue AS
SELECT entity_type, entity_id, page_type, invalidated_at
FROM schema_cache WHERE is_valid = FALSE ORDER BY invalidated_at ASC;

CREATE OR REPLACE VIEW v_claim_queue_pending AS
SELECT cq.id, cq.entity_type, cq.entity_id, cq.claimant_email, cq.claimant_name,
  cq.confidence_score, cq.match_method, cq.status, cq.created_at,
  p.display_name AS profile_name, p.gcid
FROM claim_queue cq
LEFT JOIN professionals p ON cq.entity_type = 'professional' AND cq.entity_id = p.id
WHERE cq.status IN ('pending','manual_review')
ORDER BY cq.confidence_score DESC;

-- ========== RLS + GRANTS ==========
GRANT ALL ON public.exp_category_compliance TO service_role;
ALTER TABLE public.exp_category_compliance ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.exp_category_ui_config TO service_role;
ALTER TABLE public.exp_category_ui_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.user_accounts TO service_role;
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.sso_config TO service_role;
ALTER TABLE public.sso_config ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.professionals TO service_role;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.professional_org_memberships TO service_role;
ALTER TABLE public.professional_org_memberships ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.entity_compliance TO service_role;
ALTER TABLE public.entity_compliance ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.content_compliance_rules TO service_role;
ALTER TABLE public.content_compliance_rules ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.oauth_connections TO service_role;
ALTER TABLE public.oauth_connections ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.crm_integrations TO service_role;
ALTER TABLE public.crm_integrations ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.sync_jobs TO service_role;
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.claim_queue TO service_role;
ALTER TABLE public.claim_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.onboarding_progress TO service_role;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.etl_sources TO service_role;
ALTER TABLE public.etl_sources ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.graph_nodes TO service_role;
ALTER TABLE public.graph_nodes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.graph_edges TO service_role;
ALTER TABLE public.graph_edges ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.wikidata_mappings TO service_role;
ALTER TABLE public.wikidata_mappings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.credentials TO service_role;
ALTER TABLE public.credentials ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.review_campaigns TO service_role;
ALTER TABLE public.review_campaigns ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.content_items TO service_role;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.media_items TO service_role;
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.transaction_signals TO service_role;
ALTER TABLE public.transaction_signals ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.search_rank_scores TO service_role;
ALTER TABLE public.search_rank_scores ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.score_history TO service_role;
ALTER TABLE public.score_history ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.plg_rules TO service_role;
ALTER TABLE public.plg_rules ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.plg_events TO service_role;
ALTER TABLE public.plg_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.listings TO service_role;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.schema_cache TO service_role;
ALTER TABLE public.schema_cache ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.schema_validation_log TO service_role;
ALTER TABLE public.schema_validation_log ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.index_intelligence TO service_role;
ALTER TABLE public.index_intelligence ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.aggregate_ratings TO service_role;
ALTER TABLE public.aggregate_ratings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.enterprise_settings TO service_role;
ALTER TABLE public.enterprise_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.terms_acceptance TO service_role;
ALTER TABLE public.terms_acceptance ENABLE ROW LEVEL SECURITY;