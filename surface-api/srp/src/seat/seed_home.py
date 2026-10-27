"""Mock data so the Home page has something coherent to show (srp/home-page-data task 1, srp/home-page-schema task 4).

    uv run python -m surfaces.srp.seat.seed_home (--dry-run | --backup-to FILE) [--schema NAME] [--as-of YYYY-MM-DD]

For every active user that has a professional seat it writes, deterministically and idempotently, in the local
schema (`SRP_LOCAL_SCHEMA`, default `srp_cleanup`): a score for every score category (never above the category's
maximum; an unknown maximum stays unknown), a zipcode and vertical shared with at least `PEER_GROUP_MIN` other seats
(so a rank exists), 0 to 5 VOCE articles, one website row, an AI-authority row for most seats, a credentials list,
a year started. Everything is labelled "Mock", names nobody, and uses fixed dates (never the clock), so running it twice
on the same seats leaves the database exactly as running it once, ids included.

In the same run it fills the 17 `home_*` tables (created by `srp/db/local/home_schema.sql`): the reference rows (score lanes, bands, plans,
peer benchmarks) and, for every seat, its trial and plan, score snapshots with lane points and a map, competitors, activity, next moves, locked
features, weekly brief, review drafts, events and insights, as planned by `seed_home_plan`. Their dates are relative to `--as-of` (default: today,
UTC, printed): the same date twice changes nothing; a later date moves the dates and keeps the per-seat rows (snapshots are keyed by their date, so
those are replaced, with their lane points and map). Rows in the `home_*` tables for seats that are not seeded are left alone.

What is NOT stable: a seat's market (its zipcode) depends on its position among the seats being seeded, so adding or removing
a seat can move others to a different market on the next run. The vertical is always 1 in the score rows; the seat's own
`tier_agents.vertical_id` is left as it is, so the two can disagree (the Home reads the score rows).

It deletes and overwrites old mock rows for the seated users, so it will not run for real without `--backup-to`: every old row
it will change or remove goes first to a new private file (one JSON line per row; an existing file is never overwritten).
Everything runs in ONE repeatable-read transaction, so the backup and the changes see the same rows and a failure changes
nothing. A schema other than `srp_cleanup` is refused unless named again with `--schema`. The target is printed (host, database,
schema; never the user or password). Output is counts only. Touches only the local schema; no migration, no table or column added.
Connects with DATABASE_URL like the API does.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from psycopg.types.json import Jsonb

from _base.config import get_settings
from _base.db.session import close_pools, connection  # tests replace these names
from surfaces.srp.seat import seed_home_plan as hp

DEFAULT_SCHEMA = "srp_cleanup"
SEED_TAG = "home-v1"
PEER_GROUP_MIN = 10  # spec D2: a rank needs at least this many peers
_GROUP_TARGET = 12  # seats per peer group the seed aims for, so every group clears the minimum
_BASE = datetime(2026, 1, 5, 9, 0, 0)
_VERTICAL = 1


@dataclass(frozen=True)
class Category:
    id: int
    max: int | None


@dataclass(frozen=True)
class SeatPlan:
    seat_id: int
    zipcode: str
    vertical_id: int
    scores: list[tuple[int, int | None]]
    articles: list[dict[str, Any]]
    website: dict[str, Any]
    ai: dict[str, Any] | None
    certifications: list[str]
    year_started: str


@dataclass
class Report:
    seats: int
    planned: dict[str, int]
    changed: dict[str, int] = field(default_factory=dict)
    dry_run: bool = False
    rankless: int = 0


def _h(seat: int, key: str) -> int:
    return int.from_bytes(hashlib.sha256(f"{SEED_TAG}:{seat}:{key}".encode()).digest()[:8], "big")


def _frac(seat: int, key: str) -> float:
    return _h(seat, key) / 2**64


def _day(seat: int, key: str, span: int = 200) -> datetime:
    return _BASE + timedelta(days=_h(seat, key) % span, hours=_h(seat, key + "h") % 9)


def build_plan(seat_ids: list[int], categories: list[Category]) -> list[SeatPlan]:
    """The rows every seat should have. Pure and deterministic: the same seat always gets the same values."""
    seats = sorted(set(seat_ids))
    groups = max(1, len(seats) // _GROUP_TARGET)
    cats = sorted(categories, key=lambda c: c.id)
    plans: list[SeatPlan] = []
    for index, seat in enumerate(seats):
        scores = [
            (c.id, None if c.max is None else round(c.max * (0.2 + 0.75 * _frac(seat, f"score{c.id}"))))
            for c in cats
        ]
        n = _h(seat, "articles") % 6
        unpublished = 1 if n and _h(seat, "unpub") % 2 else 0
        archived_last = n >= 2 and _h(seat, "arch") % 4 == 0
        articles = []
        for i in range(n):
            published = i < n - unpublished
            created = _day(seat, f"art{i}", 120)
            archived = archived_last and i == n - 1
            articles.append({
                "article_id": f"seed-home-{seat}-{i}",
                "title": f"Mock article {i + 1} for seat {seat}",
                "slug": f"mock-article-{seat}-{i + 1}",
                "published": published,
                "published_at": created + timedelta(days=2) if published else None,
                "status": 1 if published else 0,
                "archived": archived,
                "archived_at": created + timedelta(days=40) if archived else None,
                "created_at": created,
                "updated_at": created + timedelta(days=3),
            })
        published_count = sum(1 for a in articles if a["published"] and not a["archived"])
        refreshed = _day(seat, "web", 150)
        website = {
            "total_score": 15 + _h(seat, "web") % 80,
            "website_url": f"https://example.test/seat-{seat}",
            "last_refreshed_at": refreshed,
            "next_refresh_on": refreshed + timedelta(days=7),
            "status": 1,
            "overall_data_completion": round(40 + 55 * _frac(seat, "odc"), 1),
            "profile_completion_percentage": round(30 + 65 * _frac(seat, "pcp"), 1),
            "created_at": refreshed - timedelta(days=30),
            "updated_at": refreshed,
        }
        ai = None
        if _h(seat, "ai") % 5 != 0:
            updated = _day(seat, "ai", 150)
            ai = {
                "ranking_score": 1 + _h(seat, "rank") % 100,
                "ai_authority_score": 5 + _h(seat, "aiscore") % 60,
                "srs_contribution": round(10 * _frac(seat, "srsc"), 2),
                "article_contribution": round(10 * _frac(seat, "artc"), 2),
                "qa_contribution": round(10 * _frac(seat, "qac"), 2),
                "total_article": published_count,
                "total_answer": 1 + _h(seat, "answers") % 7,
                "last_article_published_at": updated - timedelta(days=5) if published_count else None,
                "ai_topics": [f"Mock topic {j + 1}" for j in range(1 + _h(seat, "topics") % 3)],
                "created_at": updated - timedelta(days=20),
                "updated_at": updated,
            }
        plans.append(SeatPlan(
            seat_id=seat,
            zipcode=str(52801 + index % groups),
            vertical_id=_VERTICAL,
            scores=scores,
            articles=articles,
            website=website,
            ai=ai,
            certifications=[f"Mock certification {chr(65 + j)}" for j in range(_h(seat, "certs") % 4)],
            year_started=str(2003 + _h(seat, "year") % 20),
        ))
    return plans


def rankless_count(plans: list[SeatPlan]) -> int:
    """How many seats can never be ranked: their market has fewer than PEER_GROUP_MIN seats, or their total is unknown."""
    sizes = Counter((p.zipcode, p.vertical_id) for p in plans)
    return sum(
        1 for p in plans
        if sizes[(p.zipcode, p.vertical_id)] < PEER_GROUP_MIN or all(score is None for _, score in p.scores)
    )


# --- backup -----------------------------------------------------------------------------------------------


def write_backup(path: Path, rows_by_table: dict[str, list[dict[str, Any]]]) -> None:
    """One JSON line per old row, to a new file only the owner can read. Raises FileExistsError, writing nothing."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        for table, rows in rows_by_table.items():
            for row in rows:
                handle.write(json.dumps({"table": table, "row": row}, default=str) + "\n")


