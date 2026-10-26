# Surface: SRP — Locations & Professionals

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/srp/`   — FastAPI routers (top-level Python package `srp`), mounted by `surface-api/app.py`.
- `surface-ui/srp/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/srp/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/srp/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/srp` calls only this Surface's `surface-api/srp` (client generated from `contracts/srp`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports are internal and top-level (`from _base... import`, `from srp... import`); `_base` is shared.
- Tables owned logically here; physical migrations are common in `surface-api/migrations` (one DB, one history).
