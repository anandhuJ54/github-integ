# Surface: Ops

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/ops/`   — FastAPI routers (top-level Python package `ops`), mounted by `surface-api/app.py`.
- `surface-ui/ops/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/ops/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/ops/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/ops` calls only this Surface's `surface-api/ops` (client generated from `contracts/ops`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports are internal and top-level (`from _base... import`, `from ops... import`); `_base` is shared.
- Tables owned logically here; physical migrations are common in `surface-api/migrations` (one DB, one history).
