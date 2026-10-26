# Surface: XMP

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/xmp/`   — FastAPI routers (top-level Python package `xmp`), mounted by `surface-api/app.py`.
- `surface-ui/xmp/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/xmp/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/xmp/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/xmp` calls only this Surface's `surface-api/xmp` (client generated from `contracts/xmp`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports are internal and top-level (`from _base... import`, `from xmp... import`); `_base` is shared.
- Tables owned logically here; physical migrations are common in `surface-api/migrations` (one DB, one history).
