# Spec: campaigns and xmp tables, ORM models and the survey-templates endpoint

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · contracts: [contracts/campaigns/openapi.json](../../../contracts/campaigns/openapi.json)

## Behaviour
`GET /campaigns/survey-templates?vertical_id=<id>` (signed-in user, Supabase JWT):
1. The vertical is looked up through `surfaces.xmp.exports.get_vertical`. Unknown id → 404
   `Vertical '<id>' not found`. `vertical_id` must be an integer ≥ 1 (else 422).
2. The "All" vertical (`name = 'All'`, lowest id) is looked up through `get_all_vertical`; when it
   exists its id is added to the set.
3. Returns the survey templates with `status = 1` that have a live link
   (`vertical_survey_templates.deleted_at IS NULL`) to any vertical in the set, each once, ordered by
   `updated_at` desc then `id` desc, as `[{id, name, description, video_link}]`.
4. Reads run as the signed-in user (`role_connection("authenticated", claims)`), so the grants apply.

Everything is deterministic code; no model decides anything.

Code without endpoints (read helpers for later increments): `surfaces.xmp.exports`
(`get_account`, `get_accounts`, `get_tier`, `get_tier_agent`, `get_vertical`, `get_all_vertical`,
the `*Ref` shapes, `ALL_VERTICALS_NAME`, the `*_ID_FK` constants), `surfaces.xmp.enums`,
`campaign/services.py`, `campaign_transaction/services.py` and `internal.get_accounts_for` in
campaigns. Each takes the caller's psycopg connection (queries are built from the ORM classes; rows
come back as dicts); soft-deleted rows are left out. The ORM classes (`Account`, `Tier`, `TierAgent`,
`User`, `AccountUser`, `Vertical` in xmp; `Campaign`, `CampaignDraft`, `CampaignTransaction`,
`SurveyTemplate`, `VerticalSurveyTemplate` in campaigns; `SurveySource` in `_base/models/`) are on a
shared `_base.db.base.Base`; relationships stay inside a Surface.

## Acceptance criteria
1. The endpoint returns active templates linked to the vertical or to "All", once each, newest
   `updated_at` first, with only `id, name, description, video_link`.
2. Unknown vertical → 404; `vertical_id` missing, 0 or not an integer → 422; no token → 403 and an
   invalid token → 401 (`_base.auth`, as every other endpoint).
3. Without an "All" vertical, only the requested vertical's templates are returned.
4. The xmp read helpers leave out soft-deleted accounts, tiers and tier agents.
5. No row-level security on the new tables (owner decision 2026-10-26); every new table revokes all
   from `anon`, `authenticated` and `PUBLIC` and grants back only to `authenticated` / `service_role`.
6. On a scratch Postgres with Supabase-like roles: `alembic upgrade heads` creates the 12 tables,
   `downgrade` removes them, and a second upgrade works; a signed-in user reads the catalog tables but
   not the tenant tables; `anon` reads nothing.
7. `tests/test_migrations.py`, `tests/test_boundaries.py`, `tests/test_routes.py` and
   `tests/test_contracts.py` pass.

## Data
- **New schemas and tables:** each Surface's own schema (rule added to AGENTS.md §4 by this
  increment), created by its first revision; shared core's `survey_sources` in `public`. Plain
  `CREATE TABLE`, so an existing name fails loudly.
  - schema `xmp` (`xmp/db/migrations/bee7556b77dd_xmp_tables.py`): `verticals`, `accounts`, `tiers`,
    `tier_agents`, `users`, `account_users`.
  - shared core, `public` (`_base/db/migrations/140d9efec771_base_survey_sources.py`, after the
    baseline): `survey_sources`; ORM class `_base.models.SurveySource`.
  - schema `campaigns` (`campaigns/db/migrations/ec94892239fd_campaigns_tables.py`, depends on the xmp
    revision and on `140d9efec771`): `campaigns`, `campaign_drafts`, `campaign_transactions`,
    `survey_templates`, `vertical_survey_templates`.
  - Columns, defaults, indexes and foreign keys follow "Models and Associations"; no session table.
    Cross-branch foreign keys use Alembic `depends_on`.
