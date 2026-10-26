-- Re-model directory scope to make the "cross-category directory mislabeled as a
-- single-field family" error UNREPRESENTABLE.
--
-- Root cause of the Thumbtack/Angi/TripAdvisor/LinkedIn errors: pack_family was
-- overloaded to mean both "what kind of directory" and "what kind of business uses it".
-- For cross-category marketplaces those differ, so category identity got corrupted.
--
-- Fix: separate scope from field. A directory's FIELD label exists ONLY when its scope
-- is confirmed 'single_field'. Cross-category and universal directories carry NO field,
-- so they can never confer a business identity. Everything starts 'unverified' — a guess,
-- not a fact — and CANNOT act as a family signal until a human confirms scope.

ALTER TABLE exp_directory_packs
  ADD COLUMN IF NOT EXISTS directory_scope text NOT NULL DEFAULT 'unverified'
    CHECK (directory_scope IN ('universal','cross_category','single_field','unverified')),
  ADD COLUMN IF NOT EXISTS field text,               -- set ONLY when scope='single_field'
  ADD COLUMN IF NOT EXISTS scope_confirmed_by text,  -- who verified (audit trail)
  ADD COLUMN IF NOT EXISTS scope_confirmed_at timestamptz;

-- Guard: a field label is only allowed on a confirmed single_field directory.
ALTER TABLE exp_directory_packs
  DROP CONSTRAINT IF EXISTS field_requires_single_field;
ALTER TABLE exp_directory_packs
  ADD CONSTRAINT field_requires_single_field
    CHECK (field IS NULL OR directory_scope = 'single_field');

-- Seed the scope we DO know with high confidence (the universal pack is definitionally
-- universal — every category gets it, no field). Everything else stays 'unverified'
-- until reviewed, INCLUDING all my hand-made family guesses (pack_family kept only as a
-- non-authoritative hint for the reviewer).
UPDATE exp_directory_packs
   SET directory_scope = 'universal', field = NULL,
       scope_confirmed_by = 'system:universal-pack', scope_confirmed_at = now()
 WHERE pack_family = 'universal';

-- Everything not universal: force to 'unverified' so no family logic can act on it yet.
UPDATE exp_directory_packs
   SET directory_scope = 'unverified', field = NULL
 WHERE pack_family <> 'universal';

COMMENT ON COLUMN exp_directory_packs.directory_scope IS
  'universal=every category; cross_category=many unrelated fields (no identity); single_field=one field (field set); unverified=not yet confirmed, must not drive family mapping';
COMMENT ON COLUMN exp_directory_packs.field IS
  'The single business field this directory belongs to. Valid ONLY when directory_scope=single_field.';
