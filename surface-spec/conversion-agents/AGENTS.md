# Surface: Conversion Agents

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `api/conversion_agents/`   — FastAPI routers (Python package `api.conversion_agents`), mounted by `api/app.py`.
- `ui/conversion-agents/`       — React 19 UI; imports `@v3/ui` (= `ui/base`).
- `contracts/conversion-agents/` — versioned events + capabilities (the seam both `api` and `ui` consume,
  and the interface other Surfaces depend on).
- `spec/conversion-agents/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `ui/conversion-agents` calls only this Surface's `api/conversion_agents` (client generated from `contracts/conversion-agents`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Tables owned logically here; physical migrations are common in `api/migrations` (one DB, one history).
