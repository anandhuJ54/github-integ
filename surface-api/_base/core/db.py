"""Shared database access for all Surfaces.

One shared Supabase Postgres. Writes go through governed functions (exp_graph_upsert_nodes,
proposals, etc.) — never direct INSERT/UPDATE on exp_*, graph_*, search_* tables. RLS is the
real control boundary; this module sets the per-request RLS context from the verified JWT.
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


def _database_url() -> str:
    # Read lazily so the app imports/runs without a DB until a DB route is hit.
    # From Secret Manager / Vault, by name — never hard-coded.
    return os.environ["DATABASE_URL"]


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """A short-lived connection with dict rows. Caller owns the transaction."""
    with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
        yield conn


@contextmanager
def rls_connection(jwt_claims: dict) -> Iterator[psycopg.Connection]:
    """A connection with the RLS context set from the verified JWT.

    Sets request.jwt.claims so row-level security applies exactly as it did for the
    Supabase client. Use this for user-scoped reads/writes. Use the service role
    deliberately and separately for platform operations.
    """
    import json

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select set_config('request.jwt.claims', %s, true)",
                (json.dumps(jwt_claims),),
            )
        yield conn
