"""sales spine (S4) — port of the supabase-js calls in surface-ui/sales/src/lib/sales-spine.ts:
the scope dashboard (exp_claim_events, exp_territories, exp_sales_rep_metrics, exp_contracts,
exp_sales_pipeline, organizations) and the seller worklist (exp_claim_events,
exp_sales_pipeline, exp_territory_seats, exp_territories, exp_territory_brand, organizations,
search_rank_scores, graph_nodes).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. graph_nodes is a
graph table: it is only read here (the active node rows of the claim entities), as the browser
read it; never written. Reads are the browser's statements, PostgREST-shaped and raw: the scope
filters, the claim buckets, the commercial headroom and every money rollup stay in the browser.
Reads the browser threw throw here; the ones it ignored are tolerant (a failed count is null).

The 1000-row cap (follow-up 1j), kept 1:1:
- the scope's claim events, `.order(occurred_at asc).limit(10000)`: the oldest 1000 of 3,474;
- the worklist's claim events, `.order(occurred_at desc).limit(10000)`: the newest 1000;
- the profile meta reads, 200 entity ids per chunk, one capped read per chunk and table: each
  chunk's graph_nodes `.limit(10000)` (and its scores) is cut to 1000 on its own, as the
  browser's per-chunk requests were.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.core.sql import fetch_all, fetch_many
from _base.schema import tables as T
from sales.queries.boards import count_of, count_stmt
from sales.queries.cpq import cols

claims = T.t_exp_claim_events
territories = T.t_exp_territories
metrics = T.t_exp_sales_rep_metrics
contracts = T.t_exp_contracts
pipeline = T.t_exp_sales_pipeline
orgs = T.t_organizations
seats = T.t_exp_territory_seats
territory_brand = T.t_exp_territory_brand
scores = T.t_search_rank_scores
nodes = T.t_graph_nodes

CLAIM_COLS = ("id,entity_id,entity_label,entity_type,event_type,group_key,logo_org_id,"
              "nora_engagement,occurred_at,seller_id,state,contact_phone,contact_email,upgraded,"
              "is_demo")
CHUNK = 200
CLOSED = ["won", "lost"]


def _uniq(ids: list[Any]) -> list[Any]:
    return list(dict.fromkeys(i for i in ids if i))


# --- loadScopeDashboard ----------------------------------------------------------------------

def scope_stmts(group_key: str | None) -> dict[str, Any]:
    """The four reads whose errors the browser threw, in its order."""
    terr = select(*cols(territories, "id,group_key,office_count,brand_count,agent_count,seller_id"))
    met = select(*cols(metrics, "views,attempted_claims,claims,upgrades,revenue,group_key,"
                                "period_start"))
    if group_key:
        terr = terr.where(territories.c.group_key == group_key)
        met = met.where(metrics.c.group_key == group_key)
    return {
        # .limit(10000): cut to the oldest 1000 by the cap, as PostgREST did (follow-up 1j)
        "claims": select(*cols(claims, CLAIM_COLS)).order_by(claims.c.occurred_at.asc()).limit(10000),
        "territories": terr,
        "metrics": met,
        "contracts": select(*cols(contracts, "mrr,status,sold_by,org_id")),
    }


def scope_pipeline_stmt() -> Any:
    """.not("stage", "in", '("won","lost")') (no ORDER BY)."""
    return select(*cols(pipeline, "stage,value,owner")).where(~pipeline.c.stage.in_(CLOSED))


def load_scope(conn: psycopg.Connection, group_key: str | None) -> dict[str, Any]:
    """loadScopeDashboard's own reads: `{ claims, territories, metrics, contracts, pipeline }`
    (pipeline tolerant: the browser never checked it). Two round trips."""
    out = fetch_many(conn, scope_stmts(group_key))
    out["pipeline"] = fetch_many(conn, {"p": scope_pipeline_stmt()}, tolerant=True)["p"]
    return out


def logos(conn: psycopg.Connection, ids: list[str], with_parent: bool) -> list[dict[str, Any]]:
    """organizations select("id,name,logo_url[,parent_org_id]").in("id", ids) (threw; no
    ORDER BY)."""
    names = "id,name,logo_url,parent_org_id" if with_parent else "id,name,logo_url"
    return fetch_all(conn, select(*cols(orgs, names)).where(orgs.c.id.in_(ids)))


# --- loadWorklist ----------------------------------------------------------------------------

def worklist_claims_stmt() -> Any:
    # .limit(10000): cut to the newest 1000 by the cap, as PostgREST did (follow-up 1j)
    return select(*cols(claims, CLAIM_COLS)).order_by(claims.c.occurred_at.desc()).limit(10000)


def worklist_opps_stmt() -> Any:
    return (select(*cols(pipeline, "id,name,stage,value,expected_close,owner"))
            .where(~pipeline.c.stage.in_(CLOSED))
            .order_by(pipeline.c.updated_at.desc()).limit(500))


def load_worklist_rows(conn: psycopg.Connection) -> dict[str, list[dict[str, Any]]]:
    """loadWorklist's own two reads in its Promise.all: `{ claims, opportunities }` (claims
    threw; the opportunities' error was ignored)."""
    out = {"claims": fetch_all(conn, worklist_claims_stmt())}
    out["opportunities"] = fetch_many(conn, {"o": worklist_opps_stmt()}, tolerant=True)["o"]
    return out