- **Read:** `verticals` (xmp, through `exports`), `survey_templates`, `vertical_survey_templates`.
  **Written:** nothing.
- **Extend-never-duplicate:** see [plan](./plan.md). `review_campaigns` (one row per send, entity
  based) is not a campaign definition; `organizations` / `exp_accounts` are not enterprise accounts;
  `user_accounts` is the Supabase profile, not an `xmp.users` row. That they stay separate is part of O11
  and the identity-registry decision.
- **Migration intent:** additive only, new tables only, no protected prefix touched. Backup is not
  needed (no existing table changes). Not applied by this increment.
- **Provenance:** no facts written.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | survey-template summaries for a vertical; unknown vertical is a 404, never an empty guess |
| Capabilities | none (read only) |
| Events | none |
| Entitlement | signed-in user; no plan gate yet |
| Explanation | not applicable |
| Value loop | not applicable until campaigns are created from a template |

## Security and scope
- Schemas `xmp` and `campaigns`: `REVOKE ALL ON SCHEMA ... FROM PUBLIC, anon`; `USAGE` for
  `authenticated` and `service_role` only. Not exposed by Supabase's REST API.
- Principal: the Supabase user from the verified JWT (`_base.auth.current_user`); reads run as
  `authenticated`, so the grants decide.
- Setup tables (`verticals`, `survey_sources`, `survey_templates`, `vertical_survey_templates`):
  `GRANT SELECT TO authenticated` (every row; no row-level security).
- Tenant tables (`accounts`, `tiers`, `tier_agents`, `users`, `account_users`, `campaigns`,
  `campaign_drafts`, `campaign_transactions`): no grant for `anon` / `authenticated`;
  only the service role reaches them until the identity mapping is decided.
- `users.password_digest` and the token columns exist for the data load; nothing reads or writes
  them, and no sign-in uses them.
- Untrusted input: `vertical_id` only (validated integer, bound parameter).

## Compliance
No user-facing generated content, no send.

## Canon review
- "Say category, never vertical": conflicts (`verticals`, `vertical_id`, `vertical_survey_templates`,
  the query parameter). Flagged, not resolved.
- "Extend, never duplicate": `users` / `account_users` vs `auth.users` / `user_accounts`;
  `campaigns` vs `review_campaigns`. Flagged (O11, identity registry).
- Security baseline: met (criterion 5) under the changed rule (AGENTS.md §3: new tables use grants, not RLS).

## Second-model review
Not done yet.

## Decision log entries
- 2026-10-26, working session (owner): `campaigns.campaign_transactions.email_next_processing_date` and
  `sms_next_processing_date` are `DATE`, not timestamps (migration and ORM class changed; the
  revision is not applied anywhere, so it was edited in place).
- 2026-10-26, working session (owner): new migrations do not add `ENABLE` / `FORCE ROW LEVEL SECURITY`
  (nor policies); access is by grants only. AGENTS.md §3, the migration-authoring, rls-grant-review
  and canon-review skills, the revision template and the developer guide are updated. Security
  change: needs the second approval (AGENTS.md §4).
- 2026-10-26, working session (owner): only the owning Surface reads and writes the tables in its
  schema; other Surfaces go through its `exports.py` (plain shapes; foreign keys through `*_ID_FK`).
  AGENTS.md §2/§4/§8 and the Surface AGENTS.md files updated; `tests/test_boundaries.py` checks SQL
  strings, migrations, ORM relationships and exports. Campaigns already complies (it reads xmp only
  through `surfaces.xmp.exports`).
- 2026-10-26, working session (owner): one Postgres schema per Surface. AGENTS.md §3/§4, the Surface
  AGENTS.md files, the migration READMEs, `alembic_env/env.py` and the migration-authoring and
  rls-grant-review skills are updated; `surface-api/tests/test_schemas.py` enforces it. Shared-core
  change: needs review for all Surfaces and a second approval.
- 2026-10-26, working session: add the campaigns and xmp code to `surface-api` on `main` following
  its rules; no sign-in of its own (Supabase). Blocks nothing; applying the migrations stays blocked
  on O11.
