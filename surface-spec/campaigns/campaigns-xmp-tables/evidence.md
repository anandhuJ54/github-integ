# Evidence: campaigns and xmp tables, ORM models and the survey-templates endpoint

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md) · PR: not opened (changes are uncommitted on `main`)

## Acceptance criteria results
| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | Active templates for the vertical or "All", once each, newest first, summary columns only | `campaigns/tests/test_survey_templates.py`; scratch database through the real app: vertical 1 → [11, 15, 10], vertical 2 → [12, 11, 15], vertical 3 ("All") → [11, 15]; the inactive template (13) and the deleted link (14) left out | pass |
| 2 | 404 unknown vertical; 422 bad `vertical_id`; 403 without a token | `test_endpoint_unknown_vertical_is_404`, `test_endpoint_bad_vertical_id_is_422` (missing, 0, "x"), `test_endpoint_needs_a_signed_in_user`; scratch database: vertical 9 → 404 | pass |
| 3 | No "All" vertical → only the vertical itself | `test_without_an_all_vertical_only_the_vertical_itself` | pass |
| 4 | xmp read helpers leave out soft-deleted rows | `xmp/tests/test_exports.py` | pass |
| 5 | No RLS; all revoked from anon / authenticated / PUBLIC, granted back only to authenticated / service_role | `*/tests/test_migrations_security.py`, `tests/test_schemas.py`; scratch database: 12 tables `relrowsecurity` false, 0 policies; `anon` → permission denied for schema `xmp` / `campaigns` and for table `survey_sources`; `authenticated` reads the 4 setup tables (1 / 3 / 6 rows), refused on `xmp.accounts`, `campaigns.campaigns` and on INSERT into `survey_sources`; endpoint results unchanged | pass |
| 6 | Upgrade / role checks / downgrade / upgrade on a scratch Postgres | Postgres 18.6: `upgrade heads` (4 revisions: `_base` 140d9efec771, xmp, campaigns; 6 tables in `xmp`, 5 in `campaigns`, `survey_sources` in `public`, 18 foreign keys); service role inserts into the identity columns without sequence grants; signed-in user reads verticals (3) and templates (6), `permission denied for table accounts`; `anon` → permission denied; service role reads `accounts`; `downgrade campaigns@base`, `xmp@base` and `866c5f655041` remove the tables and both schemas; `upgrade heads` again → 12 tables. `public.survey_sources`: `anon` refused, signed-in user reads it, campaign_transactions' foreign key points at it | pass |
| 6b | ORM classes match the migrations | scratch database after `upgrade heads`: Alembic `compare_metadata(..., compare_type=True, compare_server_default=True)` against `Base.metadata` for `xmp`, `campaigns` and `public.survey_sources` → 0 differences; `tests/test_schemas.py::test_every_surfaces_models_configure_together` | pass |
| 6c | Only the owner reads/writes its schema | `tests/test_boundaries.py`: no other Surface's `<schema>.<table>` in code strings or migrations (except `REFERENCES`), ORM relationships stay in a Surface, exports hand out no models; each check failed on a planted violation and passes on this change | pass |
| 7 | Guard tests | `tests/test_migrations.py`, `test_boundaries.py`, `test_routes.py`, `test_contracts.py` | pass |

## CI gates
Not run in CI (nothing pushed). Locally, in `surface-api/` (Python 3.13 venv; `uv` is not installed
on this machine): `ruff check .` → all checks passed; `pytest` → 1,605 passed (1,551 before this change).
`python3 tools/lint/lint_all.py` could not run: `tools/lint/` does not exist in the repository.

## Evals (Skills / NORA / AI output only)
Not applicable.

## Live verification (data changes only)
None: nothing was run against the live database, including the read-only catalog check (see plan,
"Extend-never-duplicate check").

## Applied changes
None. The migrations were applied only to a throwaway local Postgres cluster, which was deleted.

## What remains unverified
- That the schemas `xmp` and `campaigns` do not already exist in the live database.
- The grants against the real Supabase roles (the scratch database used stand-in `anon`,
  `authenticated` and a BYPASSRLS `service_role`, plus Supabase's default privileges on `public`).
- Results against real data (no data loaded).
- Second-model review; O11 ruling; identity-registry decision; the "vertical" canon ruling.

## Change log
`docs/ETL-Enhancements.md`: "campaigns and xmp tables, ORM models and survey-templates endpoint in surface-api (2026-10-26)".
