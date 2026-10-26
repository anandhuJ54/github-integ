# Surface: Online Search

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/search/` — FastAPI code in `src/` (imported as `surfaces.search`, grouped by resource), tests in
  `tests/`, migrations in `db/migrations/` (its Alembic branch); mounted by `surface-api/app/routes.py`.
- `surface-ui/search/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/search/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/search/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/search` calls only this Surface's `surface-api/search` (client generated from `contracts/search`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports: `from _base... import`, `from surfaces.search... import`. Another Surface is imported only
  through `surfaces.<other>.exports` (`surface-api/tests/test_boundaries.py`); `_base` is shared.
- Tables owned here go in `src/models/` (empty until moved from `_base/db/tables.py`); their migrations
  in `db/migrations/`. One shared database; the older `surface-api/migrations/` stream is closed (root `AGENTS.md` §4).
