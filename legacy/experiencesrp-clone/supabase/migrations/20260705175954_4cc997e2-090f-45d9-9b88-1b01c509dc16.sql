CREATE TABLE IF NOT EXISTS exp_schema_type_ring_map (
  schema_type     text NOT NULL,
  ring_key        text NOT NULL,
  schema_property text NOT NULL,
  inherited_from  text NOT NULL,
  value_range     text,
  PRIMARY KEY (schema_type, schema_property)
);
GRANT SELECT ON exp_schema_type_ring_map TO anon;
GRANT SELECT ON exp_schema_type_ring_map TO authenticated;
GRANT ALL ON exp_schema_type_ring_map TO service_role;
ALTER TABLE exp_schema_type_ring_map ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "strm readable" ON exp_schema_type_ring_map FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_strm_type_ring ON exp_schema_type_ring_map (schema_type, ring_key);