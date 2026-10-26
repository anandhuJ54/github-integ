"""Build wiki (/build/spaces/...) — port of surface-ui/ops/src/lib/build-wiki.ts.

Runs as the signed-in user; exp_wiki_* RLS decides access (SF-5). Who-fields (author, user_ref)
are the signed-in user's email, else their id, as currentUserRef() gave.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

import psycopg
from sqlalchemy import delete, func, insert, select, update
from surfaces.ops.queries.dev import _exec

from _base.db import tables as T
from _base.db.sql import fetch_many

spaces_t, docs_t = T.t_exp_wiki_spaces, T.t_exp_wiki_docs
comments_t, revisions_t, watchers_t = T.t_exp_wiki_comments, T.t_exp_wiki_revisions, \
    T.t_exp_wiki_watchers

DOC_LIST_COLS = ("id", "slug", "title", "category", "tags", "summary", "status", "author",
                 "is_pinned", "sort_order", "word_count", "created_at", "updated_at", "space_id",
                 "parent_id")
# updateDoc's patch type in build-wiki.ts
DOC_PATCH_COLS = frozenset({"title", "body_md", "category", "tags", "summary", "parent_id",
                            "is_pinned"})


class MultipleRows(RuntimeError):
    """`.maybeSingle()` with `must()`: more than one row is an error."""


def _one(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(rows) > 1:
        raise MultipleRows("JSON object requested, multiple (or no) rows returned")
    return rows[0] if rows else None


def slugify(s: str) -> str:
    """slugify() in build-wiki.ts."""
    t = unicodedata.normalize("NFKD", s.lower())
    t = re.sub(r"[^a-z0-9]+", "-", t)
    t = re.sub(r"^-+|-+$", "", t)
    return t[:80] or "page"


def spaces(conn: psycopg.Connection) -> dict[str, Any]:
    """listSpaces' reads: active spaces in order, and every doc's space_id (the page counts)."""
    s = spaces_t.c
    return fetch_many(conn, {
        "spaces": select(spaces_t).where(s.is_archived.is_(False)).order_by(s.sort_order, s.name),
        "docs": select(docs_t.c.space_id).where(docs_t.c.space_id.is_not(None)),
    })


def space(conn: psycopg.Connection, key: str) -> dict[str, Any] | None:
    return _one(fetch_many(conn, {"s": select(spaces_t).where(spaces_t.c.key == key)
                                  .limit(2)})["s"])


def space_docs(conn: psycopg.Connection, space_id: str) -> list[dict[str, Any]]:
    stmt = select(*(docs_t.c[k] for k in DOC_LIST_COLS)).where(docs_t.c.space_id == space_id)
    return fetch_many(conn, {"d": stmt})["d"]


def doc(conn: psycopg.Connection, space_id: str, slug: str) -> dict[str, Any] | None:
    stmt = select(docs_t).where(docs_t.c.space_id == space_id, docs_t.c.slug == slug).limit(2)
    return _one(fetch_many(conn, {"d": stmt})["d"])


def comments(conn: psycopg.Connection, doc_id: str) -> list[dict[str, Any]]:
    stmt = select(comments_t).where(comments_t.c.doc_id == doc_id) \
        .order_by(comments_t.c.created_at)
    return fetch_many(conn, {"c": stmt})["c"]


def revisions(conn: psycopg.Connection, doc_id: str) -> list[dict[str, Any]]:
    stmt = select(revisions_t).where(revisions_t.c.doc_id == doc_id) \
        .order_by(revisions_t.c.created_at.desc())
    return fetch_many(conn, {"r": stmt})["r"]


def search(conn: psycopg.Connection, q: str) -> list[dict[str, Any]]:
    """`.textSearch("search_tsv", q, { type: "websearch" })` with the space embedded."""
    d, s = docs_t.c, spaces_t.c
    stmt = (
        select(d.id, d.slug, d.title, d.summary, d.body_md, s.key.label("space_key"),
               s.name.label("space_name"), s.id.label("space_row"))
        .select_from(docs_t.outerjoin(spaces_t, d.space_id == s.id))
        .where(d.search_tsv.op("@@")(func.websearch_to_tsquery(q)))
        .limit(20)
    )
    out = []
    for r in fetch_many(conn, {"s": stmt})["s"]:
        space_row = {"key": r.pop("space_key"), "name": r.pop("space_name")} \
            if r.pop("space_row") is not None else None
        out.append({**r, "exp_wiki_spaces": space_row})
    return out


def _watch_filter(user_ref: str, doc_id: str | None, space_id: str | None) -> list[Any]:
    w = watchers_t.c
    return [w.user_ref == user_ref, (w.doc_id == doc_id) if doc_id else (w.space_id == space_id)]


def is_watching(conn: psycopg.Connection, user_ref: str, doc_id: str | None,
                space_id: str | None) -> bool:
    stmt = select(watchers_t.c.id).where(*_watch_filter(user_ref, doc_id, space_id)).limit(1)
    return bool(fetch_many(conn, {"w": stmt})["w"])


# --- writes ----------------------------------------------------------------------------------

def create_doc(conn: psycopg.Connection, author: str, space_id: str, parent_id: str | None,
               title: str) -> dict[str, Any]:
    base = slugify(title)
    # as the TS: the taken slugs are any that start with the base, across all spaces
    taken = {r["slug"] for r in fetch_many(conn, {"t": select(docs_t.c.slug)
                                                  .where(docs_t.c.slug.like(f"{base}%"))},
                                           )["t"]}
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    rows = _exec(conn, insert(docs_t).values(slug=slug, title=title, space_id=space_id,
                                             parent_id=parent_id, body_md="", author=author,
                                             status="draft").returning(*docs_t.c))
    return rows[0]


def update_doc(conn: psycopg.Connection, doc_id: str, patch: dict[str, Any]) -> None:
    unknown = set(patch) - DOC_PATCH_COLS
    if unknown or not patch:
        raise ValueError(f"unknown or empty patch {sorted(unknown)}")
    _exec(conn, update(docs_t).where(docs_t.c.id == doc_id).values(**patch))


def add_comment(conn: psycopg.Connection, author: str, doc_id: str, body: str,
                parent_id: str | None) -> None:
    _exec(conn, insert(comments_t).values(doc_id=doc_id, body=body, parent_id=parent_id,
                                          author=author))


def resolve_comment(conn: psycopg.Connection, comment_id: str, resolved: bool) -> None:
    _exec(conn, update(comments_t).where(comments_t.c.id == comment_id)
          .values(resolved=resolved))


def toggle_watch(conn: psycopg.Connection, user_ref: str, doc_id: str | None,
                 space_id: str | None) -> bool:
    """Watching after the toggle: removes the user's watch rows if any, else adds one."""
    rows = fetch_many(conn, {"w": select(watchers_t.c.id)
                             .where(*_watch_filter(user_ref, doc_id, space_id))})["w"]
    if rows:
        _exec(conn, delete(watchers_t).where(watchers_t.c.id.in_([r["id"] for r in rows])))
        return False
    _exec(conn, insert(watchers_t).values(user_ref=user_ref, doc_id=doc_id, space_id=space_id))
    return True
