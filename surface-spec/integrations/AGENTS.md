# Surface: Integrations

Local constitution. Stricter-or-equal to the root `AGENTS.md`. This Surface spans four trees:

- `surface-api/integrations/` — FastAPI code in `src/` (imported as `surfaces.integrations`), tests in `tests/`,
  migrations in `db/migrations/` (its Alembic branch). Mounted by `surface-api/app/routes.py`.
- `surface-ui/integrations/` — React 19 pages in `src/routes/`; imports only `@v3/shared`, `@v3/state` and `@v3/theme`
  (`surface-ui/state/boundaries.test.ts`).
- `contracts/integrations/` — its published API (`openapi.json`), events and capabilities.
- `surface-spec/integrations/` — this file, `CONTEXT.md`, and one folder per increment.

## Boundaries
- `surface-ui/integrations` calls only `surface-api/integrations`. Another Surface's data comes through that
  Surface's published contract, never a direct import or call.
- Another Surface imports only `surfaces.integrations.exports` (`surface-api/tests/test_boundaries.py`).
- Tables it owns go in `src/models/`; their migrations in `db/migrations/`.
