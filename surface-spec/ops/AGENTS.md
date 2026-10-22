# Surface: Ops

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `api/ops/`   — FastAPI routers (Python package `api.ops`), mounted by `api/app.py`.
- `ui/ops/`       — React 19 UI; imports `@v3/ui` (= `ui/base`).
- `contracts/ops/` — versioned events + capabilities (the seam both `api` and `ui` consume,
  and the interface other Surfaces depend on).
- `spec/ops/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `ui/ops` calls only this Surface's `api/ops` (client generated from `contracts/ops`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Tables owned logically here; physical migrations are common in `api/migrations` (one DB, one history).
