"""VOCE articles — replaces the direct supabase-js calls in surface-ui/_base/src/lib/voce.ts.

The profile, topic-hub and /find reads are public pages: they run as the visitor (`anon` when
signed out, the user otherwise), and so does the boost manager's list. RLS decides, as it did for
the browser. Where the TS ignored an error (the public reads) the endpoint returns no rows; the
boost manager's errors reach the page. The boost update moved to the admin Surface
(PATCH /admin/search-console/voce/articles/{id}, surface audit 2026-10-25).
"""
from __future__ import annotations

import logging
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.db import session as db
from _base.server_fn import optional_user
from search.queries import voce as q

log = logging.getLogger(__name__)

router = APIRouter(prefix="/search/voce", tags=["search"])


def _visitor(claims: dict | None):
    if claims is None:
        return db.role_connection("anon")
    return db.role_connection("authenticated", claims)


def _public_rows(claims: dict | None, stmt: Any) -> list[dict[str, Any]]:
    """`if (error) return []`, as the public loaders did."""
    try:
        with _visitor(claims) as conn:
            return q.rows(conn, stmt)
    except psycopg.Error as exc:
        log.warning("voce read failed: %s", type(exc).__name__)
        return []


def _db_error(exc: psycopg.Error) -> HTTPException:
    msg = (exc.diag.message_primary if exc.diag else None) or "Request failed"
    refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or "row-level security" in msg
    return HTTPException(status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST, msg)


@router.get("/author")
def author_articles(entity_id: str = Query(max_length=100),
                    author_name: str | None = Query(None, max_length=300),
                    claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    """loadAuthorArticles(): rows by author id or (cleaned) author name, newest 24."""
    return _public_rows(claims, q.author_stmt(entity_id, author_name))


@router.get("/hub")
def hub_articles(gcid: str = Query(max_length=200), topic: str | None = Query(None, max_length=200),
                 claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    """loadHubArticles(): a category's (and topic's) rows, newest 60."""
    return _public_rows(claims, q.hub_stmt(gcid, topic))


@router.get("/featured")
def featured_candidates(gcid: str | None = Query(None, max_length=200),
                        claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    """loadFeaturedArticle(): the boosted rows it picks from (60)."""
    return _public_rows(claims, q.featured_stmt(gcid))


@router.get("/articles")
def all_articles(claims: dict | None = Depends(optional_user)) -> list[dict[str, Any]]:
    """loadAllArticles(): every row the caller may read, newest first (1000-row cap). The page is
    signed-in only, but like the browser client this runs as anon without a token (RLS: the
    published rows)."""
    try:
        with _visitor(claims) as conn:
            return q.rows(conn, q.all_stmt())
    except psycopg.Error as exc:
        raise _db_error(exc) from exc

