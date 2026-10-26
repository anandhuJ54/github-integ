# Migrations: the `campaigns` Surface

Alembic branch `campaigns` (`surface-api/alembic.ini`). Revisions here are hand-written SQL in
`upgrade()` (`op.execute("""...""")`), create tables only in this Surface's schema `campaigns`
(`campaigns.<table>`; the first revision runs `CREATE SCHEMA IF NOT EXISTS campaigns`), follow the
security baseline in root `AGENTS.md` §3, and declare `depends_on` for any table another branch
creates. First revision: the campaigns tables (increment `surface-spec/campaigns/campaigns-xmp-tables`), not applied anywhere yet.

From `surface-api/`:
- first revision: `uv run alembic revision -m "<what>" --head=base --branch-label=campaigns --version-path=campaigns/db/migrations --depends-on=866c5f655041`
- next ones: `uv run alembic revision -m "<what>" --head=campaigns@head`
- review: `uv run alembic upgrade heads --sql`; apply only as the human-approved step (AGENTS.md §4)

Never edit a revision once it has been applied anywhere shared; add a new one.
