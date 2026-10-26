-- LISTINGS MAPPING TABLES: publishers, field maps, crosswalks, per-category status.
CREATE TABLE IF NOT EXISTS exp_listings_publishers (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, api_notes text, publishes_to text, ops_notes jsonb
);
CREATE TABLE IF NOT EXISTS exp_listings_field_map (
  id serial PRIMARY KEY, publisher_id text REFERENCES exp_listings_publishers(id),
  section text NOT NULL, section_note text, their_field text NOT NULL, our_target text NOT NULL,
  rules text, applicability text NOT NULL DEFAULT 'base',
  status_default text NOT NULL DEFAULT 'mapped', variant_family text, sort int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exp_listings_crosswalk (
  gcid text NOT NULL, publisher_id text NOT NULL, code text NOT NULL, label text,
  breadcrumb text, confidence text, verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (gcid, publisher_id)
);
CREATE TABLE IF NOT EXISTS exp_listings_category_status (
  gcid text NOT NULL, family text NOT NULL, present boolean NOT NULL, PRIMARY KEY (gcid, family)
);
CREATE TABLE IF NOT EXISTS exp_listings_overlays (
  gcid text NOT NULL, overlay text NOT NULL, PRIMARY KEY (gcid, overlay)
);
ALTER TABLE exp_listings_publishers ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_listings_field_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_listings_crosswalk ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_listings_category_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE exp_listings_overlays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read listings publishers" ON exp_listings_publishers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings field map" ON exp_listings_field_map FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings crosswalk" ON exp_listings_crosswalk FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings category status" ON exp_listings_category_status FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public read listings overlays" ON exp_listings_overlays FOR SELECT TO anon, authenticated USING (true);
