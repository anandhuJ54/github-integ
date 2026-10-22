# _base (shared core) · CONTEXT

What the shared runtime owns and its current state.

## Responsibility
The common Python runtime imported by every Surface: app composition, request auth, database
access, and server-side compliance. It owns no business tables — it owns the *access path* to
the one shared Supabase Postgres and the RLS context that goes with each request.

## Key files
- `surface-api/_base/app_factory.py` — `create_app`, mounts each Surface's router.
- `surface-api/_base/core/auth.py` — JWT verification → claims (authorization decided here).
- `surface-api/_base/core/db.py` — connection helpers; sets `request.jwt.claims` for RLS.
- `surface-api/_base/core/compliance.py` — server-side compliance checks before publish/send.

## Open questions
- Shared-runtime **ownership** is unassigned (root `AGENTS.md` §5). Shared-core PRs need
  all-Surface review until an owner exists.
- Connection scaling: single DB, fresh connection per call, no pool
  (see increment `db-read-write-split`).
