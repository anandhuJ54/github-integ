"""Mock data so the Home page has something coherent to show (srp/home-page-data task 1, srp/home-page-schema task 4).

    uv run python -m surfaces.srp.seat.seed_home (--dry-run | --backup-to FILE) [--schema NAME] [--as-of YYYY-MM-DD]

For every active user that has a professional seat it writes, deterministically and idempotently, in the local
schema (`SRP_LOCAL_SCHEMA`, default `srp_cleanup`): a score for every score category (never above the category's
maximum; an unknown maximum stays unknown), a zipcode and vertical shared with at least `PEER_GROUP_MIN` other seats
(so a rank exists), 0 to 5 VOCE articles, one website row, an AI-authority row for most seats, a credentials list,
a year started. Everything is labelled "Mock", names nobody, and uses fixed dates (never the clock), so running it twice
on the same seats leaves the database exactly as running it once, ids included.

In the same run it fills the Insights page's four tables (`srp/db/local/insights_schema.sql`: visibility figures, AI engine rows, competitor positions and the top 3 of
every map spot, as planned by `seed_insights_plan` from the Home plan; they need the Home rows, so they are written last), the Profile page's `profile_facts` and `profile_graph_groups` (`srp/db/local/profile_schema.sql`) and corrects the mock `title`, `description`,
`phone_number`, `mobile_number` and `profile_photo` of the seeded seats' `tier_agents` rows (as planned by `seed_profile_plan`), the SRS page's `srs_lane_gaps` (10 rows per seat; `srp/db/local/srs_schema.sql`) and the lanes' `short_name`, and the 17 `home_*` tables (created by `srp/db/local/home_schema.sql`): the reference rows (score lanes, bands, plans,
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
import dataclasses
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
from surfaces.srp.seat import seed_connections_plan as cpn
from surfaces.srp.seat import seed_home_plan as hp
from surfaces.srp.seat import seed_insights_plan as ip
from surfaces.srp.seat import seed_network_plan as npl
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat import seed_web_plan as wpn

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


def _sync(conn: Any, schema: str, table: str, existing: list[dict], desired: dict[Any, dict], key_of: Any, tally: dict[str, int],
          json_cols: frozenset[str] = frozenset()) -> None:
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
                conn.execute(f"update {schema}.{table} set {sets} where id = %s", [_wrap(v, c in json_cols) for c, v in changed.items()] + [keep["id"]])
                tally["updated"] += 1
            for extra in extras:
                conn.execute(f"delete from {schema}.{table} where id = %s", (extra["id"],))
                tally["deleted"] += 1
        else:
            cols = list(values)
            conn.execute(
                f"insert into {schema}.{table} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})",
                [_wrap(values[c], c in json_cols) for c in cols],
            )
            tally["inserted"] += 1
    for rows in by_key.values():  # old rows nothing in the plan asks for
        for row in rows:
            conn.execute(f"delete from {schema}.{table} where id = %s", (row["id"],))
            tally["deleted"] += 1


def _wrap(value: Any, as_json: bool = False) -> Any:
    """A list or dict is always JSON; a plain value only when its column is known to be jsonb (a JSON string such as "123" must not be read as a number)."""
    return Jsonb(value) if as_json and value is not None or isinstance(value, (list, dict)) else value


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
                  "home_weekly_briefs", "home_review_drafts", "home_events", "home_nora_insights",
                  "srs_lane_gaps",  # the SRS page's table (srp/srs-page-schema): per seat, backed up with the Home rows
                  "profile_facts", "profile_graph_groups",  # the Profile page's tables (srp/profile-page-schema), likewise
                  "insights_visibility", "insights_ai_engines", "insights_competitor_positions",  # the Insights page's seat tables (srp/insights-page-schema)
                  "web_checks",  # the Web analytics page's table (srp/web-analytics-page-schema)
                  "connected_accounts",  # the Connections page's table (srp/connections-page-schema)
                  "network_partners", "network_referrals")  # the Network page's tables (srp/network-page-schema)
_HOME_CHILDREN = {"home_snapshot_lanes": ("home_snapshots", "snapshot_id"), "home_map_cells": ("home_snapshots", "snapshot_id"),
                  "home_weekly_brief_items": ("home_weekly_briefs", "brief_id"),
                  "insights_spot_leaders": ("home_map_cells", "cell_id")}  # after home_map_cells: the leaders of the map spots (srp/insights-page-schema)


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
        "srs_lane_gaps": sum(len(s.gaps) for s in seats),
    }


def _profile_planned(profile: pp.ProfilePlan) -> dict[str, int]:
    return {"profile_facts": sum(len(s.facts) for s in profile.seats), "profile_graph_groups": sum(len(s.groups) for s in profile.seats)}


def apply_profile(conn: Any, schema: str, profile: pp.ProfilePlan, tally: dict[str, int]) -> None:
    """Make the Profile page's two tables hold exactly the plan for these seats, and put the corrected mock values into the `tier_agents` columns the page reads."""
    seats = [s.seat_id for s in profile.seats]
    facts = {(s.seat_id, f.field): {"tier_agent_id": s.seat_id, "field": f.field, "value": f.value, "source": f.source, "trust_tier": f.trust_tier,
                                    "confirmed_at": f.confirmed_at, "is_mock": True} for s in profile.seats for f in s.facts}
    _sync(conn, schema, "profile_facts", _of_seats(conn, schema, "profile_facts", seats), facts, lambda r: (r["tier_agent_id"], r["field"]), tally,
          json_cols=frozenset({"value"}))
    groups = {(s.seat_id, g.key): {"tier_agent_id": s.seat_id, "group_key": g.key, "facts": g.facts, "is_mock": True} for s in profile.seats for g in s.groups}
    _sync(conn, schema, "profile_graph_groups", _of_seats(conn, schema, "profile_graph_groups", seats), groups, lambda r: (r["tier_agent_id"], r["group_key"]), tally)
    for s in profile.seats:  # the seat columns: updated in place, only when they differ
        c = s.columns
        want = (c.title, c.description, c.phone_number, c.mobile_number, c.profile_photo)
        row = conn.execute(
            f"select title, description, phone_number, mobile_number, profile_photo from {schema}.tier_agents where id = %s", (s.seat_id,)).fetchone()
        if row and (row["title"], row["description"], row["phone_number"], row["mobile_number"], row["profile_photo"]) != want:
            conn.execute(
                f"update {schema}.tier_agents set title = %s, description = %s, phone_number = %s, mobile_number = %s, profile_photo = %s where id = %s",
                (*want, s.seat_id))
            tally["updated"] += 1


