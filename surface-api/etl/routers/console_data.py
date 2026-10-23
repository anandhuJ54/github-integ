"""ETL /discovery console data (group 1: AI cost, field yield, required fields, runs, schedules,
source stats, manual company add, hierarchy, entity panel) — replaces the direct supabase-js reads
and RPCs in surface-ui/etl/src/components/discovery. Runs as the signed-in user, so RLS and the
role-checked SECURITY DEFINER functions decide access, as they did for the browser."""
from __future__ import annotations

from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from _base.core import db
from _base.core.auth import current_user
from etl.queries import hierarchy, tabs

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
        code = status.HTTP_403_FORBIDDEN if "forbidden" in msg.lower() or \
            "row-level security" in msg else status.HTTP_400_BAD_REQUEST
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
