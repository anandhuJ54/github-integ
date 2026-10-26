# Surface: Skills

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/skills/`   — FastAPI routers (top-level Python package `skills`), mounted by `surface-api/app.py`.
- `surface-ui/skills/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/skills/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/skills/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/skills` calls only this Surface's `surface-api/skills` (client generated from `contracts/skills`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports are internal and top-level (`from _base... import`, `from skills... import`); `_base` is shared.
- Tables owned logically here; physical migrations are common in `surface-api/migrations` (one DB, one history).
