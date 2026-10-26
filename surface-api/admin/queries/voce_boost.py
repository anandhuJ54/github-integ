"""VOCE boost update — port of `updateBoost()` in surface-ui/_base/src/lib/voce.ts (the boost
manager on /search/voce). Moved from search/queries/voce.py, surface audit 2026-10-25; the VOCE
reads stay in the search Surface.

RLS decides, as it did for the browser: super_admin/architect write.
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import update

from _base.db.sql import compile_sql, typed
from _base.db.tables import t_exp_voce_article as voce_t


def update_boost_stmt(article_id: str, patch: dict[str, Any]) -> Any:
    """updateBoost(): `update(patch).eq("id", id)` — only the keys the page sent."""
    values = dict(patch)
    if "boost_placements" in values and values["boost_placements"] is not None:
        values["boost_placements"] = Jsonb(values["boost_placements"])
    return update(voce_t).where(voce_t.c.id == typed(voce_t.c.id, article_id)).values(**values)


def update_boost(conn: psycopg.Connection, article_id: str, patch: dict[str, Any]) -> None:
    # Like PostgREST: an update the policy filters out changes nothing and is not an error.
    sql, params = compile_sql(update_boost_stmt(article_id, patch))
    with conn.cursor() as cur:
        cur.execute(sql, params)
