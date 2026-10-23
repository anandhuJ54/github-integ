"""ETL /discovery group 2: pipeline (staging), site contract panel + proposals, source actions and
states, source registry, category population — port of the supabase-js calls in
surface-ui/etl/src/components/discovery/{pipeline-tab,site-contract-panel,site-contract-proposals,
source-actions,source-registry-tab,category-population-tab}.tsx.

Runs as the signed-in user. Reads return what each supabase-js query returned (JSON paths such as
`version:extraction->site_contract->>version` as the same labels); the page still composes them.
Writes are the governed SECURITY DEFINER functions, called through one allow-list (ETL_RPCS) that
names each function's parameters and their database types.
"""
from __future__ import annotations

import re
from typing import Any

import psycopg
from sqlalchemy import exists, func, select

from _base.schema import tables as T
from etl.queries.common import fetch_many, one_of, rpc_value

src, stg, runs_t = T.t_exp_etl_sources, T.t_exp_etl_staging, T.t_exp_etl_runs
contract_t, llm_t, props_t = T.t_disco_site_contract, T.t_disco_llm_requests, T.t_disco_proposals
frontier_t, jobs_t, disco_jobs_t = T.t_exp_etl_frontier, T.t_exp_etl_jobs, T.t_disco_jobs
cats_t = T.t_gbp_categories

PAGE_SIZE = 50
FUNNEL = ("pending", "matched", "created", "corroborated", "conflicted", "shallow", "rejected")


# --- governed writes (one allow-list) ----------------------------------------------------------

# name → ([(param, db type)], how the value comes back). The function decides (role checks etc.).
ETL_RPCS: dict[str, tuple[list[tuple[str, str]], str]] = {
    "disco_reject_site_proposal": ([("p_proposal_id", "bigint")], "value"),
    "exp_etl_run_source": ([("p_source", "uuid")], "value"),
    "exp_etl_reharvest_source": ([("p_source", "uuid")], "value"),
    "disco_request_remap_site": ([("p_source_id", "uuid")], "value"),
    "disco_retry_method_classification": ([("p_source_id", "uuid")], "value"),
    "exp_etl_set_source_status": ([("p_source", "uuid"), ("p_status", "text"),
                                   ("p_note", "text")], "value"),
    "disco_activate": ([("p_category", "text")], "value"),
    "exp_etl_set_limits": ([("p_source", "uuid"), ("p_daily_quota", "integer"),
                            ("p_min_delay", "integer"), ("p_window", "text")], "value"),
    "exp_etl_activate_category": ([("p_gcid", "text")], "value"),
    "exp_etl_approve_companies": ([("p_gcid", "text"), ("p_source_ids", "uuid[]")], "value"),
    "disco_confirm_companies": ([("p_proposal_id", "bigint"),
                                 ("p_approved_domains", "text[]")], "value"),
}


class UnknownRpc(ValueError):
    """Not an allow-listed function, or a parameter it doesn't take."""


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    """Call an allow-listed function with the named arguments given (omitted ones take the
    function's defaults, as supabase-js `rpc` did)."""
    if name not in ETL_RPCS:
        raise UnknownRpc(f"unknown function {name!r}")
    params, _ = ETL_RPCS[name]
    allowed = dict(params)
    unknown = set(args) - set(allowed)
    if unknown:
        raise UnknownRpc(f"{name}: unknown parameter(s) {sorted(unknown)}")
    named = ", ".join(f"{p} => %({p})s::{allowed[p]}" for p in allowed if p in args)
    return rpc_value(conn, f"select public.{name}({named})", {p: args[p] for p in args})


def run_source(conn: psycopg.Connection, source_id: str) -> dict[str, Any]:
    """exp_etl_run_source, then the new run's `detail` (what it seeded), as the page did."""
    run_id = call_rpc(conn, "exp_etl_run_source", {"p_source": source_id})
    seeded = None
    if run_id:
        rows = fetch_many(conn, {"r": select(runs_t.c.detail).where(runs_t.c.run_id == run_id)
                                 .limit(2)}, tolerant=True)["r"]
        seeded = (one_of(rows) or {}).get("detail")
    return {"runId": run_id, "seeded": seeded}


# --- pipeline (staging) ----------------------------------------------------------------------

