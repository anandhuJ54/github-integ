# Plan: campaigns and xmp tables, ORM models and the survey-templates endpoint

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

## Tasks
| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|
| 0 | Rules: one Postgres schema per Surface; only the owner reads / writes its schema; new tables use grants, not row-level security (AGENTS.md, Surface AGENTS.md, READMEs, env.py, revision template, skills) | shared core | `tests/test_schemas.py`, `tests/test_boundaries.py`, `*/tests/test_migrations_security.py` | — |
| 1 | xmp migration: schema `xmp` and its tables, grants (no session table) | `xmp/db/migrations/bee7556b77dd_xmp_tables.py` | `xmp/tests/test_migrations_security.py`, `tests/test_migrations.py` | — |
| 1b | `_base` migration: `public.survey_sources` (shared core), grants; ORM class in `_base/models/` | `_base/db/migrations/140d9efec771_base_survey_sources.py`, `_base/models/survey_source.py` | `_base/tests/test_migrations_security.py`, `tests/test_schemas.py::test_base_models_are_in_public` | — |
| 2 | campaigns migration: schema `campaigns` and its tables, grants | `campaigns/db/migrations/ec94892239fd_campaigns_tables.py` | `campaigns/tests/test_migrations_security.py` | 1, 1b |
| 3 | ORM classes, one module per table, on the new shared `_base/db/base.py` (`Base`, mixins, naming convention) | `_base/db/base.py`, `xmp/src/models/*.py`, `campaigns/src/models/*.py` | `tests/test_schemas.py`; Alembic `compare_metadata` on a migrated scratch database | 1, 1b, 2 |
| 4 | xmp read helpers on psycopg: `exports.py`, `enums.py` | `xmp/src/` | `xmp/tests/test_exports.py` | 3 |
| 5 | `GET /campaigns/survey-templates`, the account helpers, `internal.get_accounts_for` | `campaigns/src/{survey_template,campaign,campaign_transaction}/`, `internal.py`, `router.py` | `campaigns/tests/test_survey_templates.py` | 4 |
| 6 | Published contract | `contracts/campaigns/openapi.json` (`python -m app.contracts campaigns`) | `tests/test_contracts.py` | 5 |

## Extend-never-duplicate check
Repo search over `surface-api/_base/db/tables.py` (generated from the live database, 188 tables),
`surface-api/**`, `contracts/` and `docs/`. **The live catalog was not queried** (no read-only
connector in this session); `tables.py` covers only the tables `generate.py` lists, so the human
apply step must check that the schemas `xmp` and `campaigns` do not exist yet (`pg_namespace`). Inside
those schemas the 12 names cannot clash with `public`.

