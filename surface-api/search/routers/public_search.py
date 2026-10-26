"""Public search — replaces the direct supabase-js RPCs in surface-ui/_base/src/lib/search.ts
(home search, /find, city pages, topic hubs).

Runs as the visitor: `anon` when signed out, the signed-in user otherwise, exactly as the
browser's Supabase client did. Errors reach the page the way supabase-js returned them: in
runSearch's `error` field, and not at all for suggest.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from _base.db import session as db
from _base.server_fn import optional_user
from search.queries import public_search as q

router = APIRouter(prefix="/search/public", tags=["search"])


def _visitor(claims: dict | None):
    if claims is None:
        return db.role_connection("anon")
    return db.role_connection("authenticated", claims)


@router.get("/results")
def results(
    p_q: str | None = Query(None, max_length=500),
    p_gcid: str | None = Query(None, max_length=200),
    p_loc: str | None = Query(None, max_length=200),
    p_min_rating: float | None = Query(None, ge=0, le=5),
    p_claimed: bool | None = None,
    p_sort: str | None = Query(None, max_length=40),
    p_limit: int | None = Query(None, ge=0, le=1000),
    p_offset: int | None = Query(None, ge=0),
    claims: dict | None = Depends(optional_user),
) -> dict[str, Any]:
    """runSearch(): {rows, count, facets, error} — search_docs' page, search_docs_count and
    search_docs_facets for the same filters (null data where a call failed; error = the first
    failure's message, as the TS picked it)."""
    filters = {"p_q": p_q, "p_gcid": p_gcid, "p_loc": p_loc, "p_min_rating": p_min_rating,
               "p_claimed": p_claimed}
    page = {"p_sort": p_sort, "p_limit": p_limit, "p_offset": p_offset}
    with _visitor(claims) as conn:
        return q.run_search(conn, filters, page)


@router.get("/suggest")
def suggest(p_q: str = Query(min_length=1, max_length=200),
            p_limit: int = Query(8, ge=1, le=1000),
            claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    """suggest(): search_docs_suggest rows (none when the call failed)."""
    with _visitor(claims) as conn:
        return q.suggest(conn, p_q, p_limit)