def _insights_planned(insights: ip.InsightsPlan) -> dict[str, int]:
    return {"insights_visibility": sum(len(s.visibility) for s in insights.seats), "insights_ai_engines": sum(len(s.engines) for s in insights.seats),
            "insights_competitor_positions": sum(len(s.positions) for s in insights.seats), "insights_spot_leaders": sum(len(s.leaders) for s in insights.seats)}


def _web_planned(web: wpn.WebPlan) -> dict[str, int]:
    return {"web_checks": sum(len(s.checks) for s in web.seats)}


def apply_web(conn: Any, schema: str, web: wpn.WebPlan, tally: dict[str, int]) -> None:
    """Make `web_checks` hold exactly the plan for these seats. The three corrections of existing mock values (the website tile column, the SRS website gap text and
    Home's website move text) arrive through the plans `apply_plan` and `apply_home` write, which `seed` aligns with the checks first."""
    seats = [s.seat_id for s in web.seats]
    rows = {(s.seat_id, c.key): {"tier_agent_id": s.seat_id, "check_key": c.key, "state": c.state, "result": c.result, "headline": c.headline, "points": c.points,
                                 "points_max": c.points_max, "source": c.source, "trust_tier": c.trust_tier, "is_mock": True} for s in web.seats for c in s.checks}
    _sync(conn, schema, "web_checks", _of_seats(conn, schema, "web_checks", seats), rows, lambda r: (r["tier_agent_id"], r["check_key"]), tally)


