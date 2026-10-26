"""ETL /discovery console data (group 1: AI cost, field yield, required fields, runs, schedules,
source stats, manual company add, hierarchy, entity panel) — replaces the direct supabase-js reads
and RPCs in surface-ui/etl/src/components/discovery. Runs as the signed-in user, so RLS and the
role-checked SECURITY DEFINER functions decide access, as they did for the browser."""
from __future__ import annotations

from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from _base.auth import current_user
from _base.db import session as db
from etl.queries import hierarchy, sources, tabs

router = APIRouter(prefix="/etl/console", tags=["etl"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _write(claims: dict):
    return db.role_connection("authenticated", claims, write=True)


def _guard(fn, *args):
    try:
        return fn(*args)
    except psycopg.Error as exc:  # the function's / database's message reaches the page
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "insufficient_privilege" in msg or "forbidden" in msg.lower() or "row-level security" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


# --- tabs ------------------------------------------------------------------------------------

@router.get("/ai-cost-events")
def ai_cost_events(since: str | None = None, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(tabs.ai_cost_events, conn, since)


@router.get("/field-yield")
def field_yield(claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(tabs.field_yield, conn)


@router.get("/source-gcids")
def source_gcids(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(tabs.source_gcids, conn)


class FieldFloorIn(BaseModel):
    gcid: str = Field(min_length=1, max_length=200)
    required_keys: list[str] = Field(max_length=200)
    min_fields: int = Field(ge=0)
    min_products: int = Field(ge=0)
    min_licenses: int = Field(ge=0)
    notes: str | None = Field(default=None, max_length=2000)


@router.post("/field-floor")
def set_field_floor(body: FieldFloorIn, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(tabs.set_field_floor, conn, body.model_dump())
    return {"ok": True}


@router.get("/runs")
def runs(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(tabs.runs, conn)


class Ids(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=1000)


@router.post("/source-domains")
def source_domains(body: Ids, claims: dict = Depends(current_user)) -> list:
    if not body.ids:
        return []
    with _read(claims) as conn:
        return _guard(tabs.source_domains, conn, body.ids)


@router.get("/frontier-matrix")
def frontier_matrix(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(tabs.frontier_matrix_rows, conn)


@router.get("/schedules")
def cron_list(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(tabs.cron_list, conn)


class CronSwitch(BaseModel):
    jobname: str = Field(min_length=1, max_length=200)
    active: bool


@router.post("/schedules/active")
def cron_set_active(body: CronSwitch, claims: dict = Depends(current_user)) -> dict:
    # Gated action (switching ETL schedules): the governed, role-checked function decides.
    with _write(claims) as conn:
        _guard(tabs.cron_set_active, conn, body.jobname, body.active)
    return {"ok": True}


@router.get("/stats-sources")
def stats_sources(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(tabs.stats_sources, conn)


@router.get("/source-stats")
def source_stats(gcid: str, source: str | None = None,
                 claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(tabs.source_stats, conn, gcid, source or None)


class ManualCompanies(BaseModel):
    category: str = Field(min_length=1, max_length=200)
    entries: list[str] = Field(max_length=500)


@router.post("/companies/manual")
def add_companies_manual(body: ManualCompanies, claims: dict = Depends(current_user)) -> Any:
    with _write(claims) as conn:
        return _guard(tabs.add_companies_manual, conn, body.category, body.entries)


# --- hierarchy -------------------------------------------------------------------------------

class HierFilters(BaseModel):
    gcid: str | None = None
    source: str | None = None
    brand: str | None = None
    office: str | None = None
    type: str | None = None
    claim: str | None = None
    q: str | None = Field(default=None, max_length=200)


class HierTableIn(BaseModel):
    filters: HierFilters = Field(default_factory=HierFilters)
    page: int = Field(1, ge=1, le=100_000)
    sort: Literal["name", "type", "confidence", "created"] = "created"
    dir: Literal["asc", "desc"] = "desc"


@router.get("/hierarchy/sources")
def hier_sources(claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(hierarchy.sources, conn)


@router.get("/hierarchy/category-search")
def hier_category_search(term: str = Query(min_length=2, max_length=100),
                         claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(hierarchy.category_search, conn, term)


@router.get("/hierarchy/brands")
def hier_brands(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(hierarchy.brands, conn)


class Gcids(BaseModel):
    gcids: list[str] = Field(default_factory=list, max_length=1000)


@router.post("/hierarchy/category-labels")
def hier_labels(body: Gcids, claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(hierarchy.gcid_labels, conn, body.gcids)


@router.post("/hierarchy/table")
def hier_table(body: HierTableIn, claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(hierarchy.table, conn, body.filters.model_dump(), body.page, body.sort,
                      body.dir)


@router.post("/hierarchy/counts")
def hier_counts(body: HierFilters, claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(hierarchy.type_counts, conn, body.model_dump())


@router.get("/hierarchy/tree/advisors")
def hier_tree_advisors(office: str | None = None, unofficed_brand: str | None = None,
                       page: int = Query(1, ge=1), claims: dict = Depends(current_user)) -> dict:
    if not office and not unofficed_brand:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "office or unofficed_brand is required")
    with _read(claims) as conn:
        return _guard(hierarchy.tree_advisors, conn, office, unofficed_brand, page)


@router.get("/hierarchy/tree/offices")
def hier_tree_offices(brand: str, page: int = Query(1, ge=1),
                      claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(hierarchy.tree_offices, conn, brand, page)


@router.get("/hierarchy/office-name")
def hier_office_name(office: str, claims: dict = Depends(current_user)) -> dict | None:
    with _read(claims) as conn:
        return _guard(hierarchy.office_name, conn, office)


@router.get("/hierarchy/entities/{entity_id}")
def hier_entity(entity_id: str, claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(hierarchy.entity_detail, conn, entity_id)


# --- group 2: governed writes ----------------------------------------------------------------


class RpcArgs(BaseModel):
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: RpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed ETL function (sources.ETL_RPCS). Several are gated actions (run, reharvest,
    activate, discover); the role-checked functions decide, as they did for the browser."""
    try:
        with _write(claims) as conn:
            return _guard(sources.call_rpc, conn, name, body.args)
    except sources.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


class SourceId(BaseModel):
    source_id: str


@router.post("/sources/run")
def run_source(body: SourceId, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        return _guard(sources.run_source, conn, body.source_id)


# --- group 2: pipeline -----------------------------------------------------------------------

class StageFilters(BaseModel):
    gcid: str | None = None
    source_id: str | None = None
    status: str | None = None


class StagePage(StageFilters):
    page: int = Field(0, ge=0, le=100_000)


@router.get("/pipeline/sources")
def pipeline_sources(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.pipeline_sources, conn)


@router.post("/pipeline/staging-gcids")
def staging_gcids(body: Gcids, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.staging_gcids, conn, body.gcids)


@router.post("/pipeline/funnel")
def funnel(body: StageFilters, claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(sources.funnel, conn, body.model_dump())


@router.get("/pipeline/source-domains")
def pipeline_source_domains(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.source_domain_rows, conn)


@router.post("/pipeline/page")
def staging_page(body: StagePage, claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(sources.staging_page, conn, body.model_dump(), body.page)


# --- group 2: site contract + proposals --------------------------------------------------------

@router.get("/site-contract")
def site_contract(domain: str, gcid: str, source_id: str,
                  claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(sources.site_contract, conn, domain, gcid, source_id)


@router.get("/site-proposals")
def site_proposals(domain: str, gcid: str, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.site_proposals, conn, domain, gcid)


@router.get("/accept-harvest-state")
def accept_harvest_state(domain: str, gcid: str,
                         claims: dict = Depends(current_user)) -> dict | None:
    with _read(claims) as conn:
        return _guard(sources.accept_harvest_state, conn, domain, gcid)


# --- group 2: source states, registry -----------------------------------------------------------

class StateSource(BaseModel):
    source_id: str
    source_domain: str


class StatesIn(BaseModel):
    sources: list[StateSource] = Field(max_length=1000)


@router.post("/source-states")
def source_states(body: StatesIn, claims: dict = Depends(current_user)) -> dict:
    ids = sorted({s.source_id for s in body.sources})
    domains = list(dict.fromkeys(s.source_domain for s in body.sources))
    with _read(claims) as conn:
        rows = _guard(sources.source_state_rows, conn, ids, domains)
        open_ids = set(rows.pop("openRunSourceIds"))
        running = list(dict.fromkeys(s.source_domain for s in body.sources
                                     if s.source_id in open_ids))
        rows["queuedByDomain"] = _guard(sources.queued_pages, conn, running) if running else {}
    return rows


class Domains(BaseModel):
    domains: list[str] = Field(default_factory=list, max_length=1000)


@router.post("/done-pages")
def done_pages(body: Domains, claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(sources.done_pages, conn, body.domains)


@router.get("/registry/sources")
def registry_sources(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.registry_sources, conn)


class RequestIds(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=1000)


@router.post("/requests/status")
def request_statuses(body: RequestIds, claims: dict = Depends(current_user)) -> list:
    if not body.ids:
        return []
    with _read(claims) as conn:
        return _guard(sources.request_statuses, conn, body.ids)


@router.get("/registry/field-floors")
def contract_field_floors(claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.contract_field_floors, conn)


# --- group 2: category population --------------------------------------------------------------

@router.get("/population/category-search")
def population_category_search(q: str = Query(min_length=2, max_length=200),
                               claims: dict = Depends(current_user)) -> dict:
    with _read(claims) as conn:
        return _guard(sources.category_search, conn, q)


@router.get("/population/job")
def population_job(gcid: str, claims: dict = Depends(current_user)) -> dict | None:
    with _read(claims) as conn:
        return _guard(sources.population_job, conn, gcid)


@router.get("/population/sources")
def population_sources(gcid: str, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.population_sources, conn, gcid)


@router.get("/population/proposal")
def population_proposal(gcid: str, claims: dict = Depends(current_user)) -> dict | None:
    with _read(claims) as conn:
        return _guard(sources.population_proposal, conn, gcid)


@router.post("/population/runs")
def population_runs(body: Ids, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.population_runs, conn, body.ids)


@router.post("/population/staged")
def population_staged(body: Ids, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.population_staged, conn, body.ids)


@router.get("/population/site-contracts")
def population_contracts(gcid: str, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.population_contracts, conn, gcid)


@router.get("/population/map-attempts")
def population_map_attempts(gcid: str, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.map_attempts, conn, gcid)


@router.get("/population/method-attempts")
def population_method_attempts(gcid: str, claims: dict = Depends(current_user)) -> list:
    with _read(claims) as conn:
        return _guard(sources.method_attempts, conn, gcid)


@router.get("/population/discover-running")
def population_discover_running(gcid: str, claims: dict = Depends(current_user)) -> bool:
    with _read(claims) as conn:
        return _guard(sources.discover_running, conn, gcid)
