"""NORA build & registry — port of the supabase-js calls in
surface-ui/_base/src/lib/nora-registry.ts (exp_skill_registry, exp_capability_registry,
exp_build_map, exp_skill_eval, exp_skill_version, exp_skill_run), used by the `_base`
components nora/registry-tabs.tsx and nora/skill-runs.tsx and nora-os' sandbox tab.

Runs as the signed-in user, so RLS decides as it did for the browser. Every call threw its error
(`must`), so errors reach the page. Lists keep the PostgREST shape and the 1000-row cap;
`.maybeSingle()` → one object or null (406 on several rows), `.select("*").single()` after a
write → the row (406 unless exactly one).

The writes are the browser's statements, ported as they were: same table, same columns (the
sent keys), same filter by id. `last_run_at`, which the browser stamped with
`new Date().toISOString()`, is stamped with the server's clock; `published_by`, which the browser
read from `supabase.auth.getUser()`, is the verified JWT's `sub`. Publish / yank keep their two
steps in the same order (save the skill, then snapshot a version row), now in one transaction.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import Table, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import ClauseElement

from _base.core.sql import compile_sql, fetch_all, jsonish
from _base.schema import tables as T

skills = T.t_exp_skill_registry
caps = T.t_exp_capability_registry
build = T.t_exp_build_map
evals = T.t_exp_skill_eval
versions = T.t_exp_skill_version
runs = T.t_exp_skill_run


class NotOneRow(ValueError):
    """`.single()` / `.maybeSingle()` got the wrong row count: PostgREST answered 406."""

    message = "JSON object requested, multiple (or no) rows returned"


# --- helpers ---------------------------------------------------------------------------------

def now() -> datetime:
    """The browser's `new Date().toISOString()`, from the server's clock."""
    return datetime.now(UTC)


def adapt(table: Table, values: dict[str, Any]) -> dict[str, Any]:
    """`values` with the table's jsonb columns wrapped for psycopg (a dict / list is adapted
    only when wrapped; a list would become an array). JSON null stays SQL NULL."""
    return {k: Jsonb(v) if v is not None and isinstance(table.c[k].type, JSONB) else v
            for k, v in values.items()}


def execute(conn: psycopg.Connection, stmt: ClauseElement) -> list[dict[str, Any]]:
    """Run a write; the RETURNING rows (PostgREST-shaped) when it has a RETURNING clause."""
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def exactly_one(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if len(rows) != 1:
        raise NotOneRow(NotOneRow.message)
    return rows[0]


def maybe_one(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(rows) > 1:
        raise NotOneRow(NotOneRow.message)
    return rows[0] if rows else None


def by_key(conn: psycopg.Connection, table: Table, key: str) -> dict[str, Any] | None:
    return maybe_one(fetch_all(conn, select(table).where(table.c.key == key).limit(2)))


def insert_row(conn: psycopg.Connection, table: Table, values: dict[str, Any]) -> dict[str, Any]:
    """insert(values).select("*").single()."""
    return exactly_one(execute(conn, table.insert().values(**adapt(table, values))
                               .returning(table)))


def update_row(conn: psycopg.Connection, table: Table, row_id: str,
               values: dict[str, Any]) -> dict[str, Any]:
    """update(values).eq("id", id).select("*").single()."""
    return exactly_one(execute(conn, table.update().where(table.c.id == row_id)
                               .values(**adapt(table, values)).returning(table)))


def upsert_row(conn: psycopg.Connection, table: Table, row_id: str | None,
               values: dict[str, Any]) -> dict[str, Any]:
    """upsertRow: update by id when the row has one, else insert; the saved row."""
    return update_row(conn, table, row_id, values) if row_id else insert_row(conn, table, values)


def patch_by_id(conn: psycopg.Connection, table: Table, row_id: str,
                values: dict[str, Any]) -> None:
    """update(values).eq("id", id).select("id"): the returned ids were never used."""
    if values:
        execute(conn, table.update().where(table.c.id == row_id).values(**adapt(table, values)))


# --- skills ----------------------------------------------------------------------------------

def list_skills(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, select(skills).order_by(skills.c.key))


def get_skill(conn: psycopg.Connection, key: str) -> dict[str, Any] | None:
    return by_key(conn, skills, key)


def manifest_of(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k not in ("id", "created_at", "updated_at")}


def release_skill(conn: psycopg.Connection, row_id: str | None, skill: dict[str, Any],
                  release: str, published_by: str | None, note: str | None,
                  send_note: bool) -> dict[str, Any]:
    """publishSkill / yankSkill after the page's gate: save the skill, then insert the version
    snapshot (`status` "published" or "yanked"; yank also sends its note)."""
    saved = upsert_row(conn, skills, row_id, skill)
    version = {"skill_key": saved["key"], "version": saved["version"],
               "manifest": manifest_of(saved), "status": release, "published_by": published_by}
    if send_note:
        version["note"] = note
    execute(conn, versions.insert().values(**adapt(versions, version)).returning(versions.c.id))
    return saved


# --- capabilities ----------------------------------------------------------------------------

def list_capabilities(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, select(caps).order_by(caps.c.key))


def get_capability(conn: psycopg.Connection, key: str) -> dict[str, Any] | None:
    return by_key(conn, caps, key)


# --- build map -------------------------------------------------------------------------------

def list_build_map(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, select(build).order_by(build.c.track, build.c.sort_order,
                                                   build.c.step_no))


# --- evals, versions, runs -------------------------------------------------------------------

def list_evals(conn: psycopg.Connection, skill_key: str | None) -> list[dict[str, Any]]:
    stmt = select(evals).order_by(evals.c.skill_key, evals.c.name)
    if skill_key:
        stmt = stmt.where(evals.c.skill_key == skill_key)
    return fetch_all(conn, stmt)


def set_eval_result(conn: psycopg.Connection, eval_id: str, status: str) -> None:
    patch_by_id(conn, evals, eval_id, {"status": status, "last_run_at": now(),
                                       "last_result": {"manual": True, "status": status}})


def list_versions(conn: psycopg.Connection, skill_key: str) -> list[dict[str, Any]]:
    return fetch_all(conn, select(versions).where(versions.c.skill_key == skill_key)
                     .order_by(versions.c.published_at.desc()))


def list_skill_runs(conn: psycopg.Connection, limit: int) -> list[dict[str, Any]]:
    return fetch_all(conn, select(runs).order_by(runs.c.created_at.desc()).limit(limit))
