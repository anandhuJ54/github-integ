"""Ops pages' data — replaces the direct supabase-js reads/writes in surface-ui/ops: the dev
tracker (/dev, /build/teams, /dev/weekly, /dev/board), the build wiki (/build/spaces) and the
console home (/console).

Everything runs as the signed-in user (role `authenticated`), so the exp_dev_* / exp_wiki_* /
exp_contracts RLS decides access exactly as it did for the browser. Who-fields (author, updated_by,
submitted_by, voter, user_ref) are set here from the verified login: the user's email, else their
id — the value the page used to send itself.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from _base.core import db
from _base.core.auth import current_user
from ops.queries import console, dev, wiki

router = APIRouter(prefix="/ops", tags=["ops"])


def who(claims: dict) -> str:
    """currentVoter() / currentUserRef(): the signed-in user's email, else their id."""
    return str(claims.get("email") or claims.get("sub") or "unknown")


def _read(claims: dict):
    return db.role_connection("authenticated", claims)


def _write(claims: dict):
    return db.role_connection("authenticated", claims, write=True)


def _db_error(exc: psycopg.Error) -> HTTPException:
    """The database's message reaches the page, as supabase-js `error.message` did."""
    msg = (exc.diag.message_primary if exc.diag else None) or "Request failed"
    code = status.HTTP_403_FORBIDDEN if "row-level security" in msg \
        else status.HTTP_400_BAD_REQUEST
    return HTTPException(code, msg)


def _guard(fn, *args):
    try:
        return fn(*args)
    except (dev.BadInput, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except wiki.MultipleRows as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except psycopg.Error as exc:
        raise _db_error(exc) from exc


# --- dev tracker reads ------------------------------------------------------------------------

@router.get("/dev/overview")
def dev_overview(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(dev.overview, conn)


@router.get("/dev/teams/{team_id}")
def dev_team(team_id: str, claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(dev.team, conn, team_id, who(claims))


@router.get("/dev/open-gates")
def dev_open_gates(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(dev.open_gate_rows, conn)


@router.get("/dev/board")
def dev_board(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(dev.board, conn)


@router.get("/dev/weekly")
def dev_weekly(week_start: str = Query(min_length=10, max_length=10),
               claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(dev.weekly, conn, week_start)


# --- dev tracker writes -----------------------------------------------------------------------

Row = dict[str, Any]


@router.post("/dev/{entity}")
def dev_insert(entity: str, row: Row, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        return {"id": _guard(dev.insert_row, conn, entity, row, who(claims))}


@router.patch("/dev/{entity}/{row_id}")
def dev_update(entity: str, row_id: str, patch: Row,
               claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(dev.update_row, conn, entity, row_id, patch, who(claims))
    return {"ok": True}


@router.delete("/dev/{entity}/{row_id}")
def dev_delete(entity: str, row_id: str, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(dev.delete_row, conn, entity, row_id)
    return {"ok": True}


@router.put("/dev/weekly-updates")
def dev_submit_weekly(row: Row, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(dev.submit_weekly, conn, row)
    return {"ok": True}


@router.post("/dev/ideas/{idea_id}/vote")
def dev_vote(idea_id: str, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        return {"result": _guard(dev.vote_idea, conn, idea_id, who(claims))}


# --- wiki ------------------------------------------------------------------------------------

class WatchTarget(BaseModel):
    doc_id: str | None = None
    space_id: str | None = None


class NewDoc(BaseModel):
    space_id: str
    parent_id: str | None = None
    title: str = Field(min_length=1, max_length=300)


class NewComment(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    parent_id: str | None = None


class Resolved(BaseModel):
    resolved: bool = True


@router.get("/wiki/spaces")
def wiki_spaces(claims: dict = Depends(current_user)) -> dict[str, Any]:
    with _read(claims) as conn:
        return _guard(wiki.spaces, conn)


@router.get("/wiki/spaces/{key}")
def wiki_space(key: str, claims: dict = Depends(current_user)) -> dict | None:
    with _read(claims) as conn:
        return _guard(wiki.space, conn, key)


@router.get("/wiki/spaces/{space_id}/docs")
def wiki_space_docs(space_id: str, claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(wiki.space_docs, conn, space_id)


@router.get("/wiki/doc")
def wiki_doc(space_id: str, slug: str, claims: dict = Depends(current_user)) -> dict | None:
    with _read(claims) as conn:
        return _guard(wiki.doc, conn, space_id, slug)


@router.get("/wiki/docs/{doc_id}/comments")
def wiki_comments(doc_id: str, claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(wiki.comments, conn, doc_id)


@router.get("/wiki/docs/{doc_id}/revisions")
def wiki_revisions(doc_id: str, claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(wiki.revisions, conn, doc_id)


@router.get("/wiki/search")
def wiki_search(q: str = Query(max_length=500), claims: dict = Depends(current_user)) -> list:
    if not q.strip():
        return []
    with _read(claims) as conn:
        return _guard(wiki.search, conn, q)


@router.get("/wiki/watching")
def wiki_watching(doc_id: str | None = None, space_id: str | None = None,
                  claims: dict = Depends(current_user)) -> bool:
    with _read(claims) as conn:
        return _guard(wiki.is_watching, conn, who(claims), doc_id, space_id)


@router.post("/wiki/docs")
def wiki_create_doc(body: NewDoc, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        return _guard(wiki.create_doc, conn, who(claims), body.space_id, body.parent_id,
                      body.title)


@router.patch("/wiki/docs/{doc_id}")
def wiki_update_doc(doc_id: str, patch: Row, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(wiki.update_doc, conn, doc_id, patch)
    return {"ok": True}


@router.post("/wiki/docs/{doc_id}/comments")
def wiki_add_comment(doc_id: str, body: NewComment,
                     claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(wiki.add_comment, conn, who(claims), doc_id, body.body, body.parent_id)
    return {"ok": True}


@router.patch("/wiki/comments/{comment_id}")
def wiki_resolve(comment_id: str, body: Resolved, claims: dict = Depends(current_user)) -> dict:
    with _write(claims) as conn:
        _guard(wiki.resolve_comment, conn, comment_id, body.resolved)
    return {"ok": True}


@router.post("/wiki/watch")
def wiki_toggle_watch(body: WatchTarget, claims: dict = Depends(current_user)) -> bool:
    with _write(claims) as conn:
        return _guard(wiki.toggle_watch, conn, who(claims), body.doc_id, body.space_id)


# --- console home -----------------------------------------------------------------------------

@router.get("/console/profiles")
def console_profiles(d7: str, d14: str, today: str,
                     claims: dict = Depends(current_user)) -> dict[str, int]:
    with _read(claims) as conn:
        return _guard(console.profiles, conn, d7, d14, today)


@router.get("/console/revenue")
def console_revenue(claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(console.revenue, conn)


@router.get("/console/categories")
def console_categories(today: str, claims: dict = Depends(current_user)) -> dict[str, int]:
    with _read(claims) as conn:
        return _guard(console.categories, conn, today)


@router.get("/console/nora-events")
def console_nora_events(since: str, claims: dict = Depends(current_user)) -> list[dict]:
    with _read(claims) as conn:
        return _guard(console.nora_events, conn, since)