# --- applying the plan ------------------------------------------------------------------------------------

_TABLES = ("user_search_rank_scores", "voce_articles", "website_analytics_data", "ai_authority_stats", "tier_agent_details")
_SEAT_COLUMN = {"user_search_rank_scores": "tier_agent_id", "voce_articles": "tier_agent_id",
                "website_analytics_data": "tier_agent_id", "ai_authority_stats": "agent_id", "tier_agent_details": "tier_agent_id"}


def _sync(conn: Any, schema: str, table: str, existing: list[dict], desired: dict[Any, dict], key_of: Any, tally: dict[str, int]) -> None:
    """Make `table` hold exactly `desired` (key -> column values): update rows in place (lowest id kept), insert the missing,
    delete the rest, and skip an update when nothing differs, so a second run does no work."""
    by_key: dict[Any, list[dict]] = {}
    for row in sorted(existing, key=lambda r: r["id"]):
        by_key.setdefault(key_of(row), []).append(row)
    for key, values in desired.items():
        rows = by_key.pop(key, [])
        if rows:
            keep, extras = rows[0], rows[1:]
            changed = {c: v for c, v in values.items() if _norm(keep.get(c)) != _norm(v)}
            if changed:
                sets = ", ".join(f"{c} = %s" for c in changed)
                conn.execute(f"update {schema}.{table} set {sets} where id = %s", [_wrap(v) for v in changed.values()] + [keep["id"]])
                tally["updated"] += 1
            for extra in extras:
                conn.execute(f"delete from {schema}.{table} where id = %s", (extra["id"],))
                tally["deleted"] += 1
        else:
            cols = list(values)
            conn.execute(
                f"insert into {schema}.{table} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})",
                [_wrap(values[c]) for c in cols],
            )
            tally["inserted"] += 1
    for rows in by_key.values():  # old rows nothing in the plan asks for
        for row in rows:
            conn.execute(f"delete from {schema}.{table} where id = %s", (row["id"],))
            tally["deleted"] += 1