def _connections_planned(conns: cpn.ConnectionsPlan) -> dict[str, int]:
    return {"connected_accounts": sum(len(s.accounts) for s in conns.seats)}


def apply_connections(conn: Any, schema: str, conns: cpn.ConnectionsPlan, tally: dict[str, int]) -> None:
    """Make `connected_accounts` hold exactly the plan for these seats. The two corrections of existing mock values (the SRS Connections gap text and the Web analytics
    Indexing source) arrive through the plans `apply_home` and `apply_web` write, which `seed` aligns with the accounts first."""
    seats = [s.seat_id for s in conns.seats]
    rows = {(s.seat_id, a.provider): {"tier_agent_id": s.seat_id, "provider": a.provider, "state": a.state, "synced_at": a.synced_at, "source": a.source,
                                      "trust_tier": a.trust_tier, "is_mock": True} for s in conns.seats for a in s.accounts}
    _sync(conn, schema, "connected_accounts", _of_seats(conn, schema, "connected_accounts", seats), rows, lambda r: (r["tier_agent_id"], r["provider"]), tally)


def _network_planned(net: npl.NetworkPlan) -> dict[str, int]:
    return {"network_partners": sum(len(s.partners) for s in net.seats), "network_referrals": sum(len(s.referrals) for s in net.seats)}


_PARTNER_COLS = ("position", "name", "company", "role", "state", "reason_kind", "reason_count", "reason_on", "source", "trust_tier")
_REFERRAL_COLS = ("list_key", "position", "name", "detail", "status", "occurred_on", "source", "trust_tier")


def apply_network(conn: Any, schema: str, net: npl.NetworkPlan, tally: dict[str, int]) -> None:
    """Make `network_partners` and `network_referrals` hold exactly the plan for these seats. A seat whose rows already match keeps them (a changed date is updated in place, so the
    rows keep their ids); a seat whose rows differ in anything else is rewritten whole (its referrals first, they point at its partners), because the two tables have more than
    one unique key. shortcut: a one-field edit rewrites the seat's rows, fine for mock data, change to per-row updates if the rows ever carry state worth keeping."""
    seats = [s.seat_id for s in net.seats]
    have_p: dict[int, list[dict]] = {}
    for r in _of_seats(conn, schema, "network_partners", seats):
        have_p.setdefault(r["tier_agent_id"], []).append(r)
    have_r: dict[int, list[dict]] = {}
    for r in _of_seats(conn, schema, "network_referrals", seats):
        have_r.setdefault(r["tier_agent_id"], []).append(r)
    for s in net.seats:
        old_p = sorted(have_p.get(s.seat_id, []), key=lambda r: r["position"])
        old_r = sorted(have_r.get(s.seat_id, []), key=lambda r: (r["list_key"], r["position"]))
        names = {r["id"]: r["name"] for r in old_p}
        want_p = [{c: getattr(p, c) for c in _PARTNER_COLS} | {"is_mock": True} for p in s.partners]
        want_r = [{c: getattr(r, c) for c in _REFERRAL_COLS} | {"partner_name": r.partner_name, "is_mock": True} for r in sorted(s.referrals, key=lambda r: (r.list_key, r.position))]
        got_r = [{c: r[c] for c in _REFERRAL_COLS} | {"partner_name": names.get(r["partner_id"]), "is_mock": r["is_mock"]} for r in old_r]
        got_p = [{c: r[c] for c in (*_PARTNER_COLS, "is_mock")} for r in old_p]
        dated = lambda rows, col: [{k: v for k, v in r.items() if k != col} for r in rows]
        if dated(got_p, "reason_on") == dated(want_p, "reason_on") and dated(got_r, "occurred_on") == dated(want_r, "occurred_on"):
            for old, want in zip(old_p, want_p, strict=True):
                if old["reason_on"] != want["reason_on"]:
                    conn.execute(f"update {schema}.network_partners set reason_on = %s where id = %s", (want["reason_on"], old["id"]))
                    tally["updated"] += 1
            for old, want in zip(old_r, want_r, strict=True):
                if old["occurred_on"] != want["occurred_on"]:
                    conn.execute(f"update {schema}.network_referrals set occurred_on = %s where id = %s", (want["occurred_on"], old["id"]))
                    tally["updated"] += 1
            continue
        conn.execute(f"delete from {schema}.network_referrals where tier_agent_id = %s", (s.seat_id,))
        conn.execute(f"delete from {schema}.network_partners where tier_agent_id = %s", (s.seat_id,))
        tally["deleted"] += len(old_p) + len(old_r)
        ids: dict[str, int] = {}
        for want in want_p:
            cols = ["tier_agent_id", *want]
            ids[want["name"]] = conn.execute(
                f"insert into {schema}.network_partners ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) returning id", [s.seat_id, *want.values()]).fetchone()["id"]
            tally["inserted"] += 1
        for want in want_r:
            row = {k: v for k, v in want.items() if k != "partner_name"} | {"partner_id": ids[want["partner_name"]] if want["partner_name"] else None}
            cols = ["tier_agent_id", *row]
            conn.execute(f"insert into {schema}.network_referrals ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})", [s.seat_id, *row.values()])
            tally["inserted"] += 1


