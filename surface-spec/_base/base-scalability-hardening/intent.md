# Intent: Base-level scalability hardening (pool bounds, workers, readiness, CORS, config)

<!-- Stage: Define. Shared template — do not remove sections. Add Surface sections from template-additions.md. -->

| Field | Value |
|---|---|
| Surface | _base (shared core) |
| Increment id | _base/base-scalability-hardening |
| Status | draft |
| Date | 2026-10-23 |

## Problem
The read/write split added bounded horizontal read headroom, but the base runtime still has
scaling gaps that only bite under load / multi-process deploys:
- The connection pool is created with **library defaults** — no `min_size` / `max_size` /
  `timeout` / `max_idle`. With multiple workers and replicas, total connections to Postgres
  are unbounded by us and will exhaust Supabase's low direct-connection cap.
- Sync routes run in Starlette's threadpool (default 40), unrelated to the pool size, so
  threads can pile up waiting on a smaller pool, or a larger pool can exhaust the DB.
- The container runs a **single** uvicorn process with no worker knob.
- There is only a static `/healthz` liveness check; no readiness probe, so an orchestrator
  cannot tell when a worker can actually reach the DB.
- CORS is `allow_origins=["*"]` with `allow_credentials=True` — a combination browsers reject,
  and not environment-driven.
- Tuning values are read ad-hoc via `os.environ[...]`, failing mid-request rather than at boot.
- The Dockerfile's explicit dependency list omitted `psycopg-pool`, so the image could not
  import the shared db layer at all.

## Outcome
The base runtime is tunable per environment and bounded by construction: pool size, HTTP
threadpool, worker count and CORS origins all come from validated configuration. Total DB
connections stay under the database cap, a worker reports readiness only when it can reach the
DB, and the container can run multiple workers. Behaviour is unchanged when no env overrides
are set (safe defaults).

## Signals and sources
| Source | Label | What it shows |
|---|---|---|
| `surface-api/_base/core/db.py:46-51` (pre-change) | Repo | `ConnectionPool(url, kwargs=..., open=True)` — no size/timeout bounds |
| `surface-api/_base/app_factory.py:29-35` (pre-change) | Repo | `allow_origins=["*"]` + `allow_credentials=True` (invalid combo) |
| `Dockerfile:31` (pre-change) | Repo | Single `uvicorn app:app`, no `--workers` |
| `Dockerfile:19-24` (pre-change) | Repo | Explicit pip list missing `psycopg-pool` |
| Supabase direct-connection cap is low; prefer the :6543 transaction pooler | Target | Why pools must be bounded and connection math explicit |

## Success measure
After rollout: under the same load, total Postgres connections ≤ `replicas × workers ×
DB_POOL_MAX` and stay under the DB cap; `/readyz` returns 503 while the DB is unreachable and
200 once leasable; CORS rejects non-allowlisted origins in prod. Confirmed in Observe via
connection-count and readiness metrics.

## Open decisions touched
- **O12 (security hardening)** — adds env-driven CORS allowlist and pool/worker tuning knobs.
- **Shared-core ownership** — `_base/` is shared runtime (root AGENTS.md §2); needs a PR
  reviewed for all Surfaces, not one Surface alone.

## Out of scope
- Rate limiting, request-ID/structured logging, OpenTelemetry (follow-up hardening).
- Replica load-balancing across multiple read URLs (single replica URL only).
- Moving JWT verification to asymmetric keys / JWKS (noted, not done here).
- Autoscaling policy / orchestrator manifests (deploy concern, not base code).
