# _base (shared core) · CONTEXT

What the shared runtime owns and its current state.

## Responsibility
The common Python runtime imported by every Surface: app composition, request auth, database
access, and server-side compliance. It owns no business tables — it owns the *access path* to
the one shared Supabase Postgres and the RLS context that goes with each request.

## Key files
- `surface-api/app/main.py` — `create_app` and the dev app; `app/routes.py` mounts each Surface's router.
- `surface-api/_base/auth.py` — JWT verification → claims (authorization decided here).
- `surface-api/_base/db/session.py` — pooled connections; sets `request.jwt.claims` for RLS.
- `surface-api/_base/db/sql.py`, `db/tables.py` — SQLAlchemy Core helpers and the table catalog.
- `surface-api/_base/compliance.py` — server-side compliance checks before publish/send.
- `surface-api/_base/server_fn.py` — the `/<surface>/fn/<name>` server-function router.
- `surface-api/_base/disco/`, `integrations/` — discovery engine and integration status, used by
  several Surfaces (etl, admin, graph, nora_os, sales).

## Open questions
- Shared-runtime **ownership** is unassigned (root `AGENTS.md` §5). Shared-core PRs need
  all-Surface review until an owner exists.
- Connection scaling: single DB, fresh connection per call, no pool
  (see increment `db-read-write-split`).
