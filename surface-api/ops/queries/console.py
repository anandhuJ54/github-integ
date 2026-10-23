"""Console home (/console) — port of the supabase-js reads in
surface-ui/ops/src/routes/_authenticated/console.tsx. The page still does its sums; these return
what each of its queries returned. Time boundaries come from the page (as it computed them)."""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import func, select

from _base.core.sql import fetch_many, typed
from _base.schema import tables as T


def _counts(table: Any, **filters: Any) -> Any:
    return select(*(
        (func.count().filter(f) if f is not None else func.count()).label(name)
        for name, f in filters.items()
    )).select_from(table)


def profiles(conn: psycopg.Connection, d7: str, d14: str, today: str) -> dict[str, int]:
    """useProfiles' 14 counts: two queries (professionals, organizations) with FILTERs."""
    out: dict[str, int] = {}
    stmts = {}
    for key, t in (("pros", T.t_professionals), ("orgs", T.t_organizations)):
        c = t.c
        made, claim = c.created_at, c.claimed_at
        stmts[key] = _counts(
            t,
            total=None,
            new7=made >= typed(made, d7),
            prev7=(made >= typed(made, d14)) & (made < typed(made, d7)),
            claimed=c.claimed.is_(True),
            claims7=claim >= typed(claim, d7),
            claimsPrev7=(claim >= typed(claim, d14)) & (claim < typed(claim, d7)),
            claimsToday=claim >= typed(claim, today),
        )
    rows = fetch_many(conn, stmts)
    for key in stmts:
        for name, n in rows[key][0].items():
            out[f"{key}_{name}"] = n
    return out


def revenue(conn: psycopg.Connection) -> list[dict[str, Any]]:
    c = T.t_exp_contracts.c
    return fetch_many(conn, {"c": select(c.id, c.status, c.mrr, c.end_date)})["c"]


def categories(conn: psycopg.Connection, today: str) -> dict[str, int]:
    g, j = T.t_gbp_categories, T.t_disco_jobs
    rows = fetch_many(conn, {
        "cats": _counts(g, active=g.c.status == "active", total=None),
        "etl": _counts(j, running=j.c.status.in_(("queued", "awaiting_ai", "running"))),
        "pros": _counts(T.t_professionals, today=T.t_professionals.c.created_at
                        >= typed(T.t_professionals.c.created_at, today)),
        "orgs": _counts(T.t_organizations, today=T.t_organizations.c.created_at
                        >= typed(T.t_organizations.c.created_at, today)),
    })
    return {
        "active": rows["cats"][0]["active"],
        "total": rows["cats"][0]["total"],
        "etlRunning": rows["etl"][0]["running"],
        "prosToday": rows["pros"][0]["today"],
        "orgsToday": rows["orgs"][0]["today"],
    }


def nora_events(conn: psycopg.Connection, since: str) -> list[dict[str, Any]]:
    e = T.t_exp_activity_events.c
    return fetch_many(conn, {"e": select(e.event_type, e.occurred_at)
                             .where(e.occurred_at >= typed(e.occurred_at, since))})["e"]
