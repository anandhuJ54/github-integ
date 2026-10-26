# Surface: Reports

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four trees:

- `surface-api/reports/` — FastAPI code in `src/` (imported as `surfaces.reports`), tests in `tests/`,
  migrations in `db/migrations/` (its Alembic branch). Mounted by `surface-api/app/routes.py`.
- `surface-ui/reports/` — React 19 pages in `src/routes/`; imports `@v3/ui` (= `surface-ui/_base`).
- `contracts/reports/` — its published API (`openapi.json`), events and capabilities.
- `surface-spec/reports/` — this file, `CONTEXT.md`, and one folder per increment.

## Boundaries
- `surface-ui/reports` calls only `surface-api/reports`. Another Surface's data comes through that
  Surface's published contract, never a direct import or call.
- Another Surface imports only `surfaces.reports.exports` (`surface-api/tests/test_boundaries.py`).
- Tables it owns go in `src/models/`; their migrations in `db/migrations/`.
