"""graph entity pages data — replaces the direct supabase-js calls in surface-ui/graph for
/control-graph and the public /p|o|c/:slug/graph pages.

/control-graph runs as the signed-in user; the public expertise graph runs as
the visitor (`anon` when signed out). RLS and the role-checked functions decide, as they did for
the browser. Reads keep the 1000-row PostgREST cap except the expertise graph (ruling 2026-10-24).

Surface audit 2026-10-25: the expertise graph pages now live in surface-ui/search (this API stays
here, published for search); the profile page's reads (/graph/profile/*, /graph/profile-services)
moved to search with the page (/search/profile-page/*, search/routers/profile_page.py); the
/control-graph Claims tab and its endpoints moved to
admin (/admin/control-claims, admin/routers/control_claims.py).
"""
from __future__ import annotations

from typing import Any, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from _base.db.sql import fetch_all
from _base.server_fn import optional_user
from surfaces.graph.entity import services as q
from surfaces.graph.entity.schemas import (
    RpcArgs,
)

router = APIRouter(prefix="/graph", tags=["graph"])


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _visitor(claims: dict | None):
    if claims is None:
        return db.role_connection("anon")
    return db.role_connection("authenticated", claims)


def _guard(fn, *args):
    try:
        return fn(*args)
    except q.MultipleRows as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except psycopg.Error as exc:  # the function's / database's message reaches the page
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "insufficient_privilege" in msg or "forbidden" in msg.lower() or "row-level security" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _rows(claims: dict, stmt: Any) -> list[dict[str, Any]]:
    with _read(claims) as conn:
        return _guard(fetch_all, conn, stmt)


# --- /control-graph ----------------------------------------------------------------------------

@router.get("/control/validate")
def validate_graph(claims: dict = Depends(current_user)) -> list:
    """graph-health-card.tsx: exp_validate_graph()."""
    with _read(claims) as conn:
        return _guard(q.validate_graph, conn)


@router.get("/control/nodes")
def control_nodes(claims: dict = Depends(current_user)) -> list:
    return _rows(claims, q.control_nodes_stmt())


@router.get("/control/brands")
def control_brands(claims: dict = Depends(current_user)) -> list:
    return _rows(claims, q.brands_stmt())


@router.get("/control/entities")
def control_entities(claims: dict = Depends(current_user)) -> list:
    return _rows(claims, q.entities_stmt())


@router.get("/control/entities/{entity_id}/relationships")
def control_relationships(entity_id: str, claims: dict = Depends(current_user)) -> list:
    return _rows(claims, q.relationships_stmt(entity_id))


@router.post("/control/rpc/{name}")
def call_rpc(name: str, body: RpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed governed write (q.GRAPH_RPCS): control-tree nodes, expected volume.
    The role-checked functions decide, as they did for the browser."""
    try:
        q.rpc_sql(name, body.args)  # refuse before leasing a connection
    except q.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args)


# --- /p|o|c/:slug/graph (public) ---------------------------------------------------------------

@router.get("/expertise/{kind}/{slug}")
def expertise_graph(kind: Literal["professional", "office", "company"], slug: str,
                    claims: dict | None = Depends(optional_user)) -> dict | None:
    """loadExpertiseGraph(): null when the slug resolves to nothing (the page shows not found)."""
    with _visitor(claims) as conn:
        return _guard(q.expertise_graph, conn, kind, slug)
