"""VOCE article reads — port of the supabase-js calls in
surface-ui/_base/src/lib/voce.ts. The page logic (featured ordering, boost windows, matching)
stays in TypeScript; these return the rows each query returned.

RLS decides, as it did for the browser: published articles are readable by anon and
authenticated, staff (super_admin/architect/analyst) read all. The boost update moved to
admin/queries/voce_boost.py (surface audit 2026-10-25).
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import or_, select

from _base.db.sql import fetch_all, typed
from _base.db.tables import t_exp_voce_article as voce_t

COLS = ("id, title, slug, body_excerpt, author_entity_type, author_entity_id, author_name, gcid, "
        "topic, knows_about, published_on, boosted, boost_placements, boost_starts_on, "
        "boost_ends_on, boost_spend, is_demo")


def _select() -> Any:
    return select(*[voce_t.c[n.strip()] for n in COLS.split(",")])


def author_stmt(entity_id: str, author_name: str | None) -> Any:
    """loadAuthorArticles(): `.or(author_entity_id.eq.X[,author_name.eq.Y])`, newest 24.
    `author_name` arrives already cleaned the way the TS cleaned it for the filter string."""
    c = voce_t.c
    cond = [c.author_entity_id == typed(c.author_entity_id, entity_id)]
    if author_name:
        cond.append(c.author_name == author_name)
    return _select().where(or_(*cond)).order_by(c.published_on.desc()).limit(24)


def hub_stmt(gcid: str, topic: str | None) -> Any:
    """loadHubArticles(): a category's (and topic's) articles, newest 60."""
    c = voce_t.c
    stmt = _select().where(c.gcid == gcid)
    if topic:
        stmt = stmt.where(c.topic == topic)
    return stmt.order_by(c.published_on.desc()).limit(60)


def featured_stmt(gcid: str | None) -> Any:
    """loadFeaturedArticle(): boosted articles (optionally of one category), 60, unordered as
    in the TS."""
    c = voce_t.c
    stmt = _select().where(c.boosted.is_(True))
    if gcid:
        stmt = stmt.where(c.gcid == gcid)
    return stmt.limit(60)


def all_stmt() -> Any:
    """loadAllArticles(): every article, newest first, nulls last (1000-row cap)."""
    return _select().order_by(voce_t.c.published_on.desc().nulls_last())


def rows(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    return fetch_all(conn, stmt)

