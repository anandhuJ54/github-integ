# Surface: Marketing Engine

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/marketing/`   — FastAPI routers (top-level Python package `marketing`), mounted by `surface-api/app.py`.
- `surface-ui/marketing/`       — React 19 UI; imports `@v3/ui` (= `surface-ui/_base`).
- `contracts/marketing/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/marketing/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/marketing` calls only this Surface's `surface-api/marketing` (client generated from `contracts/marketing`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports are internal and top-level (`from _base... import`, `from marketing... import`); `_base` is shared.
- Tables owned logically here; physical migrations are common in `surface-api/migrations` (one DB, one history).
