# Surface: NORA / OS kernel

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `api/nora_os/`   — FastAPI routers (Python package `api.nora_os`), mounted by `api/app.py`.
- `ui/nora-os/`       — React 19 UI; imports `@v3/ui` (= `ui/base`).
- `contracts/nora-os/` — versioned events + capabilities (the seam both `api` and `ui` consume,
  and the interface other Surfaces depend on).
- `spec/nora-os/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `ui/nora-os` calls only this Surface's `api/nora_os` (client generated from `contracts/nora-os`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Tables owned logically here; physical migrations are common in `api/migrations` (one DB, one history).
