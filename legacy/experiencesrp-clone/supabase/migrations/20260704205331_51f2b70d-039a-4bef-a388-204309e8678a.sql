ALTER TABLE exp_directory_packs
  ADD COLUMN IF NOT EXISTS directory_scope text NOT NULL DEFAULT 'unverified'
    CHECK (directory_scope IN ('universal','cross_category','single_field','unverified')),
  ADD COLUMN IF NOT EXISTS field text,
  ADD COLUMN IF NOT EXISTS scope_confirmed_by text,
  ADD COLUMN IF NOT EXISTS scope_confirmed_at timestamptz;

ALTER TABLE exp_directory_packs
  DROP CONSTRAINT IF EXISTS field_requires_single_field;
ALTER TABLE exp_directory_packs
  ADD CONSTRAINT field_requires_single_field
    CHECK (field IS NULL OR directory_scope = 'single_field');

UPDATE exp_directory_packs
   SET directory_scope = 'universal', field = NULL,
       scope_confirmed_by = 'system:universal-pack', scope_confirmed_at = now()
 WHERE pack_family = 'universal';

UPDATE exp_directory_packs
   SET directory_scope = 'unverified', field = NULL
 WHERE pack_family <> 'universal';

COMMENT ON COLUMN exp_directory_packs.directory_scope IS
  'universal=every category; cross_category=many unrelated fields (no identity); single_field=one field (field set); unverified=not yet confirmed, must not drive family mapping';
COMMENT ON COLUMN exp_directory_packs.field IS
  'The single business field this directory belongs to. Valid ONLY when directory_scope=single_field.';