def apply_insights(conn: Any, schema: str, insights: ip.InsightsPlan, tally: dict[str, int]) -> None:
    """Make the Insights page's four tables hold exactly the plan for these seats. Runs after `apply_home`: a rival is found by its Home `position` and a map
    spot by its (row, col) in the seat's newest snapshot."""
    seats = [s.seat_id for s in insights.seats]
    vis = {(s.seat_id, v.metric): {"tier_agent_id": s.seat_id, "metric": v.metric, "value": v.value, "period_days": v.period_days, "source": v.source,
                                   "trust_tier": v.trust_tier, "is_mock": True} for s in insights.seats for v in s.visibility}
    _sync(conn, schema, "insights_visibility", _of_seats(conn, schema, "insights_visibility", seats), vis, lambda r: (r["tier_agent_id"], r["metric"]), tally)
    eng = {(s.seat_id, e.engine): {"tier_agent_id": s.seat_id, "engine": e.engine, "cited": e.cited, "checked": e.checked, "note": e.note, "is_mock": True}
           for s in insights.seats for e in s.engines}
    _sync(conn, schema, "insights_ai_engines", _of_seats(conn, schema, "insights_ai_engines", seats), eng, lambda r: (r["tier_agent_id"], r["engine"]), tally)
    rival = {(r["tier_agent_id"], r["position"]): r["id"] for r in _of_seats(conn, schema, "home_competitors", seats)}
    by_rival = {v: k for k, v in rival.items()}
    pos = {(s.seat_id, p.competitor_position): {"tier_agent_id": s.seat_id, "competitor_id": rival[(s.seat_id, p.competitor_position)],
                                                "avg_position": p.avg_position, "is_mock": True} for s in insights.seats for p in s.positions}
    _sync(conn, schema, "insights_competitor_positions", _of_seats(conn, schema, "insights_competitor_positions", seats), pos,
          lambda r: by_rival.get(r["competitor_id"], (r["tier_agent_id"], -r["competitor_id"])), tally)
    cells = conn.execute(
        f"select c.id, c.row_no, c.col_no, s.tier_agent_id from {schema}.home_map_cells c join {schema}.home_snapshots s on s.id = c.snapshot_id "
        "where s.tier_agent_id = any(%s) order by s.as_of, c.id", (seats,)).fetchall()
    cell_id = {(c["tier_agent_id"], c["row_no"], c["col_no"]): c["id"] for c in cells}  # the newest snapshot wins
    cell_ids = [c["id"] for c in cells]
    lead = {(cell_id[(s.seat_id, l.row, l.col)], l.position): {"cell_id": cell_id[(s.seat_id, l.row, l.col)], "position": l.position, "name": l.name,
                                                               "is_you": l.is_you, "is_mock": True} for s in insights.seats for l in s.leaders}
    _sync(conn, schema, "insights_spot_leaders", _of_parents(conn, schema, "insights_spot_leaders", "cell_id", cell_ids), lead,
          lambda r: (r["cell_id"], r["position"]), tally)


