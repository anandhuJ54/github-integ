"""Public monetization RPCs from surface-ui/srp/src/lib/monetization.ts. All three are governed
SECURITY DEFINER functions with a pinned search_path; anon may execute them."""
from __future__ import annotations

from typing import Any

import psycopg

from _base.core.sql import MAX_ROWS, jsonish


def _call(conn: psycopg.Connection, sql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall() if cur.description else []
        return [jsonish(dict(r)) for r in rows[:MAX_ROWS]]


def sponsored_slots(conn: psycopg.Connection, gcid: str, geo: str) -> list[dict[str, Any]]:
    return _call(conn, "select * from public.public_sponsored_slots("
                 "p_gcid => %(g)s, p_geo => %(z)s)", {"g": gcid, "z": geo})


def ad_units(conn: psycopg.Connection, context: str, gcid: str, geo: str) -> list[dict[str, Any]]:
    return _call(conn, "select * from public.public_ad_units("
                 "p_context => %(c)s, p_gcid => %(g)s, p_geo => %(z)s)",
                 {"c": context, "g": gcid, "z": geo})


def page_view_ping(conn: psycopg.Connection, gcid: str, zip_: str, claim_cta: bool) -> None:
    _call(conn, "select public.public_page_view_ping(p_gcid => %(g)s, p_geo_value => %(z)s, "
          "p_claim_cta => %(c)s, p_geo_type => 'zip')", {"g": gcid, "z": zip_, "c": claim_cta})
