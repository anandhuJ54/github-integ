"""Platform counters for the console surfaces — port of the platform part of
surface-ui/_base/src/lib/console-surfaces.ts (loadReportMetrics, loadNoraOs, loadOrgStats), used by
ops /reports, admin /organizations, the search pages and the etl /discovery pipeline-health tab.

Runs as the signed-in user, so RLS decides what is counted, as it did for the browser. Each
`countOf(table, filter)` was `select("*", { count: "exact", head: true })`: an exact
`count(*)` here too, never an estimate. Each loader's `Promise.all` is one `fetch_many` round
trip; the page threw on any error, so one failed count fails the loader (nothing tolerant).
Filters keep PostgREST's operators: `.eq(c, true)` → `c = true`, `.not(c, "is", true)` →
`c IS NOT true`, `.not(c, "is", null)` → `c IS NOT NULL`.

graph_nodes (~3M rows) is counted exactly as before; measured at port time as the authenticated
role: ~2 s, under that role's 8 s statement_timeout, so the legacy read completed too.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import func, select, true
from sqlalchemy.sql import ColumnElement

from _base.db import tables as T
from _base.db.sql import fetch_many

orgs = T.t_organizations
jobs = T.t_disco_jobs

engine_requests = T.t_exp_engine_requests
engine_snapshots = T.t_exp_engine_snapshots
engine_prompts = T.t_exp_engine_prompts


def count_of(t: Any, *where: ColumnElement) -> Any:
    """`countOf(table, (q) => …)`: an exact count(*) of the rows the user can see."""
    stmt = select(func.count().label("count")).select_from(t)
    return stmt.where(*where) if where else stmt


def _counts(conn: psycopg.Connection, stmts: dict[str, Any]) -> dict[str, int]:
    rows = fetch_many(conn, stmts)
    return {k: int(r[0]["count"]) for k, r in rows.items()}


def report_metrics(conn: psycopg.Connection) -> dict[str, int]:
    """loadReportMetrics: the fourteen counts, keyed as the page returns them."""
    gbp, schema = T.t_gbp_categories, T.t_exp_category_schema
    pros, contracts, ents = T.t_professionals, T.t_exp_contracts, T.t_exp_entitlements
    return _counts(conn, {
        "categories": count_of(gbp),
        "launched": count_of(gbp, gbp.c.is_launched == true()),
        "fieldModels": count_of(schema, schema.c.is_launched == true()),
        "graphNodes": count_of(T.t_graph_nodes),
        "scored": count_of(T.t_search_rank_scores),
        "orgs": count_of(orgs, orgs.c.is_demo.is_not(True)),
        "pros": count_of(pros, pros.c.is_demo.is_not(True)),
        "registry": count_of(T.t_exp_vertical_node_registry),
        "contracts": count_of(contracts, contracts.c.is_demo.is_not(True)),
        "entitlements": count_of(ents, ents.c.state == "active"),
        "devTeams": count_of(T.t_exp_dev_teams),
        "devProjects": count_of(T.t_exp_dev_projects),
        "leads": count_of(T.t_exp_web_leads),
        "pages": count_of(T.t_exp_web_pages),
    })


def nora_os(conn: psycopg.Connection) -> dict[str, Any]:
    """loadNoraOs's reads: the latest 100 disco_jobs and six counts (one round trip)."""
    r = fetch_many(conn, {
        "jobs": select(jobs.c.job_id, jobs.c.category_slug, jobs.c.step, jobs.c.status,
                       jobs.c.note, jobs.c.created_at, jobs.c.updated_at)
        .order_by(jobs.c.updated_at.desc()).limit(100),
        "proposals": count_of(T.t_disco_proposals),
        "llm": count_of(T.t_disco_llm_requests),
        "siteContracts": count_of(T.t_disco_site_contract),
        "engineRequests": count_of(engine_requests),
        "engineSnapshots": count_of(engine_snapshots),
        "enginePrompts": count_of(engine_prompts),
    })
    jobs_rows = r.pop("jobs")
    return {"jobs": jobs_rows, "counts": {k: int(v[0]["count"]) for k, v in r.items()}}


def org_stats(conn: psycopg.Connection) -> dict[str, int]:
    """loadOrgStats: the six organizations counts."""
    return _counts(conn, {
        "total": count_of(orgs),
        "real": count_of(orgs, orgs.c.is_demo.is_not(True)),
        "demo": count_of(orgs, orgs.c.is_demo == true()),
        "claimed": count_of(orgs, orgs.c.claimed == true()),
        "scored": count_of(orgs, orgs.c.search_rank_score.is_not(None)),
        "gbp": count_of(orgs, orgs.c.gbp_connected == true()),
    })
