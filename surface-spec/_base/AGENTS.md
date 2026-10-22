# Shared core: _base

Not a numbered Surface — this is the **shared runtime** every Surface imports
(`surface-api/_base/`: app factory, auth, db access, compliance). Rules here are
stricter-or-equal to the root `AGENTS.md`; nothing here loosens it.

- `surface-api/_base/`  — shared Python runtime (`app_factory.py`, `core/auth.py`,
  `core/db.py`, `core/compliance.py`). Imported by every Surface's `surface-api/<surface>/`.
- `surface-spec/_base/` — this file, `CONTEXT.md`, and one folder per shared-core increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- A change under `_base` affects **all** Surfaces. Per root `AGENTS.md` §2 + §4 it needs a PR
  reviewed for every Surface, and schema/security/identity changes need a second approval.
- Preserve existing public names (e.g. `connection`, `rls_connection`) or migrate every caller
  in the same PR — a Surface must never break silently.
- The write boundary is fixed here: writes go through governed functions + RLS/service role,
  never raw INSERT/UPDATE on `exp_*` / `graph_*` / `search_*`.
