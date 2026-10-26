# Intent: surface-api layout aligned with v3-api, Alembic per Surface

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | shared core (`_base`) |
| Increment id | _base/surface-api-v3-layout |
| Status | approved by the project owner (ruling 2026-10-26); second approval pending |
| Date | 2026-10-26 |

## Problem
The campaigns team builds in a second backend (`v3-api`, branch `campaigns/port-to-surface-api`) with a
different folder shape from `surface-api`: code in `<surface>/src` imported as `surfaces.<surface>`,
one folder per resource, `exports.py` / `internal.py` per Surface, tests and migrations per Surface.
Two shapes in one repo means code cannot move between them without rework, and `surface-api` had
flat `routers/` + `queries/` folders, a nested `_base/core/`, test fakes copied in eight places and
one migration stream with no per-Surface ownership.

## Outcome
`surface-api` has the same structure as `v3-api`, so the campaigns team's code drops in, while the
stack stays ours (one Supabase database, SQLAlchemy Core, RLS, Supabase login). Every Surface has
its own migration folder. No route, response or behaviour changes.

## Signals and sources
| Source | Label | What it shows |
|---|---|---|
| `origin/campaigns/port-to-surface-api:v3-api/docs/DEVELOPER_GUIDE.md` §3, §7 | Repo | the target layout and Alembic per Surface |
| `surface-api/` at `migrate/browser-to-api` (0238b75) | Repo | the layout before: `routers/`, `queries/`, `_base/core/`, one SQL stream |
| Owner instructions in the working session, 2026-10-26 | Programme input | copy the structure only; do not move the campaigns code, the migration files or the tables |

## Success measure
Route table and every Surface's OpenAPI byte-identical before and after; all tests pass; parity
green against the live database; the guard tests in `surface-api/tests/` pass.

## Open decisions touched
- **Stack amendment** (AGENTS.md §4, touching O2, O9, O12): this extends it; still needs the recorded
  shared-core ruling and a second approval.
- **Unassigned ownership** (AGENTS.md §5: claims, scorer, category knowledge, billing, identity
  registry): NOT resolved here. Tables stay in `_base/db/tables.py`; each Surface's `src/models/` is empty.
- **O9** (live ETL definitions): Alembic revisions must never overwrite a live ETL function.

## Out of scope
- Moving the campaigns code from the campaigns branch (that team moves it).
- Moving tables into `<surface>/src/models/` and assigning table owners (teams do it, with rulings).
- Moving the 28 existing SQL migrations; applying or stamping anything in any database.
- ORM models, a separate database, the v2 login system from `v3-api`.