def _stage_filters(f: dict[str, Any], include_status: bool = True) -> list[Any]:
    c = stg.c
    where = []
    if f.get("gcid"):
        where.append(c.gcid == f["gcid"])
    if f.get("source_id"):
        where.append(c.source_id == f["source_id"])
    if include_status and f.get("status"):
        where.append(c.resolution_status == f["status"])
    return where


def pipeline_sources(conn: psycopg.Connection) -> list[dict[str, Any]]:
    s = src.c
    return fetch_many(conn, {"s": select(s.source_id, s.source_domain, s.gcid)})["s"]


def staging_gcids(conn: psycopg.Connection, gcids: list[str]) -> list[str]:
    """Which of these gcids have any staging rows (the page checked each with a count)."""
    if not gcids:
        return []
    stmts = {g: select(exists(select(1).where(stg.c.gcid == g)).label("any")) for g in gcids}
    got = fetch_many(conn, stmts, tolerant=True)
    return [g for g in sorted(gcids) if got[g] and got[g][0]["any"]]


def funnel(conn: psycopg.Connection, f: dict[str, Any]) -> dict[str, int]:
    c = stg.c
    stmt = select(*(func.count().filter(c.resolution_status == k).label(k) for k in FUNNEL)) \
        .select_from(stg).where(*_stage_filters(f, include_status=False))
    return fetch_many(conn, {"f": stmt})["f"][0]


def source_domain_rows(conn: psycopg.Connection) -> list[dict[str, Any]]:
    s = src.c
    return fetch_many(conn, {"s": select(s.source_id, s.source_domain)})["s"]


def staging_page(conn: psycopg.Connection, f: dict[str, Any], page: int) -> dict[str, Any]:
    c = stg.c
    where = _stage_filters(f)
    r = fetch_many(conn, {
        "rows": select(c.stage_id, c.source_id, c.gcid, c.entity_type, c.resolution_status,
                       c.field_tier, c.observed_at, c.payload, c.identity_candidates)
        .where(*where).order_by(c.observed_at.desc().nulls_last(), c.stage_id)
        .offset(page * PAGE_SIZE).limit(PAGE_SIZE),
        "total": select(func.count().label("n")).select_from(stg).where(*where),
    })
    return {"rows": r["rows"], "total": r["total"][0]["n"]}


# --- site contract panel + proposals ---------------------------------------------------------

def site_contract(conn: psycopg.Connection, domain: str, gcid: str,
                  source_id: str) -> dict[str, Any]:
    k, s, q = contract_t.c, src.c, llm_t.c
    r = fetch_many(conn, {
        "c": select(k.roster_pattern, k.detail_pattern, k.profile_sitemaps, k.detail_entity_type,
                    k.field_floor, k.learned_at, k.extraction["site_contract"].label("site_contract"))
        .where(k.domain == domain, k.category_slug == gcid)
        .order_by(k.learned_at.desc()).limit(1),
        "s": select(s.status, s.crawl_method, s.fetch_tier, s.page_kinds, s.daily_quota,
                    s.min_delay_seconds, s.test_results).where(s.source_id == source_id).limit(2),
        "l": select(q.response["site_contract_summary"].label("summary"))
        .where(q.tool == "map_site", q.prompt_input["domain"].astext == domain)
        .order_by(q.created_at.desc()).limit(1),
    }, tolerant=True)
    last = one_of(r["l"])
    return {"contract": one_of(r["c"]), "source": one_of(r["s"]),
            "summary": last["summary"] if last else None}


def site_proposals(conn: psycopg.Connection, domain: str, gcid: str) -> list[dict[str, Any]]:
    p = props_t.c
    return fetch_many(conn, {"p": select(p.proposal_id, p.state, p.created_at, p.payload)
                             .where(p.kind == "site_map", p.category_slug == gcid,
                                    p.payload["domain"].astext == domain)
                             .order_by(p.created_at.desc()).limit(10)})["p"]


