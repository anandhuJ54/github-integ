"""xmp website navigation menus — port of the supabase-js calls in
surface-ui/_base/src/lib/nav-menus.ts (the loaders and `navMutations`), used by xmp's
/website/cms page, components/website/nav-manager.tsx and nav-visual-editor.tsx.

Reads run as the caller (the CMS as the signed-in user; the assigned-nav read as `anon` when
signed out, which the table's `assigned nav menus public` policy serves), so RLS decides as it
did for the browser. Every call threw its error, so errors reach the page. Lists keep the
PostgREST shape and the 1000-row cap; `.single()` reads/inserts answer 406 unless exactly one
row matched.

The writes are the browser's statements, ported as they were: same table, same columns, same
filters. `deleted_at`, which the browser stamped with `new Date().toISOString()`, is stamped with
the server's clock. setAssignment keeps its two updates in the same order (clear the slot, then
assign), now in one transaction.
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import select

from _base.core.sql import fetch_all
from _base.schema import tables as T
from xmp.queries.common import MultipleRows
from xmp.queries.website import execute, now

menus = T.t_exp_web_nav_menus

COLUMNS = ("id", "name", "menu_type", "items", "assigned_site", "design_tag", "notes",
           "created_at", "updated_at", "deleted_at", "deleted_by")


def _cols(*names: str) -> list[Any]:
    return [menus.c[n] for n in names]


def exactly_one(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """`.single()`: PostgREST answered 406 unless exactly one row came back (the page threw)."""
    if len(rows) != 1:
        raise MultipleRows(MultipleRows.message)
    return rows[0]


def _items(values: dict[str, Any]) -> dict[str, Any]:
    """`items` is jsonb: psycopg adapts a dict / list only when wrapped. JSON null stays NULL."""
    if values.get("items") is not None:
        return {**values, "items": Jsonb(values["items"])}
    return values


# --- reads -----------------------------------------------------------------------------------

def load_nav_menus(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, select(*_cols(*COLUMNS)).where(menus.c.deleted_at.is_(None))
                     .order_by(menus.c.menu_type.asc(), menus.c.name.asc()))


def load_deleted_nav_menus(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, select(*_cols(*COLUMNS)).where(menus.c.deleted_at.is_not(None))
                     .order_by(menus.c.deleted_at.desc()))


def load_assigned_nav(conn: psycopg.Connection, site: str) -> list[dict[str, Any]]:
    """loadAssignedNav's read; the page picks the header / footer and normalizes them."""
    return fetch_all(conn, select(*_cols("id", "menu_type", "items"))
                     .where(menus.c.assigned_site == site, menus.c.deleted_at.is_(None)))


def get_nav_menu(conn: psycopg.Connection, menu_id: str) -> dict[str, Any]:
    """duplicate's read: select("name, menu_type, items, notes").eq("id", id).single()."""
    return exactly_one(fetch_all(conn, select(*_cols("name", "menu_type", "items", "notes"))
                                 .where(menus.c.id == menu_id).limit(2)))


# --- writes ----------------------------------------------------------------------------------

def create_nav_menu(conn: psycopg.Connection, v: dict[str, Any]) -> dict[str, Any]:
    """insert({name, menu_type, items, notes, design_tag: "new"}).select("id").single()."""
    stmt = menus.insert().values(**_items({**v, "design_tag": "new"})).returning(menus.c.id)
    return exactly_one(execute(conn, stmt))


def update_nav_menu(conn: psycopg.Connection, menu_id: str, patch: dict[str, Any]) -> None:
    """update(patch).eq("id", id) with the sent keys (an empty patch writes nothing)."""
    if patch:
        execute(conn, menus.update().where(menus.c.id == menu_id).values(**_items(patch)))


def set_assignment(conn: psycopg.Connection, menu_id: str, menu_type: str,
                   site: str | None) -> None:
    """Assigning clears whatever menu of the same type held the slot first; null unassigns."""
    if site:
        execute(conn, menus.update()
                .where(menus.c.assigned_site == site, menus.c.menu_type == menu_type,
                       menus.c.id != menu_id)
                .values(assigned_site=None))
    execute(conn, menus.update().where(menus.c.id == menu_id).values(assigned_site=site))


def soft_delete(conn: psycopg.Connection, menu_id: str, deleted_by: str | None) -> None:
    execute(conn, menus.update().where(menus.c.id == menu_id)
            .values(deleted_at=now(), deleted_by=deleted_by, assigned_site=None))


def restore(conn: psycopg.Connection, menu_id: str) -> None:
    execute(conn, menus.update().where(menus.c.id == menu_id)
            .values(deleted_at=None, deleted_by=None))


def hard_delete(conn: psycopg.Connection, menu_id: str) -> None:
    execute(conn, menus.delete().where(menus.c.id == menu_id))
