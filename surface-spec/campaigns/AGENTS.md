# Surface: Campaigns

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `api/campaigns/`   — FastAPI routers (Python package `api.campaigns`), mounted by `api/app.py`.
- `ui/campaigns/`       — React 19 UI; imports `@v3/ui` (= `ui/base`).
- `contracts/campaigns/` — versioned events + capabilities (the seam both `api` and `ui` consume,
  and the interface other Surfaces depend on).
- `spec/campaigns/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `ui/campaigns` calls only this Surface's `api/campaigns` (client generated from `contracts/campaigns`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Tables owned logically here; physical migrations are common in `api/migrations` (one DB, one history).
