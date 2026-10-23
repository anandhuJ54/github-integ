"""/compliance reads — port of the supabase-js calls in
surface-ui/admin/src/routes/_authenticated/compliance.tsx. The page still joins the rows itself;
these return what each of its queries returned (lists capped at MAX_ROWS, as PostgREST did)."""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from sqlalchemy import select

from _base.core.sql import fetch_all
from _base.schema.tables import t_content_compliance_rules as rules_t
from _base.schema.tables import t_entity_compliance as ec_t
from _base.schema.tables import t_exp_category_compliance as comp_t
from _base.schema.tables import t_gbp_categories as cat_t
from _base.schema.tables import t_organizations as org_t
from _base.schema.tables import t_professionals as pro_t

log = logging.getLogger(__name__)


def _safe(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    """A read whose error the page ignored (`x.data ?? []`)."""
    try:
        with conn.transaction():
            return fetch_all(conn, stmt)
    except psycopg.Error as exc:
        log.warning("compliance read failed: %s", type(exc).__name__)
        return []


def coverage(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    c = cat_t.c
    return {
        # the page threw on this one's error, so it raises here too
        "cats": fetch_all(conn, select(c.gcid, c.display_name).order_by(c.display_name)
                          .limit(5000)),
        "comp": _safe(conn, select(comp_t)),
        "rules": _safe(conn, select(rules_t.c.gcid)),
    }


def entities(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    rows = fetch_all(conn, select(ec_t).order_by(ec_t.c.compliance_score.asc()).limit(200))
    pro_ids = [r["entity_id"] for r in rows if r["entity_type"] == "professional"]
    org_ids = [r["entity_id"] for r in rows if r["entity_type"] == "organization"]
    p, o = pro_t.c, org_t.c
    return {
        "rows": rows,
        "pros": _safe(conn, select(p.id, p.display_name, p.first_name, p.last_name, p.gcid)
                      .where(p.id.in_(pro_ids))) if pro_ids else [],
        "orgs": _safe(conn, select(o.id, o.name, o.gcid).where(o.id.in_(org_ids)))
        if org_ids else [],
        "cats": _safe(conn, select(cat_t.c.gcid, cat_t.c.display_name)),
    }
