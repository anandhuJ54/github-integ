"""ETL /discovery tabs: AI cost, field yield + required fields, runs, schedules, source stats and
the manual company add — port of the supabase-js calls in
surface-ui/etl/src/components/discovery/{ai-cost-tab,field-yield-tab,required-fields-editor,
runs-tab,schedules-tab,source-stats-tab,add-websites-dialog}.tsx.

Runs as the signed-in user. ETL tables are read-only to `authenticated` (RLS); every write is a
SECURITY DEFINER function, 14 of the 16 with a control-role check (SF-6 has the two without).
The schedule switch (exp_etl_cron_set_active) is a gated action: ported, never run as a test.
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb
from sqlalchemy import func, select

from _base.db import tables as T
from _base.db.sql import typed
from surfaces.etl.console.common import fetch_many, rpc_rows, rpc_value

stg = T.t_exp_etl_staging


def ai_cost_events(conn: psycopg.Connection, since: str | None) -> list[dict[str, Any]]:
    e = T.t_exp_etl_cost_events
    stmt = select(e).order_by(e.c.occurred_at.desc()).limit(5000)
    if since:
        stmt = stmt.where(e.c.occurred_at >= typed(e.c.occurred_at, since))
    return fetch_many(conn, {"e": stmt})["e"]


def field_yield(conn: psycopg.Connection) -> dict[str, Any]:
    """loadGate: floors, hydrate jobs, and per-gcid staging counts (total / deep / shallow)."""
    f, j = T.t_exp_etl_field_floors, T.t_exp_etl_hydrate_jobs
    r = fetch_many(conn, {
        "floors": select(f).order_by(f.c.gcid),
        "jobs": select(j).order_by(j.c.job_key),
    }, tolerant=True)
    gcids = list(dict.fromkeys([x["gcid"] for x in r["floors"]] + [x["gcid"] for x in r["jobs"]]))
    counts: dict[str, Any] = {}
    if gcids:
        c = stg.c
        rows = fetch_many(conn, {"c": select(
            c.gcid,
            func.count().label("total"),
            func.count().filter(c.payload["field_tier"].astext == "deep").label("deep"),
            func.count().filter(c.resolution_status == "shallow").label("shallow"),
        ).where(c.gcid.in_(gcids)).group_by(c.gcid)}, tolerant=True)["c"]
        counts = {x["gcid"]: {"total": x["total"], "deep": x["deep"], "shallow": x["shallow"]}
                  for x in rows}
    return {"floors": r["floors"], "jobs": r["jobs"], "gcids": gcids, "counts": counts}


def source_gcids(conn: psycopg.Connection) -> list[dict[str, Any]]:
    s = T.t_exp_etl_sources
    return fetch_many(conn, {"s": select(s.c.gcid)}, tolerant=True)["s"]


def set_field_floor(conn: psycopg.Connection, v: dict[str, Any]) -> None:
    rpc_rows(conn, "select public.exp_etl_set_field_floor(p_gcid => %(gcid)s, "
             "p_required_keys => %(keys)s, p_min_fields => %(mf)s, p_min_products => %(mp)s, "
             "p_min_licenses => %(ml)s, p_notes => %(notes)s)",
             {"gcid": v["gcid"], "keys": v["required_keys"], "mf": v["min_fields"],
              "mp": v["min_products"], "ml": v["min_licenses"], "notes": v.get("notes")})


def runs(conn: psycopg.Connection) -> list[dict[str, Any]]:
    r = T.t_exp_etl_runs.c
    cols = ("run_id", "source_id", "started_at", "finished_at", "pages_fetched", "pulled",
            "staged", "matched", "created", "conflicted", "errors", "entities_yielded")
    return fetch_many(conn, {"r": select(*(r[k] for k in cols))
                             .order_by(r.started_at.desc().nulls_last()).limit(200)})["r"]


def source_domains(conn: psycopg.Connection, ids: list[str]) -> list[dict[str, Any]]:
    s = T.t_exp_etl_sources.c
    return fetch_many(conn, {"s": select(s.source_id, s.source_domain)
                             .where(s.source_id.in_(ids))})["s"]


def frontier_matrix_rows(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """kind/status of the frontier rows the page counted (capped at MAX_ROWS, as PostgREST
    capped it: see docs/BROWSER_TO_API_FOLLOWUPS.md)."""
    f = T.t_exp_etl_frontier.c
    return fetch_many(conn, {"f": select(f.kind, f.status)})["f"]


def cron_list(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return rpc_rows(conn, "select * from public.exp_etl_cron_list()")


def cron_set_active(conn: psycopg.Connection, jobname: str, active: bool) -> None:
    rpc_rows(conn, "select public.exp_etl_cron_set_active(p_jobname => %(j)s, p_active => %(a)s)",
             {"j": jobname, "a": active})


def stats_sources(conn: psycopg.Connection) -> list[dict[str, Any]]:
    s = T.t_exp_etl_sources.c
    return fetch_many(conn, {"s": select(s.source_domain, s.gcid)
                             .where(s.role_in_discovery == "hierarchy_source")})["s"]


def source_stats(conn: psycopg.Connection, gcid: str, source: str | None) -> list[dict[str, Any]]:
    """exp_etl_source_stats returns one jsonb array (not a set of rows); PostgREST sent the array
    itself, and the page read `data ?? []`."""
    value = rpc_value(conn, "select public.exp_etl_source_stats(p_gcid => %(g)s, "
                      "p_source => %(s)s)", {"g": gcid, "s": source})
    return value if value is not None else []


def add_companies_manual(conn: psycopg.Connection, category: str, entries: list[str]) -> Any:
    return rpc_value(conn, "select public.disco_add_companies_manual(p_category => %(c)s, "
                     "p_entries => %(e)s)", {"c": category, "e": Jsonb(entries)})