def accept_harvest_state(conn: psycopg.Connection, domain: str, gcid: str) -> dict | None:
    """Whether Accept would close a running harvest: the open run's start and the queued pages."""
    s, r, f = src.c, runs_t.c, frontier_t.c
    source = one_of(fetch_many(conn, {"s": select(s.source_id, s.status)
                                      .where(s.source_domain == domain, s.gcid == gcid).limit(2)},
                               tolerant=True)["s"])
    if not source or source["status"] != "active":
        return None
    got = fetch_many(conn, {
        "run": select(r.started_at).where(r.source_id == source["source_id"],
                                          r.finished_at.is_(None))
        .order_by(r.started_at.desc()).limit(1),
        "n": select(func.count().label("n")).select_from(frontier_t)
        .where(f.domain == domain, f.status.in_(("queued", "fetching"))),
    }, tolerant=True)
    if not got["run"]:
        return None
    return {"since": str(got["run"][0]["started_at"]),
            "queued": got["n"][0]["n"] if got["n"] else 0}


# --- source actions / states -----------------------------------------------------------------

def source_state_rows(conn: psycopg.Connection, ids: list[str], domains: list[str]) -> dict:
    """useSourceStates' reads: contracts, open runs, map / method-check requests, pending
    proposals, and the queued-page count of every domain with an open run."""
    k, r, q, p = contract_t.c, runs_t.c, llm_t.c, props_t.c
    sc = k.extraction["site_contract"]
    got = fetch_many(conn, {
        "contracts": select(k.domain, k.category_slug, k.detail_pattern,
                            sc["version"].astext.label("version"),
                            sc["detail_route"]["record_source"].astext.label("record_source"))
        .where(k.domain.in_(domains)),
        "runs": select(r.run_id, r.source_id, r.started_at)
        .where(r.source_id.in_(ids), r.finished_at.is_(None)),
        "reqs": select(q.request_id, q.tool, q.status, q.prompt_input["domain"].astext.label("domain"),
                       q.prompt_input["category"].astext.label("category"),
                       q.response["map_step"].astext.label("step"),
                       q.response["error"].astext.label("error"))
        .where(q.tool.in_(("map_site", "classify_method")),
               q.prompt_input["domain"].astext.in_(domains))
        .order_by(q.request_id.desc()).limit(1000),
        "props": select(p.category_slug, p.payload["domain"].astext.label("domain"))
        .where(p.kind == "site_map", p.state == "pending"),
    }, tolerant=True)
    open_ids = {x["source_id"] for x in got["runs"]}
    return {**got, "openRunSourceIds": sorted(open_ids)}


def queued_pages(conn: psycopg.Connection, domains: list[str]) -> dict[str, int | None]:
    f = frontier_t.c
    stmts = {d: select(func.count().label("n")).select_from(frontier_t)
             .where(f.domain == d, f.status.in_(("queued", "fetching"))) for d in domains}
    got = fetch_many(conn, stmts, tolerant=True)
    return {d: (got[d][0]["n"] if got[d] else None) for d in domains}


def done_pages(conn: psycopg.Connection, domains: list[str]) -> dict[str, int]:
    f = frontier_t.c
    stmts = {d: select(func.count().label("n")).select_from(frontier_t)
             .where(f.domain == d, f.kind == "detail_page", f.status == "done") for d in domains}
    got = fetch_many(conn, stmts)
    return {d: got[d][0]["n"] for d in domains}


# --- source registry -------------------------------------------------------------------------

REGISTRY_COLS = ("source_id", "gcid", "source_domain", "source_type", "authority_rank",
                 "freshness", "hierarchy_sourceable", "entity_types_available", "field_coverage",
                 "field_count", "daily_quota", "min_delay_seconds", "pull_window", "access_method",
                 "robots_tos_status", "status", "notes", "crawl_method")


def registry_sources(conn: psycopg.Connection) -> list[dict[str, Any]]:
    s = src.c
    return fetch_many(conn, {"s": select(*(s[k] for k in REGISTRY_COLS))
                             .order_by(s.gcid.asc(), s.authority_rank.asc().nulls_last())
                             .limit(2000)})["s"]


def request_statuses(conn: psycopg.Connection, ids: list[int]) -> list[dict[str, Any]]:
    q = llm_t.c
    return fetch_many(conn, {"r": select(q.request_id, q.status).where(q.request_id.in_(ids))})["r"]


def contract_field_floors(conn: psycopg.Connection) -> list[dict[str, Any]]:
    k = contract_t.c
    return fetch_many(conn, {"c": select(k.domain, k.category_slug, k.field_floor, k.learned_at)
                             .order_by(k.learned_at.desc()).limit(5000)})["c"]


# --- category population ---------------------------------------------------------------------