def _wrap(value: Any) -> Any:
    return Jsonb(value) if isinstance(value, (list, dict)) else value


def _norm(value: Any) -> Any:
    return float(value) if isinstance(value, Decimal) else value  # numeric columns come back as Decimal; the plan holds floats


def apply_plan(conn: Any, schema: str, plans: list[SeatPlan]) -> dict[str, int]:
    tally = {"inserted": 0, "updated": 0, "deleted": 0}
    seats = [p.seat_id for p in plans]
    existing = {
        t: conn.execute(f"select * from {schema}.{t} where {_SEAT_COLUMN[t]} = any(%s)", (seats,)).fetchall() for t in _TABLES
    }
    details = {"mock": True, "seed": SEED_TAG}

    scores = {(p.seat_id, cid): {"tier_agent_id": p.seat_id, "srs_config_category_id": cid, "srs_category_score": s, "srs_category_details": details,
                                 "zipcode": p.zipcode, "vertical_id": p.vertical_id, "created_at": _BASE, "updated_at": _BASE + timedelta(days=1)}
              for p in plans for cid, s in p.scores}
    _sync(conn, schema, "user_search_rank_scores", existing["user_search_rank_scores"], scores,
          lambda r: (r["tier_agent_id"], r["srs_config_category_id"]), tally)

    articles = {(p.seat_id, a["article_id"]): {
        "tier_agent_id": p.seat_id, "article_id": a["article_id"], "title": a["title"], "slug": a["slug"], "published": a["published"],
        "published_at": a["published_at"], "status": a["status"], "article_created_at": a["created_at"], "article_updated_at": a["updated_at"],
        "article_archived_at": a["archived_at"], "created_at": a["created_at"], "updated_at": a["updated_at"]}
        for p in plans for a in p.articles}
    _sync(conn, schema, "voce_articles", existing["voce_articles"], articles, lambda r: (r["tier_agent_id"], r["article_id"]), tally)

    website = {p.seat_id: {
        "tier_agent_id": p.seat_id, "total_score": p.website["total_score"], "website_url": p.website["website_url"],
        "last_refreshed_time": p.website["last_refreshed_at"], "next_refresh_on": p.website["next_refresh_on"], "status": p.website["status"],
        "overall_data_completion": p.website["overall_data_completion"], "profile_completion_percentage": p.website["profile_completion_percentage"],
        "created_at": p.website["created_at"], "updated_at": p.website["updated_at"]} for p in plans}
    _sync(conn, schema, "website_analytics_data", existing["website_analytics_data"], website, lambda r: r["tier_agent_id"], tally)

    ai = {p.seat_id: {"agent_id": p.seat_id, **p.ai} for p in plans if p.ai}
    _sync(conn, schema, "ai_authority_stats", existing["ai_authority_stats"], ai, lambda r: r["agent_id"], tally)

    certs = {p.seat_id: {"tier_agent_id": p.seat_id, "certifications": p.certifications, "created_at": _BASE, "updated_at": _BASE} for p in plans}
    _sync(conn, schema, "tier_agent_details", existing["tier_agent_details"], certs, lambda r: r["tier_agent_id"], tally)

    for p in plans:  # the three seat columns: updated in place, only when they differ
        row = conn.execute(f"select year_started, zipcode, profile_photo from {schema}.tier_agents where id = %s", (p.seat_id,)).fetchone()
        if row and (row["year_started"], row["zipcode"], row["profile_photo"]) != (p.year_started, p.zipcode, None):
            conn.execute(f"update {schema}.tier_agents set year_started = %s, zipcode = %s, profile_photo = null where id = %s",
                         (p.year_started, p.zipcode, p.seat_id))
            tally["updated"] += 1
    return tally


