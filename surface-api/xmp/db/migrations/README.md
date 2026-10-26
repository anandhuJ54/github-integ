# Migrations: the `xmp` Surface

Alembic branch `xmp` (`surface-api/alembic.ini`). Revisions here are hand-written SQL in
`upgrade()` (`op.execute("""...""")`), create tables only in this Surface's schema `xmp`
(`xmp.<table>`; the first revision runs `CREATE SCHEMA IF NOT EXISTS xmp`), follow the
security baseline in root `AGENTS.md` §3, and declare `depends_on` for any table another branch
creates. First revision: the xmp tables (increment `surface-spec/campaigns/campaigns-xmp-tables`), not applied anywhere yet.

From `surface-api/`:
- first revision: `uv run alembic revision -m "<what>" --head=base --branch-label=xmp --version-path=xmp/db/migrations --depends-on=866c5f655041`
- next ones: `uv run alembic revision -m "<what>" --head=xmp@head`
- review: `uv run alembic upgrade heads --sql`; apply only as the human-approved step (AGENTS.md §4)

Never edit a revision once it has been applied anywhere shared; add a new one.