def category_search(conn: psycopg.Connection, term: str) -> dict[str, Any]:
    """The three lookups of the category picker; the page puts exact matches first."""
    term = term.strip()
    pat = re.sub(r"[\\%_]", lambda m: "\\" + m.group(0), term)
    low = term.lower()
    as_gcid = low if low.startswith("gcid:") else \
        "gcid:" + re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", low))
    c = cats_t.c
    base = select(c.gcid, c.display_name)
    return fetch_many(conn, {
        "byId": base.where(c.gcid == as_gcid).limit(1),
        "starts": base.where(c.display_name.ilike(f"{pat}%")).order_by(c.display_name).limit(12),
        "contains": base.where(c.display_name.ilike(f"%{pat}%")).order_by(c.display_name)
        .limit(12),
    })


def population_job(conn: psycopg.Connection, gcid: str) -> dict | None:
    j = jobs_t.c
    rows = fetch_many(conn, {"j": select(j.job_id, j.gcid, j.stage, j.status, j.active)
                             .where(j.gcid == gcid).limit(2)})["j"]
    if len(rows) > 1:  # .maybeSingle() threw on 2+ rows
        raise psycopg.errors.CardinalityViolation("JSON object requested, multiple rows returned")
    return rows[0] if rows else None


def population_sources(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    s = src.c
    return fetch_many(conn, {"s": select(s.source_id, s.gcid, s.source_domain, s.crawl_method,
                                         s.status, s.notes, s.role_in_discovery)
                             .where(s.gcid == gcid, s.role_in_discovery == "hierarchy_source")
                             .order_by(s.authority_rank.asc().nulls_last())})["s"]


def population_proposal(conn: psycopg.Connection, gcid: str) -> dict | None:
    p = props_t.c
    rows = fetch_many(conn, {"p": select(p.proposal_id, p.payload, p.decided_domains)
                             .where(p.category_slug == gcid, p.kind == "company_list",
                                    p.state == "pending")
                             .order_by(p.created_at.desc()).limit(1)})["p"]
    return rows[0] if rows else None


def population_runs(conn: psycopg.Connection, source_ids: list[str]) -> list[dict[str, Any]]:
    r = runs_t.c
    return fetch_many(conn, {"r": select(r.run_id, r.source_id, r.started_at, r.finished_at,
                                         r.pages_fetched, r.staged, r.created, r.matched,
                                         r.entities_yielded)
                             .where(r.source_id.in_(source_ids))
                             .order_by(r.started_at.desc())})["r"]


def population_staged(conn: psycopg.Connection, source_ids: list[str]) -> list[dict[str, Any]]:
    c = stg.c
    return fetch_many(conn, {"s": select(c.source_id, c.entity_type, c.resolution_status)
                             .where(c.source_id.in_(source_ids)).limit(5000)})["s"]


def population_contracts(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    k = contract_t.c
    return fetch_many(conn, {"c": select(k.domain, k.learned_at, k.method_evidence,
                                         k.detail_pattern,
                                         k.extraction["site_contract"]["version"]
                                         .label("contract_version"))
                             .where(k.category_slug == gcid)})["c"]


def map_attempts(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    q = llm_t.c
    return fetch_many(conn, {"m": select(q.request_id, q.status, q.created_at,
                                         q.prompt_input["domain"].astext.label("domain"),
                                         q.response["error"].astext.label("error"),
                                         q.response["map_step"].astext.label("map_step"))
                             .where(q.tool == "map_site", q.prompt_input["category"].astext == gcid)
                             .order_by(q.request_id.desc()).limit(500)})["m"]


def method_attempts(conn: psycopg.Connection, gcid: str) -> list[dict[str, Any]]:
    q = llm_t.c
    return fetch_many(conn, {"m": select(q.request_id, q.status,
                                         q.prompt_input["domain"].astext.label("domain"))
                             .where(q.tool == "classify_method",
                                    q.prompt_input["category"].astext == gcid)
                             .order_by(q.request_id.desc()).limit(500)})["m"]


def discover_running(conn: psycopg.Connection, gcid: str) -> bool:
    j = disco_jobs_t.c
    rows = fetch_many(conn, {"n": select(func.count().label("n")).select_from(disco_jobs_t)
                             .where(j.category_slug == gcid, j.step == "discover",
                                    j.status.in_(("queued", "running", "awaiting_ai")))})["n"]
    return rows[0]["n"] > 0
