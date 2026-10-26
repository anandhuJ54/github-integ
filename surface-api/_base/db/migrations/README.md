# Migrations: shared core (`_base`)

Alembic branch `_base` (`surface-api/alembic.ini`). Revisions here are hand-written SQL in
`upgrade()` (`op.execute("""...""")`), follow the security baseline in root `AGENTS.md` §3, and declare
`depends_on` for any table another branch creates. Its first revision, `866c5f655041_base_baseline.py`, is the root every Surface branch depends on: it checks that the closed SQL stream (`surface-api/migrations/`) is fully applied and changes nothing else.

From `surface-api/`:
- first revision: the `_base` branch already exists
- next ones: `uv run alembic revision -m "<what>" --head=_base@head`
- review: `uv run alembic upgrade heads --sql`; apply only as the human-approved step (AGENTS.md §4)

Never edit a revision once it has been applied anywhere shared; add a new one.
