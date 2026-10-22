# Surface: Online Search

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `api/search/`   — FastAPI routers (Python package `api.search`), mounted by `api/app.py`.
- `ui/search/`       — React 19 UI; imports `@v3/ui` (= `ui/base`).
- `contracts/search/` — versioned events + capabilities (the seam both `api` and `ui` consume,
  and the interface other Surfaces depend on).
- `spec/search/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `ui/search` calls only this Surface's `api/search` (client generated from `contracts/search`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Tables owned logically here; physical migrations are common in `api/migrations` (one DB, one history).
