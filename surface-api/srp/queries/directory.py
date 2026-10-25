"""srp directory reads for the sales Directory drill-downs (/sales/professionals/$proId,
/sales/locations/$orgId, /sales/brands/$orgId): the professional row and the organization row.

Moved from sales (sales/queries/nav.py load_professional / load_org), surface audit 2026-10-25:
professional and location data belong to srp, published for the sales pages. Same SQL.

Runs as the signed-in user, so RLS decides exactly as it did for the browser. Both reads threw
in the browser (a 4xx with the database's message here); `.maybeSingle()` on two rows is
PostgREST's 406.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.core.sql import fetch_all
from _base.schema import tables as T
from srp.queries.common import single_or_raise

pros = T.t_professionals
orgs = T.t_organizations


def load_org(conn: psycopg.Connection, org_id: str) -> dict[str, Any] | None:
    """loadOrg: select("*").eq("id").maybeSingle() (threw; 406 for two)."""
    return single_or_raise(fetch_all(conn, select(orgs).where(orgs.c.id == org_id).limit(2)))


def load_professional(conn: psycopg.Connection, pro_id: str) -> dict[str, Any] | None:
    """loadProfessional: select("*").eq("id").maybeSingle() (threw; 406 for two)."""
    return single_or_raise(fetch_all(conn, select(pros).where(pros.c.id == pro_id).limit(2)))
