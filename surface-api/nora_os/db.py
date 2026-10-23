"""supabase-js client stand-in for the NORA executor.

The TypeScript passed Supabase clients around (`context.supabase` = the user's RLS client,
`supabaseAdmin` = service role). Each supabase-js call was its own HTTP request, so its own
transaction on the primary: a failed capability RPC never rolled back the exp_skill_run row
written after it, and a claim step that failed half-way kept the steps before it. `Db` keeps
those semantics: every call leases its own role-scoped connection (primary, `fresh` reads) and
commits on its own.

Rows come back JSON-shaped (uuid → str, timestamps → ISO strings, numeric → int/float), as
PostgREST returned them, so comparisons and response bodies match the TS byte for byte.
"""
from __future__ import annotations

import datetime as _dt
import decimal
import uuid
from typing import Any

from psycopg.types.json import Jsonb

from _base.core import db as _core_db


class DbError(RuntimeError):
    """A failed query, carrying the message the TS built (`${what}: ${error.message}`)."""


def jsonish(v: Any) -> Any:
    """PostgREST-shaped value: what supabase-js would have handed the TS."""
    if isinstance(v, dict):
        return {k: jsonish(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonish(x) for x in v]
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (_dt.datetime, _dt.date, _dt.time)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


def _adapt(v: Any) -> Any:
    """Bind a Python value the way PostgREST would have sent JSON (objects/arrays → jsonb)."""
    if isinstance(v, (dict, list)):
        return Jsonb(v)
    return v


class Db:
    """One Supabase API role (`anon` / `authenticated` / `service_role`)."""

    def __init__(self, role: str, claims: dict | None = None) -> None:
        self.role = role
        self.claims = claims

    @property
    def is_service(self) -> bool:
        """True for the service client (the TS checked for `auth.admin`)."""
        return self.role == "service_role"

    def _run(self, sql: str, params: Any, *, write: bool) -> list[dict]:
        with _core_db.role_connection(
            self.role, self.claims, write=write, fresh=not write
        ) as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description is not None else []
        return [jsonish(dict(r)) for r in rows]

    def rows(self, sql: str, params: Any = (), *, what: str) -> list[dict]:
        """A read (`.select()`); errors raise `DbError("<what>: <message>")`."""
        try:
            return self._run(sql, params, write=False)
        except DbError:
            raise
        except Exception as exc:  # psycopg.Error and pool errors alike
            raise DbError(f"{what}: {_msg(exc)}") from exc

    def maybe_one(self, sql: str, params: Any = (), *, what: str) -> dict | None:
        """`.maybeSingle()`: None for no row, an error for more than one."""
        rows = self.rows(sql, params, what=what)
        if len(rows) > 1:
            raise DbError(f"{what}: JSON object requested, multiple (or no) rows returned")
        return rows[0] if rows else None

    def write(self, sql: str, params: Any = (), *, what: str) -> list[dict]:
        """An INSERT/UPDATE … RETURNING on the primary."""
        try:
            return self._run(sql, params, write=True)
        except Exception as exc:
            raise DbError(f"{what}: {_msg(exc)}") from exc

    def rpc(
        self, fn: str, args: dict[str, Any], *, casts: dict[str, str] | None = None
    ) -> Any:
        """`.rpc(fn, args)` for a scalar/jsonb-returning function: named args, same names.

        `fn`, arg names and casts come from the ported source only — never from input.
        """
        casts = casts or {}
        parts = [f"{name} := %s{('::' + casts[name]) if name in casts else ''}" for name in args]
        sql = f"select public.{fn}({', '.join(parts)}) as result"
        try:
            rows = self._run(sql, tuple(_adapt(v) for v in args.values()), write=True)
        except Exception as exc:
            raise DbError(f"{fn}: {_msg(exc)}") from exc
        return rows[0]["result"] if rows else None


def _msg(exc: BaseException) -> str:
    diag = getattr(exc, "diag", None)
    primary = getattr(diag, "message_primary", None) if diag is not None else None
    if primary:
        return str(primary)
    text = str(exc)
    return text.splitlines()[0] if text else type(exc).__name__


def as_jsonb(v: Any) -> Jsonb:
    """Bind one value as jsonb (for hand-written INSERTs)."""
    return Jsonb(v)
