# Spec: surface-api layout aligned with v3-api, Alembic per Surface

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · contracts: unchanged (no endpoint changes)

## Behaviour
A pure restructure plus a migration mechanism; no runtime behaviour changes.
- `_base/core/*` → `_base/*` and `_base/db/` (`session.py`, `sql.py`, `tables.py`); app shell
  `app.py` + `_base/app_factory.py` + `_base/contracts.py` → `app/` (`uvicorn app:app` unchanged).
- Each Surface: `<surface>/src` (import `surfaces.<surface>`, pyproject `package-dir` mapping),
  `src/router.py`, `src/exports.py`, `src/internal.py` (or `internal/`), `src/models/` (empty),
  `src/<resource>/{router,schemas,services}.py`, `<surface>/tests/`, `<surface>/db/migrations/`.
- One shared `surface-api/conftest.py` for the fake DBs and the test client.
- Alembic: one branch per Surface folder plus `_base`; hand-written SQL revisions; the `_base`
  baseline (866c5f655041) refuses to run unless the closed SQL stream `migrations/` is fully applied.
No model output is involved; everything is deterministic code.

## Acceptance criteria
1. The full route table (methods, paths, endpoint names) is identical before and after.
2. Every Surface's routes + OpenAPI (paths, schemas) are byte-identical to its baseline.
3. All pre-existing tests pass unchanged in assertions (1,526) plus the new guard tests.
4. A Surface imports another only through `surfaces.<other>.exports`; `_base` imports no Surface or `app`.
5. Every Surface has `router.py`, `exports.py`, `internal`, `models/`, is mapped in pyproject and mounted once.
6. Every Alembic revision sits in its owner's folder and branch; one head per branch; Surface branches
   start from the baseline; `migrations/` gets no new files.
7. Parity (old browser path vs new API) stays green against the live database.

## Data
- No table, function, policy or grant changes. No migration applied or stamped.
- New objects: Alembic's `alembic_version` table appears only when a person first runs
  `alembic upgrade heads` (human-approved step); extends the existing `schema_migrations` tracking,
  which stays for the closed stream.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | n/a (no new reads) |
| Capabilities | n/a (no new capabilities) |
| Events | n/a |
| Entitlement | n/a |
| Explanation | n/a |
| Value loop | n/a |

## Security and scope
No change to auth, roles, RLS or grants: queries still run through `role_connection` with the same
roles. `.claude` edit guard extended to applied Alembic revisions. Secrets stay in `.env` (never committed).

## Compliance
n/a (no user-facing output).

## Canon review
- Conflict flagged: AGENTS.md §4 said "one migration history: `migrations/NNNN_*.sql`"; this changes it
  to Alembic per Surface. Updated in the same PR; needs the shared-core ruling.
- `exports.py` allows in-process imports between Surfaces, which §2 otherwise routes through
  `contracts/`. Every `exports.py` is empty; cross-Surface use stays on the HTTP contract.

## Second-model review
Six independent sub-agents each restructured a disjoint set of Surfaces and verified their own
route/OpenAPI dumps; the integrating pass re-ran every dump and the full suite. A human second
approval is still required (shared core).

## Decision log entries
- 2026-10-26 — adopt the v3-api structure in surface-api (structure only, not its stack). Owner ruling.
- 2026-10-26 — migrations: Alembic, one branch per Surface + `_base`; existing SQL files not moved;
  `migrations/` closed. Owner ruling.
- 2026-10-26 — tables stay in `_base/db/tables.py`; empty `src/models/` per Surface; teams move tables.
- 2026-10-26 — campaigns code stays on its branch; that team moves it.
