"""Alembic environment shared by every Surface branch and `_base` (see alembic.ini).

Revisions are written by hand: SQL through `op.execute(...)` (functions, RLS, policies, grants) or
plain `op` operations. There is no autogenerate (`target_metadata = None`): every table is in the
one `public` schema, and Alembic can't see functions, policies or grants anyway.

Connects to the primary (`DATABASE_URL`), like migrate.py. `alembic upgrade heads --sql` prints
the SQL without connecting, for review before the human-approved apply.
"""
from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def _url() -> str:
    """DATABASE_URL as a SQLAlchemy URL on the psycopg 3 driver the app already uses."""
    url = config.get_main_option("sqlalchemy.url") or os.environ["DATABASE_URL"]
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def run_migrations_offline() -> None:
    # `--sql` only prints SQL, so it needs no database: no DATABASE_URL is fine here.
    url = _url() if os.environ.get("DATABASE_URL") else "postgresql+psycopg://"
    context.configure(url=url, literal_binds=True, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
