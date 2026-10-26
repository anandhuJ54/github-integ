# Evidence: surface-api layout aligned with v3-api, Alembic per Surface

<!-- Stage: Test. Shared template — do not remove sections. Required for merge. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md) · PR: https://github.com/Experience-org/v3-experiencesrp/pull/3

## Acceptance criteria results
| # | Criterion | Test / check | Result |
|---|---|---|---|
| 1 | Route table identical | dump of methods, paths, endpoint names before (`migrate/browser-to-api`) and after; `cmp` | Pass: 605 routes, 537 paths, 204 schemas, byte-identical |
| 2 | Each Surface's routes + OpenAPI identical | per-Surface dump (one router mounted alone), `cmp` against its baseline, all 13 | Pass: 13/13 identical |
| 3 | Existing tests pass unchanged | `uv run pytest` | Pass: 1,539 (1,526 existing, no assertion changes, + 13 guards) |
| 4 | Import boundaries | `tests/test_boundaries.py` | Pass |
| 5 | Standard Surface shape, mapped and mounted once | `tests/test_routes.py` | Pass |
| 6 | Migrations on the right branch; stream closed | `tests/test_migrations.py`; trial sales branch passed, a misplaced revision failed (both removed) | Pass |
| 7 | Parity green against the live DB | `surface-ui/parity/run.ts`, signed in, against a running copy of the restructured API | Pass: 524/524 (conversion-agents 9, search 6, admin 15, srp 14, ops 20, etl 47, graph 68, xmp 69, base 46, sales 230) |

Also: `uv run ruff check .` clean; every UI app typechecks (14); contracts regenerate unchanged;
the API starts with `uv run --env-file .env uvicorn app:app` (`/healthz`, `/docs`, a DB-backed
server function: 200); `alembic upgrade heads --sql` renders offline.

## CI gates
To be filled from the PR's `core-gates` and `pr-evidence` runs.

## Evals (Skills / NORA / AI output only)
None: no model-facing change.

## Live verification (data changes only)
No data change. Parity ran read-only cases against the live DB (above).

## Applied changes
None. No migration applied, no Alembic stamp, no DB object created.

## What remains unverified
- No click-through of UI pages; parity covers the API calls they make.
- Alembic has never run against a real database; the first `alembic upgrade heads` is a
  human-approved step (plan.md, Migration plan).
- `tools/lint/lint_all.py` is missing on this branch, so the lint ratchet was not run (FOLLOWUPS §4 B).
- Parity ran with my own copy of the API on port 8011 (`DB_POOL_MAX=5`, `DB_POOL_TIMEOUT=30`) to run
  suites in parallel; default settings were not exercised under that load.

## Change log
No `docs/ETL-Enhancements.md` entry: no DB function, table, trigger, cron or ETL logic changed.
The etl Surface's code moved files only (routes and OpenAPI identical).
