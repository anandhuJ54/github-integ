---
name: migration-authoring
description: Author a database migration correctly for this repo (Alembic revision in the owning Surface's branch, hand-written SQL, additive only, RLS baseline, backup + JOIN verification plan, change-log entry). Never applies anything.
---

# Migration authoring

1. A new Alembic revision in the owning Surface's branch, from `surface-api/`:
   - the Surface's first one: `uv run alembic revision -m "<what>" --head=base --branch-label=<surface> --version-path=<surface>/db/migrations --depends-on=866c5f655041` (the `_base` baseline);
   - later ones: `uv run alembic revision -m "<what>" --head=<surface>@head`.
   Write the SQL by hand in `upgrade()` with `op.execute("""...""")`, and `depends_on` any revision of another branch whose table it uses. `surface-api/migrations/NNNN_*.sql` is closed: never add a file there.
2. **Additive only** on protected tables (`exp_*`, `graph_*`, `search_*`, `claim*`, `*_scores`): no DROP / TRUNCATE / destructive ALTER. Retire = `is_active=false`.
3. **Idempotent**: `IF NOT EXISTS`, `CREATE OR REPLACE` only for functions this Surface owns and that are not live-edited ETL functions (O9).
4. **Security baseline for new tables**:
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
   -- policies with real predicates; never USING (true) / WITH CHECK (true) except TO service_role
   REVOKE ALL ON <t> FROM anon, PUBLIC;
   ```
   SECURITY DEFINER functions: `SET search_path = public, pg_temp`; grant EXECUTE narrowly.
5. Never edit an already-applied migration; write a new one.
6. In `plan.md` write: backup table name (`zz_backup_<t>_<date>`), the human-approved apply step, the **JOIN** verification query (match counts against the canonical table), rollback.
7. Add the `docs/ETL-Enhancements.md` entry (trigger, evidence, change, verification, still open).
8. Run `python3 tools/lint/lint_all.py` — it must pass. **Do not apply the migration**; applying is a human-approved step (`cd surface-api && uv run alembic upgrade heads`, run by a human after backup + JOIN verification; `--sql` prints the SQL for review). Also run `uv run pytest tests/test_migrations.py`.
