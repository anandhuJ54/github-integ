# Surface: Graph

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/graph/` — FastAPI code in `src/` (imported as `surfaces.graph`, grouped by resource), tests in
  `tests/`, migrations in `db/migrations/` (its Alembic branch); mounted by `surface-api/app/routes.py`.
- `surface-ui/graph/`       — React 19 UI; imports `@v3/shared` (= `surface-ui/shared`).
- `contracts/graph/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/graph/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/graph` calls only this Surface's `surface-api/graph` (client generated from `contracts/graph`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports: `from _base... import`, `from surfaces.graph... import`. Another Surface is imported only
  through `surfaces.<other>.exports` (`surface-api/tests/test_boundaries.py`); `_base` is shared.
- Tables owned here live in this Surface's own Postgres schema (named after the `surface-api` package)
  and go in `src/models/` (most are still in `_base/db/tables.py`, in `public`, until moved); their
  migrations in `db/migrations/`.
- Only this Surface reads and writes the tables in its schema. Another Surface reads or writes them
  only through this Surface's `exports.py` (plain shapes, never ORM classes or tables; foreign keys
  through the exported `*_ID_FK` constants). Root `AGENTS.md` §2; `surface-api/tests/test_boundaries.py`. One shared database; the older `surface-api/migrations/` stream is closed (root `AGENTS.md` §4).
