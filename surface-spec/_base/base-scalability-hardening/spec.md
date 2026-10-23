# Spec: Base-level scalability hardening

<!-- Stage: Design. Shared template — do not remove sections. -->

Links: [intent](./intent.md)

## Behaviour
The model decides nothing here — everything is deterministic configuration and routing.

1. Configuration (`_base/core/config.py`, deterministic): a single `get_settings()` reads and
   validates non-secret tuning values from the environment, with safe defaults, cached for the
   process. Secrets (`DATABASE_URL`, `SUPABASE_JWT_SECRET`) stay lazy in their own modules so
   the app still imports/runs without them.
   - `DB_POOL_MIN` (default 1), `DB_POOL_MAX` (default 10), `DB_POOL_TIMEOUT` (default 10s),
     `DB_POOL_MAX_IDLE` (default 300s).
   - `HTTP_THREADPOOL` (default 0 → derive from `DB_POOL_MAX`).
   - `CORS_ALLOW_ORIGINS` (CSV, default `*`).
   - Invalid values raise at boot (`get_settings()`), not mid-request.
2. Pool sizing (`_base/core/db.py`, deterministic): each per-URL `ConnectionPool` is created
   with `min_size`/`max_size`/`timeout`/`max_idle` from settings and
   `check=ConnectionPool.check_connection` so a stale leased connection is detected. Pool
   identity/reuse and RLS wiring are unchanged.
3. Threadpool alignment (`_base/app_factory.py` lifespan, deterministic): on startup the
   Starlette/AnyIO default thread limiter is pinned to `effective_threadpool()`
   (= `DB_POOL_MAX` unless `HTTP_THREADPOOL` is set), so concurrent sync requests touching the
   DB on a worker cannot exceed its leasable connections.
4. CORS (deterministic): `effective_cors()` returns `(["*"], False)` for the wildcard default
   (the only spec-valid wildcard form) and `(origins, True)` for an explicit allowlist.
5. Health vs readiness (deterministic): `/healthz` stays static liveness (no DB). `/readyz`
   leases a read connection and runs `select 1`; 200 when it succeeds, 503 otherwise.
6. Container (Dockerfile): runs `uvicorn --workers ${WEB_CONCURRENCY:-2}`; `psycopg-pool` added
   to the explicit dependency list.

## Acceptance criteria
1. A created pool carries `min_size`/`max_size`/`timeout`/`max_idle` from settings and a
   `check` callable (asserted via the pool kwargs), defaulting to 1/10/10s.
2. `DB_POOL_MIN`/`DB_POOL_MAX`/`DB_POOL_TIMEOUT` env values flow into the created pool.
3. `effective_threadpool()` returns `DB_POOL_MAX` when `HTTP_THREADPOOL` is unset, else the
   explicit value.
4. `effective_cors()` disables credentials for `["*"]` and enables them for an explicit
   allowlist; `CORS_ALLOW_ORIGINS` is parsed from CSV.
5. An invalid integer env (e.g. `DB_POOL_MAX=not-a-number`) and `min > max` raise `ValueError`
   at `get_settings()` / `validate()`.
6. The app still imports with no DB/secret present; `/healthz` and `/readyz` are both mounted.
7. Existing read/write-split behaviour (routing, RLS, pool reuse, legacy aliases) is unchanged
   — the prior `db_test.py` criteria still pass.

## Data
- Tables / schemas: none. Connection/runtime configuration only.
- New objects: `_base/core/config.py` (new module). No DB object, table, function or role —
  `extend-never-duplicate` recorded in plan.md (no existing config module; env reads were
  inline in `db.py`/`auth.py`).
- Migration intent: none.
- Provenance / trust tier: N/A.

## NORA-ready contract
| Part | Definition |
|---|---|
| State read | N/A — infra configuration; no new typed read surface |
| Capabilities | N/A — no new capability |
| Events | None |
| Entitlement | N/A |
| Explanation templates | N/A |
| Value loop | Operational: bounded connections + readiness → stable scaling |

## Security / RLS
No change to the write boundary or RLS. CORS becomes stricter-by-default in prod (credentials
only with an explicit origin allowlist). No new grants, no `USING (true)`.

## Rollback
Config-only: unset the env vars to return to defaults; set `WEB_CONCURRENCY=1` for a single
worker. No schema or data change to reverse.
