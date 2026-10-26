-- MODEL COMPLETION (Scott directive 2026-07-11): the data model must hold every node class
-- the platform will DISCOVER (ETL), CREATE (features), or INGEST (user) — no future appending.
-- Findings fixed here:
--   BUG: graph_nodes.ring was SMALLINT 0-7 (pre-dates the canonical 10 named rings) — instances
--        could not even represent the registry they instantiate.
--   GAP: content_items had no event/product/offer/video/podcast kinds, no structured payload.
--   GAP: no publications table (one post -> many channels, scheduled) — the multi-post spine.
--   GAP: no enterprise content libraries / approvals / professional subscriptions.
--   GAP: no unified external-identity map (place_id, fsq_id, infogroup_id...) for ETL + listings runtime.
--   GAP: no proposals ledger (Curator + user "you missed this node" ingestion promotions).

-- 0) MULTIPLICITY DOCTRINE: graph_nodes carries NO uniqueness on (entity, registry_node) —
--    an entity may instantiate any registry node type unlimited times (every review, every video,
--    every product, every channel). Containers (a channel) link children (its videos) via graph_edges.
--    Bounded Score lanes apply diminishing returns; Expertise Signals absorbs everything 1:1.

-- 1) RING CANON FIX on instances
ALTER TABLE graph_nodes DROP CONSTRAINT IF EXISTS graph_nodes_ring_check;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS ring_key TEXT;
UPDATE graph_nodes SET ring_key = CASE ring
  WHEN 0 THEN 'identity' WHEN 1 THEN 'authority' WHEN 2 THEN 'presence'
  WHEN 3 THEN 'content' WHEN 4 THEN 'reputation' WHEN 5 THEN 'engagement'
  WHEN 6 THEN 'conversion' WHEN 7 THEN 'entity_graph' END
WHERE ring_key IS NULL;
ALTER TABLE graph_nodes ALTER COLUMN ring DROP NOT NULL;
ALTER TABLE graph_nodes ADD CONSTRAINT graph_nodes_ring_key_canonical CHECK (ring_key IS NULL OR ring_key IN
  ('identity','authority','presence','content','media','reputation','social','engagement','conversion',
   'transactions','upstream','location','services','entity_graph'));

-- 2) CONTENT SPINE: every creatable node kind is a content kind (one spine, structured payloads)
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_content_type_check;
ALTER TABLE content_items ADD CONSTRAINT content_items_content_type_check CHECK (content_type IN
  ('article','blog_post','qa_answer','social_post','landing_page','how_to','guide','press_release','guest_article',
   'event','product','offer','service','video','podcast','menu','menu_item','faq','case_study','newsletter','review_response'));
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS structured_data JSONB;         -- event times/venue, product price/sku, offer terms
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS compliance_state TEXT NOT NULL DEFAULT 'unreviewed'
  CHECK (compliance_state IN ('unreviewed','auto_passed','flagged','approved','rejected'));
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS library_id UUID;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 3) PUBLICATIONS: one content item -> many channels, scheduled, tracked (multi-post spine)
CREATE TABLE IF NOT EXISTS content_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN
    ('profile_page','voce','google_posts','google_qa','facebook','instagram','linkedin','x','youtube','tiktok',
     'gbp_menu','gbp_products','newsletter','rss')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','publishing','published','failed','deleted')),
  scheduled_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  external_id TEXT, external_url TEXT, error TEXT,
  payload_override JSONB,                       -- per-channel edits of the one post
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pub_content ON content_publications(content_id);
CREATE INDEX IF NOT EXISTS idx_pub_sched ON content_publications(status, scheduled_at);

-- 4) ENTERPRISE LIBRARIES: pre-approved content, professional subscriptions
CREATE TABLE IF NOT EXISTS content_libraries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT,
  preapproved BOOLEAN NOT NULL DEFAULT false,   -- items enter approved; professionals may auto-publish
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS library_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id UUID NOT NULL REFERENCES content_libraries(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  auto_publish BOOLEAN NOT NULL DEFAULT false,
  channels TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (library_id, professional_id)
);
ALTER TABLE content_items ADD CONSTRAINT content_items_library_fk
  FOREIGN KEY (library_id) REFERENCES content_libraries(id);

-- 5) EXTERNAL IDENTITY MAP: one place for every publisher/system identity of an entity
CREATE TABLE IF NOT EXISTS entity_external_ids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('professional','organization','location')),
  entity_id UUID NOT NULL,
  system TEXT NOT NULL CHECK (system IN
    ('google_place','google_location','foursquare','data_axle','apple','bing','yelp','facebook','instagram',
     'linkedin','x','youtube','tiktok','nmls','npi','state_license','wikidata','crm','other')),
  external_id TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (system, external_id)
  -- deliberately NO (entity, system) uniqueness: an entity may hold N identities per system
  -- (two YouTube channels + a Vimeo is normal). More is more: unbounded instances per source type.
);
CREATE INDEX IF NOT EXISTS idx_ext_ids_entity ON entity_external_ids(entity_type, entity_id, system);

-- 6) PROPOSALS LEDGER (append-only): Curator proposals AND user "you missed this node" ingestions.
--    Nothing changes data without an approval row; approved payloads still pass the gauntlet on apply.
CREATE TABLE IF NOT EXISTS curation_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('category','entity')),
  gcid TEXT REFERENCES gbp_categories(gcid),
  entity_type TEXT, entity_id UUID,
  section TEXT NOT NULL,                         -- taxonomy | registry | compliance | logic | economics | operational | custom_node
  action TEXT NOT NULL CHECK (action IN ('insert','update','remove','flag')),
  payload JSONB NOT NULL,
  rationale TEXT, evidence JSONB,
  confidence TEXT CHECK (confidence IN ('high','medium','low')),
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('curator_agent','user','etl','system')),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','applied','superseded')),
  reviewed_by UUID, reviewed_at TIMESTAMPTZ, applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON curation_proposals(status, scope);

ALTER TABLE content_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE curation_proposals ENABLE ROW LEVEL SECURITY;
