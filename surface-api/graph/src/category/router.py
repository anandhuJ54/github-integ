"""graph /categories pages data — replaces the direct supabase-js calls in
surface-ui/graph (categories index, category detail and its tabs, listings catalog).

Runs as the signed-in user, so RLS decides exactly as it did for the browser. The writes are
the browser's own statements (ruling 2026-10-24): each request model allow-lists the columns
the page sent, and only the keys the page sent are written (as PostgREST did).
"""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.graph.category import services as q
from surfaces.graph.category.schemas import (
    CategoryAiAgentsIn,
    CategoryChildrenIn,
    CategoryNewNodeIn,
    CategoryNodeIn,
    CategoryPatch,
    CategoryReorderIn,
    CategoryRuleActiveIn,
    CategoryRuleIn,
    CategoryTaxReorderIn,
    CategoryTermIn,
)

router = APIRouter(prefix="/graph/categories", tags=["graph"])

Gcid = Query(min_length=1, max_length=200)


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _write(claims: dict):
    return db.role_connection("authenticated", claims, write=True)


def _guard(fn, *args):
    try:
        return fn(*args)
    except q.MultipleRows as exc:  # PostgREST answered `.maybeSingle()` on 2+ rows with 406
        raise HTTPException(status.HTTP_406_NOT_ACCEPTABLE, str(exc)) from exc
    except psycopg.Error as exc:  # the database's message reaches the page
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with _read(claims) as conn:
        return _guard(fn, conn, *args)


def _write_with(claims: dict, fn, *args) -> dict:
    with _write(claims) as conn:
        _guard(fn, conn, *args)
    return {"ok": True}


# --- categories index ----------------------------------------------------------------------

@router.get("/stats")
def stats(claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, q.stats)


@router.get("/list")
def categories(search: str = Query("", max_length=200), sort: q.SortKey = "display_name",
               asc: bool = True, claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.categories, search, sort, asc)


@router.post("/children")
def children(body: CategoryChildrenIn, claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.children, body.gcids, body.view)


# --- category detail -----------------------------------------------------------------------

@router.get("/detail")
def detail(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, q.detail, gcid)


@router.patch("/category")
def set_category(body: CategoryPatch, claims: dict = Depends(current_user)) -> dict:
    patch = body.sent()
    gcid = patch.pop("gcid")
    return _write_with(claims, q.set_category, gcid, patch)


# --- compliance tab ------------------------------------------------------------------------

@router.get("/compliance")
def compliance(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, q.compliance, gcid)


@router.get("/compliance-rules")
def compliance_rules(gcid: str = Gcid, claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.compliance_rules, gcid)


@router.post("/compliance-rules")
def add_rule(body: CategoryRuleIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.add_rule, body.sent())


@router.patch("/compliance-rules/{rule_id}")
def update_rule(rule_id: str, body: CategoryRuleIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_rule, rule_id, body.sent())


@router.patch("/compliance-rules/{rule_id}/active")
def set_rule_active(rule_id: str, body: CategoryRuleActiveIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.set_rule_active, rule_id, body.is_active)


@router.delete("/compliance-rules/{rule_id}")
def delete_rule(rule_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete_rule, rule_id)


# --- AI config tab -------------------------------------------------------------------------

@router.get("/ai-config/knowledge")
def ai_knowledge(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, q.ai_knowledge, gcid)


@router.get("/ai-config/compliance")
def ai_compliance(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, q.ai_compliance, gcid)


@router.post("/ai-config")
def set_ai_agents(body: CategoryAiAgentsIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.set_ai_agents, body.gcid, body.ai_agents)


# --- node registry tab ---------------------------------------------------------------------

@router.get("/rings")
def rings(claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.rings)


@router.get("/entity-type")
def entity_type(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, q.entity_type, gcid)


@router.get("/schema-type")
def schema_type(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, q.schema_type, gcid)


@router.get("/schema-ring-map")
def schema_ring_map(schema_type: str = Query(min_length=1, max_length=200),
                    claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.schema_ring_map, schema_type)


@router.get("/node-registry")
def node_registry(gcid: str = Gcid, claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.node_registry, gcid)


@router.post("/node-registry")
def add_node(body: CategoryNewNodeIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.add_node, body.sent())


@router.patch("/node-registry/{node_id}")
def update_node(node_id: str, body: CategoryNodeIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_node, node_id, body.sent())


@router.delete("/node-registry/{node_id}")
def delete_node(node_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete_node, node_id)


@router.post("/node-registry/reorder")
def reorder_nodes(body: CategoryReorderIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.reorder_nodes, [u.model_dump() for u in body.updates])


# --- operations / schema tabs --------------------------------------------------------------

@router.get("/operations/nodes")
def operation_nodes(gcid: str = Gcid, claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.operation_nodes, gcid)


@router.get("/schema")
def stored_schema(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict | None:
    return _read_with(claims, q.stored_schema, gcid)


@router.get("/schema/registry")
def schema_registry(gcid: str = Gcid, claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.schema_registry, gcid)


# --- listings tab + catalog ----------------------------------------------------------------

@router.get("/listings")
def listings(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, q.listings, gcid)


@router.get("/listings/catalog")
def catalog(catalog_version: str = Query(min_length=1, max_length=200),
            claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, q.catalog, catalog_version)


# --- scoring tab ---------------------------------------------------------------------------

@router.get("/scoring")
def scoring(gcid: str = Gcid, claims: dict = Depends(current_user)) -> dict:
    return _read_with(claims, q.scoring, gcid)


# --- taxonomy tab --------------------------------------------------------------------------

@router.get("/taxonomy")
def taxonomy(gcid: str = Gcid, claims: dict = Depends(current_user)) -> list:
    return _read_with(claims, q.taxonomy, gcid)


@router.post("/taxonomy/reorder")
def reorder_taxonomy(body: CategoryTaxReorderIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.reorder_taxonomy, body.gcid,
                       [u.model_dump() for u in body.updates])


@router.post("/taxonomy")
def add_term(body: CategoryTermIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.add_term, body.sent())


@router.patch("/taxonomy/{term_id}")
def update_term(term_id: str, body: CategoryTermIn, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.update_term, term_id, body.sent())


@router.delete("/taxonomy/{term_id}")
def delete_term(term_id: str, claims: dict = Depends(current_user)) -> dict:
    return _write_with(claims, q.delete_term, term_id)