def apply_home(conn: Any, schema: str, home: hp.HomePlan, tally: dict[str, int]) -> None:
    """Make the `home_*` tables hold exactly the plan for these seats: reference rows first, then each table that others point at, then its children."""
    ref = home.reference
    seats = [s.seat_id for s in home.seats]

    def sync(table: str, existing: list[dict], desired: dict[Any, dict], key_of: Any) -> list[dict]:
        _sync(conn, schema, table, existing, desired, key_of, tally)
        return _all(conn, schema, table)

    lanes = sync("home_score_lanes", _all(conn, schema, "home_score_lanes"),
                 {l.key: {"key": l.key, "name": l.name, "max_points": l.max_points, "position": l.position, "short_name": l.short_name} for l in ref.lanes},
                 lambda r: r["key"])
    lane_id = {r["key"]: r["id"] for r in lanes}
    lane_key = {i: k for k, i in lane_id.items()}
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
    sync("srs_lane_gaps", _of_seats(conn, schema, "srs_lane_gaps", seats),
         {(s.seat_id, g.lane): {"tier_agent_id": s.seat_id, "lane_id": lane_id[g.lane], "you_text": g.you_text, "rival_text": g.rival_text, "note": g.note,
                                "is_missing": g.is_missing, "action_label": g.action_label, "action_target": g.action_target, "is_mock": True}
          for s in home.seats for g in s.gaps},
         lambda r: (r["tier_agent_id"], lane_key[r["lane_id"]]))
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
        f"select id, year_started, zipcode, profile_photo, title, description, phone_number, mobile_number from {schema}.tier_agents where id = any(%s) order by id", (seats,)
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
        profile = pp.build_profile_plan(seats, as_of or _today(), {p.seat_id: p.zipcode for p in plans})
        # the Web analytics checks come from the Home and Profile plans; the Home plan and the website tile column are then aligned with them (spec W3, W4)
        published = {p.seat_id: sum(1 for a in p.articles if a["published"] and not a["archived"]) for p in plans}
        urls = {p.seat_id: p.website["website_url"] for p in plans}
        web = wpn.build_web_plan(home, profile, published, urls)
        home = wpn.align_home(home, web)
        # the Connections accounts come from the Home and Profile plans; the Home plan (the SRS Connections count) and the Web plan (the Indexing source) follow them (spec C9 to C13)
        conns = cpn.build_connections_plan(home, profile, as_of or _today())
        home, web = cpn.align_home(home, conns), cpn.align_web(web, conns)
        # the Network partners and referrals come from the Home and Connections plans (spec N9 to N13) and correct nothing that exists
        net = npl.build_network_plan(home, conns, as_of or _today())
        lane = {s.seat_id: s.lane_points for s in web.seats}
        plans = [dataclasses.replace(p, website={**p.website, "total_score": lane[p.seat_id]}) for p in plans]
        insights = ip.build_insights_plan(home)
        planned = {
            "user_search_rank_scores": sum(len(p.scores) for p in plans),
            "voce_articles": sum(len(p.articles) for p in plans),
            "website_analytics_data": len(plans),
            "ai_authority_stats": sum(1 for p in plans if p.ai),
            "tier_agent_details": len(plans),
            **_home_planned(home),
            **_profile_planned(profile),
            **_insights_planned(insights),
            **_web_planned(web),
            **_connections_planned(conns),
            **_network_planned(net),
        }
        rankless = rankless_count(plans)
        if dry_run:
            return Report(len(plans), planned, {}, True, rankless)
        if backup_path is not None:
            write_backup(Path(backup_path), _backup_rows(conn, schema, seats))  # before any change
        changed = apply_plan(conn, schema, plans)
        apply_home(conn, schema, home, changed)
        apply_profile(conn, schema, profile, changed)
        apply_insights(conn, schema, insights, changed)
        apply_web(conn, schema, web, changed)
        apply_connections(conn, schema, conns, changed)
        apply_network(conn, schema, net, changed)
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
    except ValueError as exc:  # a seat's website lane cannot be split into the audit's checks: stop before anything is written
        print(f"{exc}; nothing was changed", file=sys.stderr)
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
