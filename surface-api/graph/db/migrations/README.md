# Migrations: the `graph` Surface

Alembic branch `graph` (`surface-api/alembic.ini`). Revisions here are hand-written SQL in
`upgrade()` (`op.execute("""...""")`), follow the security baseline in root `AGENTS.md` §3, and declare
`depends_on` for any table another branch creates. Empty until this Surface writes its first migration.

From `surface-api/`:
- first revision: `uv run alembic revision -m "<what>" --head=base --branch-label=graph --version-path=graph/db/migrations --depends-on=866c5f655041`
- next ones: `uv run alembic revision -m "<what>" --head=graph@head`
- review: `uv run alembic upgrade heads --sql`; apply only as the human-approved step (AGENTS.md §4)

Never edit a revision once it has been applied anywhere shared; add a new one.
