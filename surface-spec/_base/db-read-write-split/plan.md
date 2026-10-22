# Plan: Read/write database split (primary + read replica)

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

## Tasks
Small tasks (≤ ~400 changed lines each), in dependency order.

| # | Task | Files / tables | Test first | Depends on |
|---|---|---|---|---|
| 1 | Add `psycopg_pool` dependency | `surface-api/pyproject.toml` | — | — |
| 2 | Write failing tests for URL routing + pool reuse + RLS context | `surface-api/_base/core/db_test.py` | yes | 1 |
| 3 | Add `_primary_url` / `_replica_url` (replica falls back to primary) | `_base/core/db.py` | 2 | 2 |
| 4 | Add lazy per-URL `ConnectionPool` + `_lease(url, claims)` helper | `_base/core/db.py` | 2 | 3 |
| 5 | Add `read_connection(claims, fresh=False)` and `write_connection(claims)` | `_base/core/db.py` | 2 | 4 |
| 6 | Keep `connection()` / `rls_connection()` as aliases; verify existing callers | `_base/core/db.py`, `migrate.py`, `_base/core/compliance.py` | 2 | 5 |
| 7 | Document `DATABASE_READ_URL` (name only) in env/secret reference | env docs | — | 5 |

## Extend-never-duplicate check
Repo search + live catalog (`pg_class` / `pg_proc`) results for every new object.

- Repo: the only data-access module is `surface-api/_base/core/db.py` (grep for
  `psycopg.connect` / `ConnectionPool` returns only this file + vendored `.venv`). No parallel
  connection factory exists to duplicate — this task **extends** `db.py` in place.
- Live catalog: **no DB objects created** (no table, function, trigger, cron), so no
  `pg_class` / `pg_proc` entry is added. Catalog check is N/A beyond confirming nothing new.
- Secret: `DATABASE_READ_URL` is a new config name; confirm it is not already defined
  elsewhere before adding.

## Migration plan
File name, journal entry, backup table, apply step (human-approved), JOIN verification query, rollback.

- **No migration.** No schema or DB-object change. Nothing to back up, apply, or verify by JOIN.
- Rollback is config-only: unset `DATABASE_READ_URL` → all traffic returns to the primary.

## Test plan
Unit, contract, integration, eval suites (`*.test.ts`, evals `*.eval.test.ts`); how acceptance criteria map to tests.

- Unit (`_base/core/db_test.py`): resolve-URL tests cover acceptance criteria 1–3; RLS
  context set/unset covers 4; alias presence covers 5; pool-reuse (same object for same URL)
  covers 6. Pools/leases mocked so tests need no live DB.
- Integration (optional, gated): against a primary + replica pair, assert a write is visible
  on `fresh=True` read and that a plain replica read may lag — run only where both URLs exist.
- No evals (no model output).

## Risks
- **Replica lag** → stale reads if a read-after-write path forgets `fresh=True`. Mitigation:
  document the rule; audit profile write→read paths; default new ambiguous reads to `fresh=True`.
- **Pool lifecycle** in the app/runtime (open on startup, close on shutdown) — must hook into
  the app factory so pools are not leaked per worker.
- **Shared-core blast radius** — `db.py` is used by every Surface; aliases + unit tests guard
  against regressions, but the PR needs all-Surface review (root AGENTS.md §2).
- **RLS on standby** — confirm `set_config(..., is_local=true)` succeeds on the specific
  replica (hot standby); covered by the gated integration test before enabling in prod.
