"""Dev tracker (/dev, /build/teams, /dev/weekly) — port of the supabase-js calls in
surface-ui/ops/src/lib/{dev-progress,dev-weekly}.ts and routes/_authenticated/dev.board.tsx.

Runs as the signed-in user (role `authenticated`); RLS on exp_dev_* decides access, as it did for
the browser (see docs/SECURITY_FINDINGS.md SF-5). Reads that don't depend on each other go out in
one round trip. Loaders that threw on an error (`unwrap`) still raise; the weekly loader, which
used `data ?? []`, tolerates a failed read.
"""
from __future__ import annotations

from typing import Any

import psycopg
from psycopg import errors as pg_errors
from sqlalchemy import Table, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from _base.core.sql import compile_sql, fetch_many, jsonish, typed
from _base.schema import tables as T

launch_t, teams_t, projects_t = T.t_exp_dev_launch, T.t_exp_dev_teams, T.t_exp_dev_projects
members_t, demos_t, sprints_t = T.t_exp_dev_members, T.t_exp_dev_demo_days, T.t_exp_dev_sprints
docs_t, ideas_t, items_t = T.t_exp_dev_docs, T.t_exp_dev_ideas, T.t_exp_dev_sprint_items
votes_t, config_t, weekly_t = T.t_exp_dev_idea_votes, T.t_exp_dev_config, T.t_exp_dev_weekly_updates


