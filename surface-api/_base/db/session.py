"""Shared database access for all Surfaces.

One shared Supabase Postgres, reached through two roles:

- the **primary** (`DATABASE_URL`) takes every write, and reads that must reflect a
  just-made write (read-after-write);
- an optional **read replica** (`DATABASE_READ_URL`) takes high-volume reads. If it is
  unset (dev / single-node) reads fall back to the primary, so behaviour is unchanged.

Callers choose per operation: `write_connection()` → primary, `read_connection()` → replica,
`read_connection(fresh=True)` → primary. A pooled connection is leased from the pool for the
chosen URL; pools are created lazily so the app imports/runs without a DB until a DB route
is hit.

Writes still go through governed functions (exp_graph_upsert_nodes, proposals, …) — never
direct INSERT/UPDATE on exp_*, graph_*, search_* tables. RLS is the real control boundary;
this module sets the per-request RLS context from the verified JWT, on whichever node the
lease lands.
"""
from __future__ import annotations

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from _base.config import get_settings

# One pool per distinct URL, created on first use and reused thereafter.
_pools: dict[str, ConnectionPool] = {}


def _primary_url() -> str:
    # Write / primary. From Secret Manager / Vault, by name — never hard-coded.
    # Read lazily so the app imports/runs without a DB until a DB route is hit.
    return os.environ["DATABASE_URL"]


def _replica_url() -> str:
    # Read replica. Falls back to the primary when no replica is configured.
    return os.environ.get("DATABASE_READ_URL") or _primary_url()


def _pool(url: str) -> ConnectionPool:
    pool = _pools.get(url)
    if pool is None:
        # Bounded, per-worker pool. Total DB connections = replicas × workers × max_size, so
        # these must stay under the database's connection cap (see _base.config). check=
        # validates a leased connection is still live — important behind the Supabase
        # transaction pooler and against a replica that may recycle sockets.
        s = get_settings()
        pool = ConnectionPool(
            url,
            min_size=s.db_pool_min,
            max_size=s.db_pool_max,
            timeout=s.db_pool_timeout,
            max_idle=s.db_pool_max_idle,
            check=ConnectionPool.check_connection,
            kwargs={"row_factory": dict_row},
            open=True,
        )
        _pools[url] = pool
    return pool


def close_pools() -> None:
    """Close every open pool and forget it. Call on app shutdown.

    Idempotent and safe to call when no pool was ever opened (the app may never hit a DB
    route). A closed pool is dropped so a later lease lazily opens a fresh one.
    """
    while _pools:
        _url, pool = _pools.popitem()
        pool.close()


def _apply_rls(conn: psycopg.Connection, jwt_claims: dict) -> None:
    """Set request.jwt.claims so row-level security applies to this transaction.

    set_config(..., is_local=true) is transaction-local and is permitted on a hot-standby
    replica, so user-scoped reads enforce the same RLS there as on the primary.
    """
    with conn.cursor() as cur:
        cur.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps(jwt_claims),),
        )


@contextmanager
def _lease(url: str, jwt_claims: dict | None) -> Iterator[psycopg.Connection]:
    """Lease a pooled connection for `url`, optionally with the RLS context set.

    The pool's context manager owns the transaction: commit on clean exit, rollback on error.
    """
    with _pool(url).connection() as conn:
        if jwt_claims is not None:
            _apply_rls(conn, jwt_claims)
        yield conn


@contextmanager
def read_connection(
    jwt_claims: dict | None = None, *, fresh: bool = False
) -> Iterator[psycopg.Connection]:
    """A read connection. Goes to the replica unless `fresh=True` (read-after-write → primary).

    Pass `jwt_claims` for user-scoped reads so RLS applies; omit for service/platform reads.
    """
    url = _primary_url() if fresh else _replica_url()
    with _lease(url, jwt_claims) as conn:
        yield conn


@contextmanager
def write_connection(jwt_claims: dict | None = None) -> Iterator[psycopg.Connection]:
    """A write connection — always the primary.

    Writes still go through governed functions / the service role; this only picks the node.
    """
    with _lease(_primary_url(), jwt_claims) as conn:
        yield conn


# --- backward-compatible aliases ----------------------------------------
# Existing callers (migrate.py, compliance.py) used a single primary DB. Keep those names and
# their semantics (primary, caller owns the transaction) so nothing breaks; new code should
# use read_connection / write_connection to opt into the replica.


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """A short-lived primary connection with dict rows. Caller owns the transaction."""
    with _lease(_primary_url(), None) as conn:
        yield conn


@contextmanager
def rls_connection(jwt_claims: dict) -> Iterator[psycopg.Connection]:
    """A primary connection with the RLS context set from the verified JWT.

    Use the read replica deliberately via read_connection() for high-volume reads.
    """
    with _lease(_primary_url(), jwt_claims) as conn:
        yield conn


# --- role-scoped connections (supabase-js parity) ---------------------------
# The migrated server functions used three Supabase clients. Each maps to a Postgres role:
#   publishable/anon client      -> role `anon`          (RLS as a signed-out visitor)
#   user client (bearer JWT)     -> role `authenticated` (RLS as that user)
#   supabaseAdmin (service key)  -> role `service_role`  (bypasses RLS; server writes only)
# The claims and the role are transaction-local (set_config(..., true) is `set local`), so they
# end with the lease. Both are set in one statement, one round trip, as PostgREST does.

_ROLES = frozenset({"anon", "authenticated", "service_role"})


@contextmanager
def role_connection(
    role: str, jwt_claims: dict | None = None, *, write: bool = False, fresh: bool = False
) -> Iterator[psycopg.Connection]:
    """A connection acting as a Supabase API role. Reads use the replica unless write/fresh."""
    if role not in _ROLES:
        raise ValueError(f"unknown role {role!r}")
    if role == "authenticated" and jwt_claims is None:
        raise ValueError("authenticated role needs the verified JWT claims")
    url = _primary_url() if (write or fresh) else _replica_url()
    claims = jwt_claims if jwt_claims is not None else {"role": role}
    with _lease(url, None) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "select set_config('request.jwt.claims', %s, true), set_config('role', %s, true)",
                (json.dumps(claims), role),  # role is from the fixed allowlist above
            )
        yield conn
