# Surface: SRP — Locations & Professionals

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four
trees (polyglot: React + Python, plus its contract and its specs):

- `surface-api/srp/` — FastAPI code in `src/` (imported as `surfaces.srp`, grouped by resource), tests in
  `tests/`, migrations in `db/migrations/` (its Alembic branch); mounted by `surface-api/app/routes.py`.
- `surface-ui/srp/`       — React 19 UI; imports `@v3/ui` (= `surface-ui/_base`).
- `contracts/srp/` — versioned events + capabilities (the seam both `surface-api` and `surface-ui` consume,
  and the interface other Surfaces depend on).
- `surface-spec/srp/`     — this file, `CONTEXT.md`, and one folder per increment
  (`<increment>/intent.md spec.md plan.md evidence.md`).

## Boundaries
- `surface-ui/srp` calls only this Surface's `surface-api/srp` (client generated from `contracts/srp`).
  Cross-Surface reaction goes through the events/capabilities in `contracts/`, never a direct call.
- Imports: `from _base... import`, `from surfaces.srp... import`. Another Surface is imported only
  through `surfaces.<other>.exports` (`surface-api/tests/test_boundaries.py`); `_base` is shared.
- Tables owned here live in this Surface's own Postgres schema (named after the `surface-api` package)
  and go in `src/models/` (most are still in `_base/db/tables.py`, in `public`, until moved); their
  migrations in `db/migrations/`.
- Only this Surface reads and writes the tables in its schema. Another Surface reads or writes them
  only through this Surface's `exports.py` (plain shapes, never ORM classes or tables; foreign keys
  through the exported `*_ID_FK` constants). Root `AGENTS.md` §2; `surface-api/tests/test_boundaries.py`. One shared database; the older `surface-api/migrations/` stream is closed (root `AGENTS.md` §4).