def _first(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    return rows[0] if rows else None


def _launch() -> Any:
    return select(launch_t).order_by(launch_t.c.launch_date).limit(1)


def overview(conn: psycopg.Connection) -> dict[str, Any]:
    r = fetch_many(conn, {
        "launch": _launch(),
        "teams": select(teams_t).order_by(teams_t.c.sort_order.asc()),
        "projects": select(projects_t).order_by(projects_t.c.priority, projects_t.c.deadline),
        "members": select(members_t).order_by(members_t.c.name),
        "demos": select(demos_t).order_by(demos_t.c.demo_date),
    })
    return {"launch": _first(r["launch"]), "teams": r["teams"], "projects": r["projects"],
            "members": r["members"], "demos": r["demos"]}


def team(conn: psycopg.Connection, team_id: str, voter: str) -> dict[str, Any]:
    """loadTeam: the team's rows, its sprints' items and the signed-in voter's votes."""
    team_sprints = select(sprints_t.c.id).where(sprints_t.c.team_id == team_id)
    team_ideas = select(ideas_t.c.id).where(ideas_t.c.team_id == team_id)
    stmts = {
        "launch": _launch(),
        "team": select(teams_t).where(teams_t.c.id == team_id).limit(2),
        "members": select(members_t).where(members_t.c.team_id == team_id)
        .order_by(members_t.c.name),
        "projects": select(projects_t).where(projects_t.c.team_id == team_id)
        .order_by(projects_t.c.priority),
        "sprints": select(sprints_t).where(sprints_t.c.team_id == team_id)
        .order_by(sprints_t.c.start_date),
        "demos": select(demos_t).where(demos_t.c.team_id == team_id).order_by(demos_t.c.demo_date),
        "docs": select(docs_t).where(docs_t.c.team_id == team_id)
        .order_by(docs_t.c.updated_at.desc()),
        "ideas": select(ideas_t).where(ideas_t.c.team_id == team_id)
        .order_by(ideas_t.c.votes.desc()),
        "items": select(items_t).where(items_t.c.sprint_id.in_(team_sprints)),
    }
    if voter:
        stmts["votes"] = select(votes_t.c.idea_id).where(votes_t.c.voter == voter,
                                                         votes_t.c.idea_id.in_(team_ideas))
    r = fetch_many(conn, stmts)
    # the TS read the team with .maybeSingle() and ignored its error: 2+ rows → null
    return {
        "launch": _first(r["launch"]),
        "team": r["team"][0] if len(r["team"]) == 1 else None,
        "members": r["members"], "projects": r["projects"], "sprints": r["sprints"],
        "items": r["items"], "demos": r["demos"], "docs": r["docs"], "ideas": r["ideas"],
        "myVotes": [v["idea_id"] for v in r.get("votes", [])],
    }


def open_gate_rows(conn: psycopg.Connection) -> dict[str, Any]:
    """loadOpenGates' reads: gate items, their sprints, and those sprints' teams."""
    i, s = items_t.c, sprints_t.c
    gate_sprints = select(i.sprint_id).where(i.is_gate.is_(True), i.sprint_id.is_not(None))
    return fetch_many(conn, {
        "items": select(i.id, i.title, i.status, i.canon_ref, i.deep_instructions, i.sprint_id,
                        i.is_gate).where(i.is_gate.is_(True)),
        "sprints": select(s.id, s.name, s.team_id).where(s.id.in_(gate_sprints)),
        "teams": select(teams_t.c.id, teams_t.c.name)
        .where(teams_t.c.id.in_(select(s.team_id).where(s.id.in_(gate_sprints)))),
    })


def board(conn: psycopg.Connection) -> dict[str, Any]:
    """dev.board.tsx: every sprint (by start date) and every sprint item. The page read these
    with `data ?? []`, so a failed read is no rows (logged)."""
    return fetch_many(conn, {
        "sprints": select(sprints_t).order_by(sprints_t.c.start_date),
        "items": select(items_t),
    }, tolerant=True)


def weekly(conn: psycopg.Connection, week_start: str) -> dict[str, Any]:
    r = fetch_many(conn, {
        "launch": _launch(),
        "config": select(config_t).limit(1),
        "teams": select(teams_t).order_by(teams_t.c.sort_order),
        "members": select(members_t).order_by(members_t.c.name),
        "projects": select(projects_t),
        "updates": select(weekly_t).where(
            weekly_t.c.week_start == typed(weekly_t.c.week_start, week_start)),
    }, tolerant=True)
    return {"launch": _first(r["launch"]), "config": _first(r["config"]), "teams": r["teams"],
            "members": r["members"], "projects": r["projects"], "updates": r["updates"]}


# --- writes ----------------------------------------------------------------------------------

# Entities the tracker page writes, and how. Columns: every real column except the key, the
# creation stamp and the who-columns, which the server sets from the signed-in user.
WHO_COLUMNS = {"exp_dev_docs": "updated_by", "exp_dev_ideas": "submitted_by"}
ENTITIES: dict[str, tuple[Table, frozenset[str]]] = {
    "teams": (teams_t, frozenset({"update"})),
    "members": (members_t, frozenset({"insert", "update", "delete"})),
    "projects": (projects_t, frozenset({"insert", "update", "delete"})),
    "sprints": (sprints_t, frozenset({"insert", "delete"})),
    "sprint-items": (items_t, frozenset({"insert", "update", "delete"})),
    "demo-days": (demos_t, frozenset({"insert", "delete"})),
    "docs": (docs_t, frozenset({"insert", "update", "delete"})),
    "ideas": (ideas_t, frozenset({"insert", "delete"})),
    "weekly-updates": (weekly_t, frozenset({"update"})),
    "config": (config_t, frozenset({"update"})),
}


class BadInput(ValueError):
    """A request the allow-list refuses (unknown entity/operation/column)."""


def writable_columns(table: Table) -> frozenset[str]:
    skip = {"id", "created_at", WHO_COLUMNS.get(table.name, "")}
    return frozenset(c.name for c in table.columns if c.name not in skip and c.computed is None)


def _table(entity: str, op: str) -> Table:
    if entity not in ENTITIES:
        raise BadInput(f"unknown entity {entity!r}")
    table, ops = ENTITIES[entity]
    if op not in ops:
        raise BadInput(f"{entity}: {op} is not allowed")
    return table


# Sent back unchanged when the page spreads a whole row into a patch; never written.
_IGNORED = frozenset({"id", "created_at"})


def _values(table: Table, row: dict[str, Any], who: str) -> dict[str, Any]:
    row = {k: v for k, v in row.items() if k not in _IGNORED}
    unknown = set(row) - writable_columns(table)
    if unknown:
        raise BadInput(f"{table.name}: unknown or read-only column(s) {sorted(unknown)}")
    values = dict(row)
    if table.name in WHO_COLUMNS:
        values[WHO_COLUMNS[table.name]] = who
    return values


def _exec(conn: psycopg.Connection, stmt: Any) -> list[dict[str, Any]]:
    sql, params = compile_sql(stmt)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [jsonish(dict(r)) for r in cur.fetchall()] if cur.description else []


def insert_row(conn: psycopg.Connection, entity: str, row: dict[str, Any], who: str) -> str:
    table = _table(entity, "insert")
    rows = _exec(conn, insert(table).values(**_values(table, row, who)).returning(table.c.id))
    return rows[0]["id"]


def update_row(conn: psycopg.Connection, entity: str, row_id: str, patch: dict[str, Any],
               who: str) -> None:
    table = _table(entity, "update")
    if not patch:
        raise BadInput("empty patch")
    _exec(conn, update(table).where(table.c.id == row_id).values(**_values(table, patch, who)))


def delete_row(conn: psycopg.Connection, entity: str, row_id: str) -> None:
    table = _table(entity, "delete")
    _exec(conn, delete(table).where(table.c.id == row_id))


def submit_weekly(conn: psycopg.Connection, row: dict[str, Any]) -> None:
    """The weekly-update upsert on (member_id, week_start), as supabase-js `upsert` did."""
    values = _values(weekly_t, row, "")
    stmt = pg_insert(weekly_t).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=["member_id", "week_start"],
        set_={k: stmt.excluded[k] for k in values if k not in ("member_id", "week_start")},
    )
    _exec(conn, stmt)


def vote_idea(conn: psycopg.Connection, idea_id: str, voter: str) -> str:
    """One vote per voter per idea; ideas.votes is recomputed from the vote rows."""
    already = False
    try:
        with conn.transaction():  # savepoint: a duplicate vote must not end the transaction
            _exec(conn, insert(votes_t).values(idea_id=idea_id, voter=voter))
    except pg_errors.UniqueViolation:
        already = True
    count = _exec(conn, select(func.count().label("n")).where(votes_t.c.idea_id == idea_id))
    _exec(conn, update(ideas_t).where(ideas_t.c.id == idea_id).values(votes=count[0]["n"]))
    return "already" if already else "voted"
