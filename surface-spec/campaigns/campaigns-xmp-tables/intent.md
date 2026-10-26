# Intent: campaigns and xmp tables, ORM models and the survey-templates endpoint

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | 06-campaigns (with 05-xmp and shared core `_base`) |
| Increment id | campaigns/campaigns-xmp-tables |
| Status | draft — implementation requested by the project owner (working session, 2026-10-26); review and O11 ruling pending |
| Date | 2026-10-26 |

## Problem
`surface-api` has no tables, models or endpoints for the campaigns data model (accounts, tiers,
agents, users, verticals, campaigns, campaign transactions, survey templates). The model is defined
in the "Models and Associations" sheet, and the campaigns team needs it in the backend that ships,
following its rules: hand-written SQL migrations per Surface branch, Supabase sign-in, reads on the
psycopg connections, each Surface owning its tables.

## Outcome
`surface-api` holds the xmp and campaigns tables in the Surfaces' own schemas `xmp` and
`campaigns`, plus shared core's `public.survey_sources`, as ORM classes and SQL migrations with
narrow grants, and serves `GET /campaigns/survey-templates?vertical_id=` to signed-in users. Nothing
is applied to a database by this increment.

## Signals and sources
| Source | Label | What it shows |
|---|---|---|
| "Models and Associations" sheet ("Migration Input") | Programme input | the tables, columns, defaults, indexes and associations |
| `surface-api/alembic_env/env.py`, `*/db/migrations/README.md` | Repo | hand-written SQL revisions per Surface branch, from the `_base` baseline |
| `surface-api/_base/db/tables.py` (generated from the live database) | Repo | none of the 12 table names exists among the 188 generated tables; `organizations`, `user_accounts`, `exp_accounts`, `review_campaigns` cover different shapes |
| Owner instructions in the working session, 2026-10-26 | Programme input | add the campaigns and xmp code on `main` following the rules; each Surface in its own schema; ORM classes; `survey_sources` in `public` under shared core; only the owner reads / writes its schema; no row-level security on new tables |

## Success measure
`uv run pytest` and `uv run ruff check .` pass; `tests/test_migrations.py` passes with the new
revisions; the migrations apply and roll back cleanly on a scratch Postgres with Supabase-like
roles; the ORM classes match the migrated database; the survey-templates endpoint returns the
active templates of the vertical and of "All"; anonymous and signed-in users cannot read the tenant
tables.

## Open decisions touched
- **O11 (campaigns):** one campaign table or two, the survey model, and where transaction volume
  lands. This increment adds `campaigns`, `campaign_transactions` and `survey_templates` next to the
  existing `review_campaigns`. Listed, not resolved: the migrations must not be applied before an
  O11 ruling.
- **Unassigned ownership — identity registry:** `xmp.users` and `xmp.account_users` sit next to
  Supabase `auth.users` / `user_accounts`. How a Supabase user maps to an `xmp.users` row is not
  decided, so no endpoint uses them and only the service role can read them.
- **Canon "category, never vertical" (AGENTS.md §3):** `xmp.verticals` keeps that name so existing
  data loads 1:1. Needs a ruling: rename, or record an exception.

## Out of scope
- Sign-in, sessions and the account-membership check (Supabase sign-in is the auth boundary).
- An ORM Session (async or sync): the classes build queries that run on the psycopg connections;
  rows come back as dicts. Test data factories.
- Applying, stamping or backfilling anything in any database; loading existing data.