# --- the Home tables -----------------------------------------------------------------------------------------

_HOME_REFERENCE = ("home_score_lanes", "home_score_bands", "home_plans", "home_peer_benchmarks")
_HOME_PER_SEAT = ("home_seat_state", "home_snapshots", "home_competitors", "home_activity", "home_next_moves", "home_locked_features",
                  "home_weekly_briefs", "home_review_drafts", "home_events", "home_nora_insights")
_HOME_CHILDREN = {"home_snapshot_lanes": ("home_snapshots", "snapshot_id"), "home_map_cells": ("home_snapshots", "snapshot_id"),
                  "home_weekly_brief_items": ("home_weekly_briefs", "brief_id")}


def _today() -> date:
    return datetime.now(UTC).date()


def _all(conn: Any, schema: str, table: str) -> list[dict]:
    return conn.execute(f"select * from {schema}.{table} order by id").fetchall()


def _of_seats(conn: Any, schema: str, table: str, seats: list[int]) -> list[dict]:
    return conn.execute(f"select * from {schema}.{table} where tier_agent_id = any(%s) order by id", (seats,)).fetchall()


def _of_parents(conn: Any, schema: str, table: str, column: str, ids: list[int]) -> list[dict]:
    return conn.execute(f"select * from {schema}.{table} where {column} = any(%s) order by id", (ids,)).fetchall()


def _home_planned(home: hp.HomePlan) -> dict[str, int]:
    seats, ref = home.seats, home.reference
    return {
        "home_score_lanes": len(ref.lanes), "home_score_bands": len(ref.bands), "home_plans": len(ref.plans), "home_peer_benchmarks": len(ref.benchmarks),
        "home_seat_state": len(seats), "home_snapshots": sum(len(s.snapshots) for s in seats),
        "home_snapshot_lanes": sum(len(x.lanes) for s in seats for x in s.snapshots), "home_map_cells": sum(len(x.cells) for s in seats for x in s.snapshots),
        "home_competitors": sum(len(s.competitors) for s in seats), "home_activity": sum(len(s.activities) for s in seats),
        "home_next_moves": sum(len(s.moves) for s in seats), "home_locked_features": sum(len(s.locked) for s in seats),
        "home_weekly_briefs": len(seats), "home_weekly_brief_items": sum(len(s.brief.items) for s in seats),
        "home_review_drafts": sum(len(s.drafts) for s in seats), "home_events": sum(len(s.events) for s in seats),
        "home_nora_insights": sum(len(s.insights) for s in seats),
    }


