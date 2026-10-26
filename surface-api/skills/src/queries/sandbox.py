"""NORA sandbox — port of the supabase-js calls in surface-ui/_base/src/lib/nora-sandbox.ts
(exp_nora_state, exp_nora_weights, exp_opportunity_feedback, search_rank_scores and the
exp_entity display names), used by the skills page's sandbox tab (surface-ui/skills).

Runs as the signed-in user, so RLS decides as it did for the browser. Every read but the entity
names threw its error (`must`); the names read ignored it (`res.data ?? []`) and still does. The
names are joined in here (the page's `namesFor`), so a list of up to 1000 ids never travels in a
URL; the rows otherwise keep the PostgREST shape and the 1000-row cap.

The two writes are the browser's statements: update `weight` by key, insert the feedback row
with the sent keys.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select
from surfaces.skills.queries.registry import adapt, execute, maybe_one

from _base.db import tables as T
from _base.db.sql import fetch_all, fetch_many

state = T.t_exp_nora_state
weights = T.t_exp_nora_weights
feedback = T.t_exp_opportunity_feedback
scores = T.t_search_rank_scores
entity = T.t_exp_entity


def list_entities(conn: psycopg.Connection) -> list[dict[str, Any]]:
    c = state.c
    return fetch_all(conn, select(c.entity_ref, c.entity_type, c.name, c.title, c.market,
                                  c.category).order_by(c.name))


def get_state(conn: psycopg.Connection, entity_ref: str) -> dict[str, Any] | None:
    return maybe_one(fetch_all(conn, select(state).where(state.c.entity_ref == entity_ref)
                               .limit(2)))


def list_weights(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return fetch_all(conn, select(weights.c.key, weights.c.weight))


def save_weight(conn: psycopg.Connection, key: str, weight: float) -> None:
    execute(conn, weights.update().where(weights.c.key == key).values(weight=weight))


def list_feedback(conn: psycopg.Connection, entity_id: str) -> list[dict[str, Any]]:
    return fetch_all(conn, select(feedback).where(feedback.c.entity_id == entity_id))


def give_feedback(conn: psycopg.Connection, values: dict[str, Any]) -> None:
    execute(conn, feedback.insert().values(**adapt(feedback, values))
            .returning(feedback.c.entity_id))


def names_for(conn: psycopg.Connection, ids: list[str]) -> dict[str, str]:
    """namesFor: entity_id → display_name, error ignored (an id that isn't a uuid, say)."""
    if not ids:
        return {}
    rows = fetch_many(conn, {"r": select(entity.c.entity_id, entity.c.display_name)
                             .where(entity.c.entity_id.in_(ids))}, tolerant=True)["r"]
    return {str(r["entity_id"]): r["display_name"] for r in rows if r["display_name"]}


def list_scored(conn: psycopg.Connection) -> list[dict[str, Any]]:
    """listScoredEntities' reads: the scores (by total desc) with each `display_name` (or null)."""
    c = scores.c
    rows = fetch_all(conn, select(c.entity_id, c.entity_type, c.gcid, c.total_score)
                     .order_by(c.total_score.desc()))
    names = names_for(conn, [str(r["entity_id"]) for r in rows])
    return [{**r, "display_name": names.get(str(r["entity_id"]))} for r in rows]


def get_score(conn: psycopg.Connection, ref: str) -> dict[str, Any] | None:
    """getScore: the latest score row of `ref` with its `display_name`, or null."""
    row = maybe_one(fetch_all(conn, select(scores).where(scores.c.entity_id == ref)
                              .order_by(scores.c.calculated_at.desc()).limit(1)))
    if row is None:
        return None
    return {**row, "display_name": names_for(conn, [ref]).get(ref)}
