# Surface: Sales Engine / Growth Hub

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/sales/`   — FastAPI routers (top-level Python package `sales`), mounted by `surface-api/app.py`.
- `surface-ui/sales/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/sales/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/sales/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/sales` calls only this Surface's `surface-api/sales` (client generated from `contracts/sales`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports are internal and top-level (`from _base... import`, `from sales... import`); `_base` is shared.
- Tables owned logically here; physical migrations are common in `surface-api/migrations` (one DB, one history).