def apply_home(conn: Any, schema: str, home: hp.HomePlan, tally: dict[str, int]) -> None:
    """Make the `home_*` tables hold exactly the plan for these seats: reference rows first, then each table that others point at, then its children."""
    ref = home.reference
    seats = [s.seat_id for s in home.seats]

    def sync(table: str, existing: list[dict], desired: dict[Any, dict], key_of: Any) -> list[dict]:
        _sync(conn, schema, table, existing, desired, key_of, tally)
        return _all(conn, schema, table)

    lanes = sync("home_score_lanes", _all(conn, schema, "home_score_lanes"),
                 {l.key: {"key": l.key, "name": l.name, "max_points": l.max_points, "position": l.position} for l in ref.lanes}, lambda r: r["key"])
    lane_id = {r["key"]: r["id"] for r in lanes}
    bands = sync("home_score_bands", _all(conn, schema, "home_score_bands"),
                 {b.name: {"name": b.name, "min_points": b.min_points, "position": b.position} for b in ref.bands}, lambda r: r["name"])
    band_id = {r["name"]: r["id"] for r in bands}
    plans = sync("home_plans", _all(conn, schema, "home_plans"),
                 {p.key: {"key": p.key, "name": p.name, "tag": p.tag, "position": p.position, "highlight": p.highlight, "items": p.items} for p in ref.plans},
                 lambda r: r["key"])
    plan_id = {r["key"]: r["id"] for r in plans}
    sync("home_peer_benchmarks", _all(conn, schema, "home_peer_benchmarks"),
         {band_id[b.band]: {"band_id": band_id[b.band], "median_gain": b.median_gain, "horizon_days": b.horizon_days, "cohort_size": b.cohort_size,
                            "cohort_period": b.cohort_period, "reached_next_band": b.reached_next_band, "cohort_of": b.cohort_of} for b in ref.benchmarks},
         lambda r: r["band_id"])

    snaps = sync("home_snapshots", _of_seats(conn, schema, "home_snapshots", seats),
                 {(s.seat_id, x.as_of): {
                     "tier_agent_id": s.seat_id, "as_of": x.as_of, "total": x.total, "band_id": band_id[x.band], "rank_position": x.rank_position,
                     "rank_of": x.rank_of, "rank_city": x.rank_city, "profile_strength_pct": x.profile_strength_pct, "review_avg": x.review_avg,
                     "review_count": x.review_count, "map_scanned_at": x.map_scanned_at, "ai_cited": x.ai_cited, "ai_checked": x.ai_checked,
                     "ai_checked_at": x.ai_checked_at} for s in home.seats for x in s.snapshots},
                 lambda r: (r["tier_agent_id"], r["as_of"]))
    snap_id = {(r["tier_agent_id"], r["as_of"]): r["id"] for r in snaps if r["tier_agent_id"] in set(seats)}
    snap_ids = list(snap_id.values())

    sync("home_seat_state", _of_seats(conn, schema, "home_seat_state", seats),
         {s.seat_id: {"tier_agent_id": s.seat_id, "plan_id": plan_id[s.state.plan], "trial_started_at": s.state.trial_started_at,
                      "trial_days": s.state.trial_days, "moves_done": s.state.moves_done, "moves_goal": s.state.moves_goal,
                      "streak_weeks": s.state.streak_weeks, "nora_text_day": s.state.nora_text_day, "is_mock": s.state.is_mock,
                      "claim_snapshot_id": snap_id[(s.seat_id, s.snapshots[0].as_of)]} for s in home.seats},
         lambda r: r["tier_agent_id"])
    sync("home_snapshot_lanes", _of_parents(conn, schema, "home_snapshot_lanes", "snapshot_id", snap_ids),
         {(snap_id[(s.seat_id, x.as_of)], lane_id[k]): {"snapshot_id": snap_id[(s.seat_id, x.as_of)], "lane_id": lane_id[k], "points": pts}
          for s in home.seats for x in s.snapshots for k, pts in x.lanes.items()},
         lambda r: (r["snapshot_id"], r["lane_id"]))
    sync("home_map_cells", _of_parents(conn, schema, "home_map_cells", "snapshot_id", snap_ids),
         {(snap_id[(s.seat_id, x.as_of)], c.row, c.col): {"snapshot_id": snap_id[(s.seat_id, x.as_of)], "row_no": c.row, "col_no": c.col, "rank": c.rank}
          for s in home.seats for x in s.snapshots for c in x.cells},
         lambda r: (r["snapshot_id"], r["row_no"], r["col_no"]))
    sync("home_competitors", _of_seats(conn, schema, "home_competitors", seats),
         {(s.seat_id, c.position): {"tier_agent_id": s.seat_id, "name": c.name, "score": c.score, "is_market_leader": c.is_market_leader,
                                    "review_count": c.review_count, "review_avg": c.review_avg, "article_count": c.article_count, "position": c.position}
          for s in home.seats for c in s.competitors},
         lambda r: (r["tier_agent_id"], r["position"]))
    sync("home_activity", _of_seats(conn, schema, "home_activity", seats),
         {(s.seat_id, a.label): {"tier_agent_id": s.seat_id, "label": a.label, "points": a.points, "status": a.status,
                                 "started_at": a.started_at, "completed_at": a.completed_at} for s in home.seats for a in s.activities},
         lambda r: (r["tier_agent_id"], r["label"]))
    sync("home_next_moves", _of_seats(conn, schema, "home_next_moves", seats),
         {(s.seat_id, m.position): {"tier_agent_id": s.seat_id, "position": m.position, "icon": m.icon, "title": m.title, "subtitle": m.subtitle,
                                    "recommended": m.recommended, "target": m.target, "points": m.points} for s in home.seats for m in s.moves},
         lambda r: (r["tier_agent_id"], r["position"]))
    sync("home_locked_features", _of_seats(conn, schema, "home_locked_features", seats),
         {(s.seat_id, f.feature_key): {"tier_agent_id": s.seat_id, "feature_key": f.feature_key, "title": f.title, "description": f.description,
                                       "lane_id": lane_id[f.lane] if f.lane else None, "plan_id": plan_id[f.plan]} for s in home.seats for f in s.locked},
         lambda r: (r["tier_agent_id"], r["feature_key"]))
    briefs = sync("home_weekly_briefs", _of_seats(conn, schema, "home_weekly_briefs", seats),
                  {s.seat_id: {"tier_agent_id": s.seat_id, "week_start": s.brief.week_start, "next_move_label": s.brief.next_move_label,
                               "next_move_points": s.brief.next_move_points, "next_move_target": s.brief.next_move_target,
                               "away_new_reviews": s.brief.away_new_reviews, "away_bio_live": s.brief.away_bio_live,
                               "away_first_article": s.brief.away_first_article} for s in home.seats},
                  lambda r: r["tier_agent_id"])
    brief_id = {r["tier_agent_id"]: r["id"] for r in briefs if r["tier_agent_id"] in set(seats)}
    sync("home_weekly_brief_items", _of_parents(conn, schema, "home_weekly_brief_items", "brief_id", list(brief_id.values())),
         {(brief_id[s.seat_id], i.position): {"brief_id": brief_id[s.seat_id], "position": i.position, "label": i.label, "points": i.points}
          for s in home.seats for i in s.brief.items},
         lambda r: (r["brief_id"], r["position"]))
    sync("home_review_drafts", _of_seats(conn, schema, "home_review_drafts", seats),
         {(s.seat_id, d.reviewer_label): {"tier_agent_id": s.seat_id, "reviewer_label": d.reviewer_label, "rating": d.rating, "review_text": d.review_text,
                                          "draft_text": d.draft_text, "compliance_status": d.compliance_status, "status": d.status,
                                          "created_at": d.created_at} for s in home.seats for d in s.drafts},
         lambda r: (r["tier_agent_id"], r["reviewer_label"]))
    sync("home_events", _of_seats(conn, schema, "home_events", seats),
         {(s.seat_id, e.kind): {"tier_agent_id": s.seat_id, "kind": e.kind, "title": e.title, "body": e.body, "action_label": e.action_label,
                                "expires_at": e.expires_at} for s in home.seats for e in s.events},
         lambda r: (r["tier_agent_id"], r["kind"]))
    sync("home_nora_insights", _of_seats(conn, schema, "home_nora_insights", seats),
         {(s.seat_id, i.position): {"tier_agent_id": s.seat_id, "position": i.position, "title": i.title, "body": i.body, "cta": i.cta, "action": i.action}
          for s in home.seats for i in s.insights},
         lambda r: (r["tier_agent_id"], r["position"]))