def territory_brands(conn: psycopg.Connection, rep_id: str) -> dict[str, list[dict[str, Any]]]:
    """The rep's seat and owned territories (ignored errors), then their brands (only when there
    are any): `{ seats, owned, brands }`."""
    got = fetch_many(conn, {
        "seats": select(seats.c.territory_id).where(seats.c.rep_id == rep_id),
        "owned": select(territories.c.id).where(territories.c.seller_id == rep_id),
    }, tolerant=True)
    ids = _uniq([*(r.get("territory_id") for r in got["seats"]),
                 *(r.get("id") for r in got["owned"])])
    got["brands"] = fetch_many(conn, {"b": (
        select(territory_brand.c.org_id).where(territory_brand.c.territory_id.in_(ids)))},
        tolerant=True)["b"] if ids else []
    return got


def location_counts(conn: psycopg.Connection, ids: list[str]) -> dict[str, int | None]:
    """Per logo: organizations select("id", { count: "exact", head: true }).eq("parent_org_id",
    id) — the browser's one count per logo, in one round trip; null where a count failed."""
    got = fetch_many(conn, {str(i): count_stmt(orgs, orgs.c.parent_org_id == org_id)
                            for i, org_id in enumerate(ids)}, tolerant=True)
    return {org_id: count_of(got[str(i)]) for i, org_id in enumerate(ids)}


def profile_meta_stmts(ids: list[str]) -> dict[str, Any]:
    """loadProfileMeta: per 200-id chunk, the scores and the active graph node rows (`.limit
    (10000)`), each its own capped read."""
    stmts: dict[str, Any] = {}
    for n, i in enumerate(range(0, len(ids), CHUNK)):
        chunk = ids[i:i + CHUNK]
        stmts[f"s{n}"] = (select(scores.c.entity_id, scores.c.total_score)
                          .where(scores.c.entity_id.in_(chunk)))
        stmts[f"n{n}"] = (select(nodes.c.entity_id)
                          .where(nodes.c.entity_id.in_(chunk), nodes.c.is_active.is_(True))
                          .limit(10000))
    return stmts


def profile_meta(conn: psycopg.Connection, ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """`{ scores, nodes }`: every chunk's rows, chunk after chunk (ignored errors: a failed
    chunk read adds nothing)."""
    got = fetch_many(conn, profile_meta_stmts(ids), tolerant=True)
    chunks = range((len(ids) + CHUNK - 1) // CHUNK)
    return {"scores": [r for n in chunks for r in got[f"s{n}"]],
            "nodes": [r for n in chunks for r in got[f"n{n}"]]}
