# Evidence: Base-level scalability hardening

<!-- Stage: Test. Required before merge. State what was tested, how, and what remains unverified. -->

Links: [intent](./intent.md) · [spec](./spec.md) · [plan](./plan.md)

## What changed
- `surface-api/_base/core/config.py` (new) — validated, env-driven `Settings` + `get_settings()`
  (cached); `effective_threadpool()` and `effective_cors()` helpers.
- `surface-api/_base/core/db.py` — pool now created with `min_size`/`max_size`/`timeout`/
  `max_idle` from settings and `check=ConnectionPool.check_connection`. Routing, RLS, reuse and
  legacy aliases unchanged.
- `surface-api/_base/app_factory.py` — lifespan pins the AnyIO threadpool to the DB pool size;
  CORS origins/credentials come from settings (valid wildcard handling); added `/readyz`
  readiness probe (DB `select 1`, 503 on failure); `/healthz` kept as static liveness.
- `Dockerfile` — `CMD` runs `uvicorn --workers ${WEB_CONCURRENCY:-2}`; added `psycopg-pool` to
  the explicit dependency list (was missing; the image could not import the db layer).

## Acceptance criteria results
| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Pool carries bounded sizing + `check`, defaults 1/10/10s | PASS | `db_test.py::test_pool_is_lazy_and_reused_per_url` |
| 2 | Env `DB_POOL_*` flow into the pool | PASS | `db_test.py::test_pool_sizing_reads_env` |
| 3 | `effective_threadpool()` derives from `DB_POOL_MAX` / honours override | PASS | `config_test.py::test_defaults_are_safe`, `::test_env_overrides` |
| 4 | CORS wildcard disables credentials; allowlist enables; CSV parsed | PASS | `config_test.py::test_cors_*` |
| 5 | Invalid int / min>max raise at boot | PASS | `config_test.py::test_bad_integer_fails_loudly`, `::test_validate_rejects_min_above_max` |
| 6 | App imports with no DB/secret; `/healthz` + `/readyz` mounted | PASS | `python -c "import app"` lists both meta routes |
| 7 | Prior read/write-split behaviour unchanged | PASS | existing `db_test.py` criteria still pass |

## How it was tested
- `uv run pytest _base/ -q` → **17 passed**.
- `uv run ruff check _base/ app.py` → clean.
- `uv run python -c "import app"` → imports with no DB/secret; `/healthz` and `/readyz` present.

## What remains unverified
- **Live DB behaviour** (gated, needs a real primary/replica): `/readyz` returning 503 while
  the DB is unreachable and 200 once leasable; `check_connection` recycling a dead socket;
  actual connection-count staying ≤ `replicas × workers × DB_POOL_MAX` under load.
- **Multi-worker runtime**: `WEB_CONCURRENCY` worker fan-out and per-worker pool isolation were
  not exercised in a container here (no container build in this environment).
- **CORS in a browser**: the credentials/allowlist behaviour is unit-verified, not checked
  against a real cross-origin browser request.
- **`.env.example`** could not be edited in this environment (env-file guard); the new env vars
  (`DB_POOL_MIN/MAX/TIMEOUT/MAX_IDLE`, `HTTP_THREADPOOL`, `CORS_ALLOW_ORIGINS`,
  `WEB_CONCURRENCY`) still need documenting there.
