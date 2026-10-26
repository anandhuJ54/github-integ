# Surface: Listings

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four trees:

- `surface-api/listings/` — FastAPI code in `src/` (imported as `surfaces.listings`), tests in `tests/`,
  migrations in `db/migrations/` (its Alembic branch). Mounted by `surface-api/app/routes.py`.
- `surface-ui/listings/` — React 19 pages in `src/routes/`; imports `@v3/ui` (= `surface-ui/_base`).
- `contracts/listings/` — its published API (`openapi.json`), events and capabilities.
- `surface-spec/listings/` — this file, `CONTEXT.md`, and one folder per increment.

## Boundaries
- `surface-ui/listings` calls only `surface-api/listings`. Another Surface's data comes through that
  Surface's published contract, never a direct import or call.
- Another Surface imports only `surfaces.listings.exports` (`surface-api/tests/test_boundaries.py`).
- Tables it owns go in `src/models/`; their migrations in `db/migrations/`.