def _backup_home(conn: Any, schema: str, seats: list[int]) -> dict[str, list[dict[str, Any]]]:
    rows = {t: _all(conn, schema, t) for t in _HOME_REFERENCE}
    rows.update({t: _of_seats(conn, schema, t, seats) for t in _HOME_PER_SEAT})
    for table, (parent, column) in _HOME_CHILDREN.items():
        parent_ids = [r["id"] for r in rows[parent]]
        rows[table] = _of_parents(conn, schema, table, column, parent_ids)
    return rows


def _backup_rows(conn: Any, schema: str, seats: list[int]) -> dict[str, list[dict[str, Any]]]:
    rows = {t: conn.execute(f"select * from {schema}.{t} where {_SEAT_COLUMN[t]} = any(%s) order by id", (seats,)).fetchall() for t in _TABLES}
    rows.update(_backup_home(conn, schema, seats))
    rows["tier_agents"] = conn.execute(
        f"select id, year_started, zipcode, profile_photo from {schema}.tier_agents where id = any(%s) order by id", (seats,)
    ).fetchall()
    return rows


def seed(*, dry_run: bool = False, backup_path: Path | None = None, as_of: date | None = None) -> Report:
    schema = get_settings().srp_local_schema  # already checked as a plain schema name
    with connection() as conn:
        conn.execute("set transaction isolation level repeatable read")  # first: the backup and the changes read the same rows
        seats = [r["id"] for r in conn.execute(
            f"""select ta.id from {schema}.tier_agents ta join {schema}.users u on u.id = ta.user_id
                where ta.deleted_at is null and u.deleted_at is null and u.deactivated_at is null
                  and not coalesce(u.is_manual_deactivated, false) order by ta.id"""
        ).fetchall()]
        cats = [Category(r["id"], r["score"]) for r in conn.execute(f"select id, score from {schema}.srs_config_categories order by id").fetchall()]
        plans = build_plan(seats, cats)
        home = hp.build_home_plan(seats, as_of or _today(), {p.seat_id: p.zipcode for p in plans})
        planned = {
            "user_search_rank_scores": sum(len(p.scores) for p in plans),
            "voce_articles": sum(len(p.articles) for p in plans),
            "website_analytics_data": len(plans),
            "ai_authority_stats": sum(1 for p in plans if p.ai),
            "tier_agent_details": len(plans),
            **_home_planned(home),
        }
        rankless = rankless_count(plans)
        if dry_run:
            return Report(len(plans), planned, {}, True, rankless)
        if backup_path is not None:
            write_backup(Path(backup_path), _backup_rows(conn, schema, seats))  # before any change
        changed = apply_plan(conn, schema, plans)
        apply_home(conn, schema, home, changed)
    return Report(len(plans), planned, changed, False, rankless)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m surfaces.srp.seat.seed_home", description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="count what would be written, change nothing")
    parser.add_argument("--backup-to", metavar="FILE", help="write the old rows to a new private file first (required unless --dry-run)")
    parser.add_argument("--schema", metavar="NAME", help="confirm a schema other than srp_cleanup by naming it again")
    parser.add_argument("--as-of", metavar="YYYY-MM-DD", type=date.fromisoformat,
                        help="the day the Home dates are relative to (default: today, UTC); the same day twice changes nothing")
    args = parser.parse_args(argv)
    schema = get_settings().srp_local_schema
    if schema != DEFAULT_SCHEMA and args.schema != schema:
        print(f"the target schema is {schema!r}, not {DEFAULT_SCHEMA!r}; name it again with --schema {schema} to confirm; nothing was changed", file=sys.stderr)
        return 2
    if not args.dry_run and not args.backup_to:
        print("a real run deletes and overwrites old rows, so it needs --backup-to FILE (or use --dry-run); nothing was changed", file=sys.stderr)
        return 2
    url = urlsplit(os.environ.get("DATABASE_URL", ""))
    as_of = args.as_of or _today()
    print(f"target: host={url.hostname or 'unknown'} database={url.path.lstrip('/') or 'unknown'} schema={schema}")
    print(f"as of: {as_of.isoformat()}")
    try:
        report = seed(dry_run=args.dry_run, backup_path=Path(args.backup_to) if args.backup_to else None, as_of=as_of)
    except FileExistsError:
        print("the backup file already exists; nothing was changed", file=sys.stderr)
        return 2
    finally:
        close_pools()  # the pool's threads must stop before the interpreter exits
    rows = ", ".join(f"{t} {n}" for t, n in report.planned.items())
    if report.dry_run:
        print(f"dry run, nothing changed: {report.seats} seats, rows planned: {rows}")
    else:
        c = report.changed
        print(f"done: {report.seats} seats; inserted {c['inserted']}, updated {c['updated']}, deleted {c['deleted']}; rows planned: {rows}")
    if report.rankless:
        print(f"warning: {report.rankless} seats will have no rank (fewer than {PEER_GROUP_MIN} seats in their market, or no known score)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
