# Surface: SRP — Locations & Professionals

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `api/srp/`   — FastAPI routers (Python package `api.srp`), mounted by `api/app.py`.
- `ui/srp/`       — React 19 UI; imports `@v3/ui` (= `ui/base`).
- `contracts/srp/` — versioned events + capabilities (the seam both `api` and `ui` consume,
  and the interface other Surfaces depend on).
- `spec/srp/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `ui/srp` calls only this Surface's `api/srp` (client generated from `contracts/srp`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Tables owned logically here; physical migrations are common in `api/migrations` (one DB, one history).