| New table | Closest existing object | Result |
|---|---|---|
| `accounts` | `exp_accounts` (CRM account: owner, ARR, stage), `organizations` (graph entity) | different shape and meaning; `xmp.accounts` is the enterprise tenant. Overlap with `organizations` is part of the identity / O11 decision |
| `users`, `account_users` | `auth.users`, `user_accounts` (Supabase profile) | different: enterprise people and memberships for the data load. Mapping to Supabase users is an unassigned-ownership decision (identity registry); no sign-in uses `users` |
| `tiers`, `tier_agents` | `exp_account_tier` (sales tier per account), `professionals` | different (an account's private hierarchy and its agents) |
| `verticals` | `gbp_categories`, `exp_sales_rep_verticals`, `exp_vertical_node_registry` | business vertical (Real Estate, Mortgage, All), not a GBP category; name conflicts with the canon (needs a ruling) |
| `campaigns`, `campaign_drafts`, `campaign_transactions` | `review_campaigns`, `exp_web_campaigns` | O11: one campaign table or two. Not resolved |
| `survey_templates`, `vertical_survey_templates`, `survey_sources` | none found (`survey`, `template`, `source` searched) | new |

Not added: functions, role systems, outboxes, entitlements, price constants.

## Migration plan
- Files: `xmp/db/migrations/bee7556b77dd_xmp_tables.py` (branch `xmp`, depends on the `_base`
  baseline `866c5f655041`); `campaigns/db/migrations/ec94892239fd_campaigns_tables.py` (branch
  `campaigns`, depends on `140d9efec771` (which sits on the baseline) and `bee7556b77dd`);
  `_base/db/migrations/140d9efec771_base_survey_sources.py` (`_base`, after the baseline). No `migrations/` (closed stream) file.
- Backup: none needed; no existing table changes. New tables only, no protected prefix.
- Apply (human-approved, **after the O11 ruling**): `cd surface-api && uv run alembic upgrade heads --sql`
  to review, then `uv run alembic upgrade heads`.
- Verification after apply (read-only):
  ```sql
  SELECT table_schema, table_name, grantee, string_agg(privilege_type, ',') FROM information_schema.role_table_grants
   WHERE (table_schema IN ('xmp', 'campaigns') OR table_name = 'survey_sources')
     AND grantee IN ('anon', 'authenticated', 'PUBLIC') GROUP BY 1, 2, 3;
  -- only authenticated SELECT on verticals, survey_sources, survey_templates, vertical_survey_templates
  SELECT has_table_privilege('anon', 'public.survey_sources', 'SELECT');  -- false
  SELECT has_schema_privilege('anon', 'xmp', 'USAGE'), has_schema_privilege('anon', 'campaigns', 'USAGE');  -- false, false
  ```
  After a data load, the JOIN check is the link count:
  `SELECT count(*) FROM campaigns.vertical_survey_templates vst JOIN campaigns.survey_templates st ON st.id = vst.survey_template_id JOIN xmp.verticals v ON v.id = vst.vertical_id;`
  equal to `SELECT count(*) FROM campaigns.vertical_survey_templates;`.
- Rollback: `uv run alembic downgrade campaigns@base`, `uv run alembic downgrade xmp@base`, then
  `uv run alembic downgrade 866c5f655041` (drops only the 12 new tables and the two schemas).

## Test plan
- Unit (no database): `campaigns/tests/test_survey_templates.py` (criteria 1–3),
  `xmp/tests/test_exports.py` (criterion 4), `*/tests/test_migrations_security.py` (criterion 5).
- Guards: `tests/test_migrations.py`, `test_boundaries.py`, `test_routes.py`, `test_contracts.py` (criterion 7).
- Scratch Postgres 18 with `anon` / `authenticated` / `service_role`, Supabase's default privileges
  on `public` and the 28 `schema_migrations` tags: upgrade, role checks, the endpoint through the real app and
  `role_connection`, downgrade, upgrade again (criterion 6). Recorded in [evidence](./evidence.md).

## Risks
- **O11 / identity not decided:** the tables may change shape after the ruling. They are not
  applied, so a change is an edit of these unapplied revisions, not a new migration.
- **Schema already present in the live database:** not checked (see above); `CREATE SCHEMA IF NOT
  EXISTS` would reuse it, and `CREATE TABLE` would then fail on a clash.
- **Rule change is shared core:** other Surfaces' future tables now go in their own schemas; the
  existing `public` tables stay until moved with a ruling.
- **Alembic dependency trap (fixed here, shared core):** a revision that lists both the baseline and a
  later `_base` revision makes `alembic upgrade heads` fail (`KeyError: '866c5f655041'`, reproduced on
  the scratch database). The campaigns revision lists only `140d9efec771`; `tests/test_migrations.py`
  now accepts a later `_base` revision as a branch's start and rejects a `_base` revision listed with
  its ancestor; AGENTS.md §4 and the migration-authoring skill say so.
- `users.password_digest` and the token columns hold credentials once loaded; only the service
  role can read them. Whether to load them at all belongs to the identity decision.
- `tools/lint/lint_all.py` does not exist in the repository, so the security / canon lint could not
  run; `*/tests/test_migrations_security.py` checks the grants baseline for these files instead.
