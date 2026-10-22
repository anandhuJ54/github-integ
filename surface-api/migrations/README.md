# Migrations — the shared database history

**One Supabase Postgres ⇒ one migration history.** All Surfaces share this database, so
there is a single, globally-numbered, linear migration stream here — never a per-Surface
sequence (two Surfaces can't each own "migration 0005" against one schema).

## Where
- All migrations live in `surface-api/migrations/NNNN_*.sql`.
- One `meta/_journal.json` tracks the single applied head.
- Apply with the runner, from the backend project: `cd surface-api && uv run python -m migrate status|apply`.

## Ownership without per-Surface folders
- A Surface owns its tables **logically** — by table naming and by CODEOWNERS routing on
  the migration **filename**. Put the Surface in the name: `0028_campaigns_add_email_templates.sql`.
- The **number** gives global apply order; the **name** gives ownership/review.

## Numbering conflicts
- Global numbering means two open branches may both author `0028`. The **second to merge
  rebases and renumbers** (→ `0029`) and adds its journal entry. Keep one linear head.

## Authoring (hand-written SQL — not ORM-generated)
Schema is Postgres-first (RLS, FORCE RLS, SECURITY DEFINER functions, triggers, governed
write functions) which ORMs model poorly. Use the `migration-authoring` + `rls-grant-review`
skills. Every new table:
- `ENABLE` **and** `FORCE ROW LEVEL SECURITY`
- no grants to `anon` / `PUBLIC`; public reads via SECURITY DEFINER views with pinned `search_path`
- never `USING (true)` / `WITH CHECK (true)` for any role but `service_role`
- additive only — retire via `is_active=false`, never DROP/TRUNCATE on `exp_*`/`graph_*`/`search_*`

## Applying (human-approved — never automatic on merge)
1. Snapshot: `zz_backup_*`
2. Apply the pending migrations in order
3. Verify by **JOIN match count**, not an isolated row count
4. Log the change in `docs/ETL-Enhancements.md` (trigger, evidence, change, verification, still-open)

## Why migrations are common but `surface-api/` and `surface-ui/` are per-Surface
Code has clean import boundaries, so it co-locates by domain. The database is one shared
mutable resource with one coherent order — it cannot be sharded by Surface. Different
natures, different placement.
