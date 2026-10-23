# Plan: Base-level scalability hardening

<!-- Stage: Develop. Shared template — do not remove sections. -->

Links: [intent](./intent.md) · [spec](./spec.md)

## Tasks
| # | Task | Files | Test first | Depends on |
|---|---|---|---|---|
| 1 | Config module: validated env-driven settings + CORS/threadpool helpers | `_base/core/config.py` | yes (`config_test.py`) | — |
| 2 | Bound the pool from settings (+ `check`) | `_base/core/db.py` | yes (`db_test.py`) | 1 |
| 3 | Pin threadpool in lifespan; CORS from settings; add `/readyz` | `_base/app_factory.py` | smoke import | 1 |
| 4 | Multi-worker CMD; add missing `psycopg-pool` to image deps | `Dockerfile` | — | 2 |
| 5 | Document new env vars (name only) in `.env.example` | env docs | — | 1 |

## Extend-never-duplicate check
- Repo: no existing settings/config module — env vars were read inline
  (`db.py` `os.environ["DATABASE_URL"]`, `auth.py` `os.environ["SUPABASE_JWT_SECRET"]`). The
  new `config.py` holds only **non-secret tuning** and does not take over those lazy secret
  reads, so it does not duplicate them. The pool is the single `ConnectionPool` in `db.py`,
  extended in place.
- Live catalog: no DB object created (no table/function/trigger/cron) → no `pg_class` /
  `pg_proc` entry. N/A.
- Secrets: no new secret. New names are non-secret tuning (`DB_POOL_*`, `HTTP_THREADPOOL`,
  `CORS_ALLOW_ORIGINS`, `WEB_CONCURRENCY`).

## Migration plan
- **No migration.** No schema or DB-object change. Rollback is config-only (unset env vars).

## Test plan
- Unit `_base/core/config_test.py`: defaults, env overrides, CORS wildcard-vs-allowlist, CSV
  parse, invalid-int and min>max failures (acceptance criteria 1,3,4,5).
- Unit `_base/core/db_test.py`: pool carries bounded sizing + `check`, env sizing flows through
  (criteria 1,2); all prior read/write-split criteria still pass (criterion 7).
- Smoke: `import app` succeeds with no DB/secret; `/healthz` and `/readyz` mounted (criterion 6).
- Deferred (gated, needs a live DB): `/readyz` returns 503 when the DB is down and 200 when up;
  connection-count stays ≤ `replicas × workers × DB_POOL_MAX` under load.

## Open decisions touched
- O12 (security hardening); shared-core ownership (PR reviewed for all Surfaces).
