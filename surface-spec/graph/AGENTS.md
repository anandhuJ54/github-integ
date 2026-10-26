# Surface: Graph

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/graph/`   — FastAPI routers (top-level Python package `graph`), mounted by `surface-api/app.py`.
- `surface-ui/graph/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/graph/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/graph/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/graph` calls only this Surface's `surface-api/graph` (client generated from `contracts/graph`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports are internal and top-level (`from _base... import`, `from graph... import`); `_base` is shared.
- Tables owned logically here; physical migrations are common in `surface-api/migrations` (one DB, one history).
