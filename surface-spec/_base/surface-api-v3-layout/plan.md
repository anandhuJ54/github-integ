# Plan: surface-api layout aligned with v3-api, Alembic per Surface

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

## Tasks
Each a commit on `restructure/surface-api-layout`; most are pure moves, larger than ~400 lines only
because files moved.

| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|
| 1 | Flatten `_base`, app shell to `app/` | `_base/`, `app/`, `tests/` | route-table dump baseline | — |
| 2 | `<surface>/src` as `surfaces.<surface>`; tests to `<surface>/tests` | all Surfaces, `pyproject.toml` | full suite, route dump | 1 |
| 3 | Resource folders + `exports.py` / `internal.py` (6 parallel agents) | `<surface>/src/**` | per-Surface route/OpenAPI dumps | 2 |
| 4 | Guard tests: boundaries, routes/shape | `tests/test_boundaries.py`, `tests/test_routes.py` | — | 3 |
| 5 | `db/migrations/` per Surface; Alembic + `_base` baseline | `alembic.ini`, `alembic_env/`, `*/db/migrations/` | `tests/test_migrations.py` | 2 |
| 6 | One shared `conftest.py` | `conftest.py`, `*/tests/conftest.py` | full suite | 2 |
| 7 | Empty `src/models/` per Surface | `*/src/models/` | shape test | 3 |
| 8 | Docs: AGENTS.md, README, developer guide, skill, CODEOWNERS | docs | — | 1–7 |

## Extend-never-duplicate check
- Migration tracking: extends the existing runner; `schema_migrations` stays for the closed stream,
  Alembic adds `alembic_version` only on first human apply. No other new DB objects.
- Test fakes: eight copies merged into one; no new fixture types.
- Import boundary: `tests/test_boundaries.py` complements the existing `boundary/*` lint (absent on
  this branch; FOLLOWUPS §4 B).

## Migration plan
None applied. First real use of Alembic (after approval): backup, `uv run --env-file .env alembic
upgrade heads` (creates `alembic_version`, runs the baseline check), verify `select version_num from
alembic_version` = `866c5f655041`, log in `docs/ETL-Enhancements.md`. Rollback: drop `alembic_version`
(the baseline changes nothing else).

## Test plan
- Route table and per-Surface OpenAPI dumps compared byte for byte (AC 1–2).
- `uv run pytest` (AC 3), guard tests (AC 4–6), `ruff`.
- Parity suites against the live DB through a running copy of the restructured API (AC 7).
- UI typecheck of every app (UI unchanged, but imports of contracts and API paths are exercised).

## Risks
- Teams must run `uv sync` once after pulling (the `surfaces.*` import name comes from the editable install).
- Open branches touching `surface-api/<surface>/routers|queries` will conflict; rebase onto this layout.
- `alembic upgrade heads` on a database missing any of the 28 SQL files stops with an error by design.
