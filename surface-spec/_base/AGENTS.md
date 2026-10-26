# Shared core: _base

Not a numbered Surface — this is the **shared runtime** every Surface imports
(`surface-api/_base/`: auth, db access, compliance; the app shell is `surface-api/app/`). Rules
here are stricter-or-equal to the root `AGENTS.md`; nothing here loosens it.

- `surface-api/_base/`  — shared Python runtime (`auth.py`, `config.py`, `server_fn.py`,
  `compliance.py`, `db/session.py`, `db/sql.py`, `db/tables.py`, `disco/`, `integrations/`).
  Imported by every Surface's `surface-api/<surface>/src/`. It never imports `app` or a Surface
  (`surface-api/tests/test_boundaries.py`).
- `surface-api/app/`   — app shell (`main.py`, `routes.py`, `surfaces.py`, `contracts.py`).
- `surface-spec/_base/` — this file, `CONTEXT.md`, and one folder per shared-core increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- A change under `_base` affects **all** Surfaces. Per root `AGENTS.md` §2 + §4 it needs a PR
  reviewed for every Surface, and schema/security/identity changes need a second approval.
- Preserve existing public names (e.g. `connection`, `rls_connection`) or migrate every caller
  in the same PR — a Surface must never break silently.
- The write boundary is fixed here: writes go through governed functions + RLS/service role,
  never raw INSERT/UPDATE on `exp_*` / `graph_*` / `search_*`.
