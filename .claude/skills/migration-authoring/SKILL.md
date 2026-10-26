---
name: migration-authoring
description: Author a database migration correctly for this repo (Alembic revision in the owning Surface's branch, hand-written SQL, additive only, grants baseline, backup + JOIN verification plan, change-log entry). Never applies anything.
---

# Migration authoring

1. A new Alembic revision in the owning Surface's branch, from `surface-api/`:
   - the Surface's first one: `uv run alembic revision -m "<what>" --head=base --branch-label=<surface> --version-path=<surface>/db/migrations --depends-on=866c5f655041` (the `_base` baseline);
   - later ones: `uv run alembic revision -m "<what>" --head=<surface>@head`.
   Write the SQL by hand in `upgrade()` with `op.execute("""...""")`, and `depends_on` any revision of another branch whose table it uses. For `_base`, list only the newest revision needed (it implies the baseline); a `_base` revision together with its ancestor makes `alembic upgrade heads` fail (`tests/test_migrations.py`). `surface-api/migrations/NNNN_*.sql` is closed: never add a file there.
   **Schema:** a Surface's tables go in its own schema, named after its `surface-api` package. The first revision creates it and every statement names it (`<surface>.<table>`); never create a table in `public` or another Surface's schema (shared core keeps `public`: its tables come from `_base/db/migrations/`, its ORM classes in `_base/models/` leave `schema` unset):
   ```sql
   CREATE SCHEMA IF NOT EXISTS <surface>;
   REVOKE ALL ON SCHEMA <surface> FROM PUBLIC, anon;
   GRANT USAGE ON SCHEMA <surface> TO authenticated, service_role;  -- only the roles that need it
   ```
   Add or change the ORM class in `src/models/` (`__table_args__ = ({"schema": "<surface>"},)`, on `_base.db.base.Base`) in the same PR, and check it matches the SQL: apply the revisions to a scratch database and run Alembic's `compare_metadata` against `Base.metadata` (zero differences). `surface-api/tests/test_schemas.py` checks the schema.
2. **Additive only** on protected tables (`exp_*`, `graph_*`, `search_*`, `claim*`, `*_scores`): no DROP / TRUNCATE / destructive ALTER. Retire = `is_active=false`.
3. **Idempotent**: `IF NOT EXISTS`, `CREATE OR REPLACE` only for functions this Surface owns and that are not live-edited ETL functions (O9).
4. **Security baseline for new tables**:
   ```sql
   -- no row-level security on new tables (AGENTS.md §3): access is by grants only
   REVOKE ALL ON <t> FROM anon, authenticated, PUBLIC;   -- also drops Supabase's defaults on public
   GRANT SELECT, INSERT, UPDATE, DELETE ON <t> TO service_role;
   GRANT SELECT ON <t> TO authenticated;                  -- only if signed-in users read it
   ```
   SECURITY DEFINER functions: `SET search_path = public, pg_temp`; grant EXECUTE narrowly.
5. Never edit an already-applied migration; write a new one.
6. In `plan.md` write: backup table name (`zz_backup_<t>_<date>`), the human-approved apply step, the **JOIN** verification query (match counts against the canonical table), rollback.
7. Add the `docs/ETL-Enhancements.md` entry (trigger, evidence, change, verification, still open).
8. Run `python3 tools/lint/lint_all.py` — it must pass. **Do not apply the migration**; applying is a human-approved step (`cd surface-api && uv run alembic upgrade heads`, run by a human after backup + JOIN verification; `--sql` prints the SQL for review). Also run `uv run pytest tests/test_migrations.py`.
