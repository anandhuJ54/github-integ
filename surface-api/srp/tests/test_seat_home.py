"""The Home read service, part 1 (srp/home-page-schema, task 6): ownership, `ready`, day and layout, person, trial, score, rank, rival.

The SQL itself runs on real Postgres in test_seat_home_integration.py; here the database is a recording fake.
"""
from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi import HTTPException

from _base.config import get_settings
from surfaces.srp.seat import home

SEAT = 42
USER = 7
CLAIMS = {"sub": str(USER)}
TODAY = date(2026, 10, 27)
KEYS = {"as_of", "data", "ready", "day", "person", "trial", "score", "rank", "rival", "competitors", "board", "tiles", "locked", "peers",
        "brief", "drafts", "events", "insights", "recap", "plans"}
BANDS = [{"name": "Building", "min_points": 0}, {"name": "Established", "min_points": 400}, {"name": "Leading", "min_points": 600},
         {"name": "Elite", "min_points": 750}]


def snap(sid, as_of, total, position=6, band="Building"):
    return {"id": sid, "as_of": as_of, "total": total, "band_name": band, "rank_position": position, "rank_of": 41, "rank_city": "Davenport",
            "profile_strength_pct": 64, "review_avg": 4.9, "review_count": 128, "map_scanned_at": None, "ai_cited": 1, "ai_checked": 7,
            "ai_checked_at": as_of}


class HomeDB:
    """Answers each query the service runs from plain fields the tests change."""

    def __init__(self):
        self.owner = {"id": SEAT, "title": "Loan officer", "profile_photo": "https://example.test/p.jpg", "year_started": "2014",
                      "first_name": "Pat", "last_name": "Example", "credentials": 2}
        self.state = {"moves_done": 2, "moves_goal": 3, "streak_weeks": 1, "trial_started_at": datetime(2026, 10, 20, 9, 0), "trial_days": 30, "nora_text_day": "Tuesday early morning", "is_mock": True,
                      "claim_snapshot_id": 1, "plan_key": "core", "plan_name": "Core", "plan_tag": "Free after your 30-day trial", "plan_position": 1}
        self.snaps = [snap(1, datetime(2026, 10, 20, 9, 0), 300, 12), snap(2, datetime(2026, 10, 20, 12, 0), 350, 9),
                      snap(3, datetime(2026, 10, 27, 12, 0), 420, 6, "Established")]
        self.lanes = [{"key": "reviews", "name": "Reviews", "max_points": 187, "points": 100}, {"key": "website", "name": "Website", "max_points": 102, "points": 60},
                      {"key": "audio", "name": "Audio", "max_points": 6, "points": None}]
        self.bands = list(BANDS)
        self.activities = [
            {"label": "Fixed 4 places", "points": 19, "status": "done", "started_at": datetime(2026, 10, 27, 9, 10), "completed_at": datetime(2026, 10, 27, 9, 30)},
            {"label": "Mapped 5 competitors", "points": None, "status": "done", "started_at": datetime(2026, 10, 27, 9, 40), "completed_at": datetime(2026, 10, 27, 10, 0)},
            {"label": "Adding your Google category", "points": 6, "status": "done", "started_at": datetime(2026, 10, 27, 10, 30), "completed_at": datetime(2026, 10, 27, 11, 0)}]
        self.moves = [{"position": 1, "icon": "pen", "title": "Start publishing", "subtitle": "Free VOCE credits.", "recommended": True, "target": "voce", "points": 85},
                      {"position": 2, "icon": "wrench", "title": "Fix my website", "subtitle": "Markup is missing", "recommended": False, "target": "website", "points": 42},
                      {"position": 3, "icon": "award", "title": "Add your credentials", "subtitle": "Certifications", "recommended": False, "target": "profile", "points": None}]
        self.locked = [
            {"feature_key": "listings", "title": "Listings", "description": "Directories miss you.", "lane_key": "reviews", "plan_key": "engage", "plan_position": 2},
            {"feature_key": "voce", "title": "VOCE", "description": "Points waiting in Articles.", "lane_key": "website", "plan_key": "engage", "plan_position": 2},
            {"feature_key": "map_rank", "title": "Map Rank tracking", "description": "See the week you pass the leader.", "lane_key": None, "plan_key": "amplify", "plan_position": 3}]
        self.peers = [{"band_name": "Building", "median_gain": 61, "horizon_days": 90, "cohort_size": 34, "cohort_period": "Jan–Sep 2026", "reached_next_band": 3, "cohort_of": 5},
                      {"band_name": "Established", "median_gain": 48, "horizon_days": 90, "cohort_size": 29, "cohort_period": "Jan–Sep 2026", "reached_next_band": 2, "cohort_of": 5}]
        self.brief = {"id": 9, "week_start": datetime(2026, 10, 20, 0, 0), "next_move_label": "Fix my website", "next_move_points": 42, "next_move_target": "website",
                      "away_new_reviews": 2, "away_bio_live": True, "away_first_article": False}
        self.brief_items = [{"position": 1, "label": "Bio approved", "points": 8}, {"position": 2, "label": "Service areas added", "points": 6}]
        self.drafts = [{"id": 1, "reviewer_label": "Reviewer A. (mock)", "rating": 5, "review_text": "Great", "draft_text": "Thanks", "compliance_status": "passed", "status": "draft"},
                       {"id": 2, "reviewer_label": "Reviewer B. (mock)", "rating": 2, "review_text": "Slow", "draft_text": "Sorry", "compliance_status": "needs_edit", "status": "draft"},
                       {"id": 3, "reviewer_label": "Reviewer C. (mock)", "rating": 4, "review_text": "Good", "draft_text": "Thanks", "compliance_status": "passed", "status": "posted"}]
        self.events = [{"kind": "review", "title": "A 2★ review needs you today", "body": "Drafted.", "action_label": "Review the draft", "expires_at": None},
                       {"kind": "facebook", "title": "Your Facebook connection expires Friday", "body": "Reconnect.", "action_label": "Reconnect", "expires_at": datetime(2026, 10, 30, 12, 0)},
                       {"kind": "facebook", "title": "Expired", "body": "Old.", "action_label": "Reconnect", "expires_at": datetime(2026, 10, 26, 12, 0)}]
        self.insights = [{"position": 1, "title": "Lead is content", "body": "They have 14 articles.", "cta": "Start publishing", "action": "voce"},
                         {"position": 2, "title": "Reviews", "body": "Compare.", "cta": "See reviews", "action": "reviews"},
                         {"position": 3, "title": "AI", "body": "Named 1 of 7.", "cta": "Want to see why?", "action": "insights"}]
        self.plans = [{"key": "core", "name": "Core", "tag": "Free", "highlight": False, "items": ["Your profile"]},
                      {"key": "engage", "name": "Engage", "tag": "Listings", "highlight": False, "items": ["Everything in Core"]},
                      {"key": "amplify", "name": "Amplify", "tag": "Includes Engage", "highlight": True, "items": ["Everything in Engage"]}]
        self.cells = [{"row_no": r, "col_no": c, "rank": (1 + (r + c) % 3) if r < 2 else (None if r > 4 else 5)} for r in range(7) for c in range(7)]
        self.articles = {"published": 3, "total": 4}
        self.web = {"total_score": 91, "website_url": "https://example.test/seat-42"}
        self.comps = [{"name": "Riverbend Bank & Trust", "score": 571, "is_market_leader": True, "review_count": 412, "review_avg": 4.7, "article_count": 14, "position": 1},
                      {"name": "Prairie Home Lending", "score": 500, "is_market_leader": False, "review_count": 300, "review_avg": 4.5, "article_count": 9, "position": 2}]

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if low.startswith("set transaction"):
            return []
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            return [self.owner] if self.owner and int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.home_seat_state" in low:
            return [self.state] if self.state else []
        if "from srp_cleanup.home_activity" in low:
            return list(self.activities)
        if "from srp_cleanup.home_next_moves" in low:
            return list(self.moves)
        if "from srp_cleanup.home_locked_features" in low:
            return list(self.locked)
        if "from srp_cleanup.home_peer_benchmarks" in low:
            return list(self.peers)
        if "from srp_cleanup.home_weekly_briefs" in low:
            return [self.brief] if self.brief else []
        if "from srp_cleanup.home_weekly_brief_items" in low:
            return list(self.brief_items)
        if "from srp_cleanup.home_review_drafts" in low:
            return list(self.drafts)
        if "from srp_cleanup.home_events" in low:
            return list(self.events)
        if "from srp_cleanup.home_nora_insights" in low:
            return list(self.insights)
        if "from srp_cleanup.home_plans" in low:
            return list(self.plans)
        if "from srp_cleanup.home_map_cells" in low:
            return list(self.cells)
        if "from srp_cleanup.voce_articles" in low:
            return [self.articles]
        if "from srp_cleanup.website_analytics_data" in low:
            return [self.web] if self.web else []
        if "from srp_cleanup.home_snapshots" in low:
            return list(self.snaps)
        if "from srp_cleanup.home_score_lanes" in low:
            return list(self.lanes)
        if "from srp_cleanup.home_score_bands" in low:
            return list(self.bands)
        if "from srp_cleanup.home_competitors" in low:
            return list(self.comps)
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.fixture
def db(monkeypatch, fake_db_for):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    s = HomeDB()
    rec = fake_db_for([])(s.responder)
    opened = []

    def conn():
        opened.append(1)
        return rec.role_connection("service")

    monkeypatch.setattr(home, "connection", conn)
    monkeypatch.setattr(home, "_today", lambda: TODAY)
    s.rec, s.opened = rec, opened
    yield s
    get_settings.cache_clear()


def _home():
    return home.home(CLAIMS, str(SEAT))


def _queries(db):
    return [q for q in db.rec.sql() if not q.lower().lstrip().startswith("set transaction")]


# --- shape and ownership ---------------------------------------------------------------------------


def test_the_response_has_exactly_the_documented_keys(db):
    assert set(_home()) == KEYS


def test_as_of_is_a_utc_time_stamp_and_data_says_mock(db):
    body = _home()
    assert body["as_of"].endswith("Z") and body["data"] == "mock" and body["ready"] is True


def test_the_data_label_is_live_when_the_seat_is_not_mock(db):
    db.state["is_mock"] = False
    assert _home()["data"] == "live"


@pytest.mark.parametrize("pro_id", ["43", "abc", "4 2", "-1", "42.0", "1" * 40])
def test_another_or_malformed_seat_is_403(db, pro_id):
    with pytest.raises(HTTPException) as e:
        home.home(CLAIMS, pro_id)
    assert e.value.status_code == 403 and e.value.detail == "not_your_seat"


def test_a_non_numeric_user_is_403_without_a_query(db):
    with pytest.raises(HTTPException) as e:
        home.home({"sub": "abc"}, str(SEAT))
    assert e.value.status_code == 403 and db.rec.log == []


def test_a_seat_that_is_not_the_users_runs_only_the_ownership_query(db):
    with pytest.raises(HTTPException):
        home.home({"sub": "8"}, str(SEAT))
    assert len(_queries(db)) == 1 and "from srp_cleanup.tier_agents ta" in _queries(db)[0].lower()


def test_ownership_requires_an_active_user_and_a_live_seat(db):
    _home()
    sql = " ".join(_queries(db)[0].lower().split())
    for guard in ("ta.user_id = %s", "ta.deleted_at is null", "u.deleted_at is null", "u.deactivated_at is null", "is_manual_deactivated"):
        assert guard in sql


# --- reads only ------------------------------------------------------------------------------------


def test_the_transaction_is_declared_read_only_before_anything_else(db):
    _home()
    assert db.rec.sql()[0].lower().strip() == "set transaction read only"
    assert "from srp_cleanup.tier_agents ta" in db.rec.sql()[1].lower()


def test_only_select_statements_run_on_one_connection_with_no_lock(db):
    _home()
    assert len(db.opened) == 1
    for q in _queries(db):
        low = " ".join(q.lower().split())
        assert low.startswith(("select", "with")) and "for update" not in low and "for share" not in low, q


# --- ready -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("what", ["state", "snaps"])
def test_a_seat_with_no_home_rows_is_not_ready_and_every_section_is_null(db, what):
    setattr(db, what, None if what == "state" else [])
    body = _home()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == {k: None for k in KEYS - {"as_of", "ready", "data"}}


def test_a_seat_that_is_not_ready_still_needed_its_ownership_check_first(db):
    db.state = None
    with pytest.raises(HTTPException):
        home.home({"sub": "8"}, str(SEAT))


# --- day and layout ---------------------------------------------------------------------------------


@pytest.mark.parametrize("started,n,layout,over", [
    (date(2026, 10, 27), 1, "day1", False), (date(2026, 10, 22), 6, "day1", False), (date(2026, 10, 21), 7, "day7", False),
    (date(2026, 10, 5), 23, "day7", False), (date(2026, 10, 4), 24, "day24", False), (date(2026, 9, 28), 30, "day24", False),
    (date(2026, 9, 27), 30, "day24", True), (date(2026, 8, 1), 30, "day24", True), (date(2026, 10, 29), 1, "day1", False),
])
def test_the_day_number_and_layout_follow_the_trial_start(db, started, n, layout, over):
    db.state["trial_started_at"] = datetime.combine(started, datetime.min.time()).replace(hour=9)
    assert _home()["day"] == {"n": n, "trial_days": 30, "layout": layout, "over": over}


def test_a_shorter_trial_is_over_sooner(db):
    db.state["trial_days"] = 10
    db.state["trial_started_at"] = datetime(2026, 10, 10, 9, 0)  # day 18
    assert _home()["day"] == {"n": 10, "trial_days": 10, "layout": "day7", "over": True}


# --- person and trial -------------------------------------------------------------------------------


def test_person_comes_from_the_user_and_the_seat(db):
    assert _home()["person"] == {"first_name": "Pat", "full_name": "Pat Example", "title": "Loan officer", "photo_url": "https://example.test/p.jpg",
                                 "year_started": 2014, "credentials": 2}


def test_a_missing_last_name_or_a_text_year_is_handled(db):
    db.owner.update(last_name=None, year_started="n/a", profile_photo=None, title=None)
    assert _home()["person"] == {"first_name": "Pat", "full_name": "Pat", "title": None, "photo_url": None, "year_started": None, "credentials": 2}


def test_trial_carries_the_plan_and_the_dates(db):
    assert _home()["trial"] == {"plan": {"key": "core", "name": "Core", "tag": "Free after your 30-day trial"},
                                "started_at": "2026-10-20T09:00:00Z", "nora_text_day": "Tuesday early morning"}


# --- score ------------------------------------------------------------------------------------------


def test_score_is_the_newest_snapshot_with_its_band_lanes_and_maximum(db):
    s = _home()["score"]
    assert s["total"] == 420 and s["max"] == 295 and s["as_of"] == "2026-10-27T12:00:00Z"
    assert s["band"] == {"name": "Established", "min_points": 400, "next": {"name": "Leading", "min_points": 600}}
    assert s["lanes"] == [{"key": "reviews", "name": "Reviews", "points": 100, "max": 187}, {"key": "website", "name": "Website", "points": 60, "max": 102},
                          {"key": "audio", "name": "Audio", "points": None, "max": 6}]


@pytest.mark.parametrize("total,band,nxt", [
    (0, "Building", ("Established", 400)), (399, "Building", ("Established", 400)), (400, "Established", ("Leading", 600)),
    (599, "Established", ("Leading", 600)), (600, "Leading", ("Elite", 750)), (749, "Leading", ("Elite", 750)), (750, "Elite", None), (850, "Elite", None),
])
def test_band_edges(db, total, band, nxt):
    db.snaps[-1]["total"] = total
    b = _home()["score"]["band"]
    assert b["name"] == band and (b["next"] and (b["next"]["name"], b["next"]["min_points"])) == (nxt or None)


def test_no_bands_means_no_band(db):
    db.bands = []
    assert _home()["score"]["band"] is None


def test_since_claim_is_the_gain_over_the_claim_snapshot(db):
    assert _home()["score"]["since_claim"] == 120


def test_since_claim_is_null_without_a_claim_snapshot(db):
    db.state["claim_snapshot_id"] = None
    assert _home()["score"]["since_claim"] is None


def test_since_claim_is_null_when_the_claim_snapshot_is_gone(db):
    db.state["claim_snapshot_id"] = 99
    assert _home()["score"]["since_claim"] is None


def test_week_delta_is_the_gain_over_the_newest_snapshot_a_week_older(db):
    assert _home()["score"]["week_delta"] == 70           # 420 - 350 (exactly 7 days older)


def test_a_snapshot_less_than_a_week_old_is_not_the_weekly_baseline(db):
    db.snaps[1]["as_of"] = datetime(2026, 10, 20, 12, 1)
    assert _home()["score"]["week_delta"] == 120          # falls back to the claim snapshot, which is older than a week


def test_week_delta_is_null_with_no_snapshot_a_week_older(db):
    db.snaps = [snap(1, datetime(2026, 10, 25, 9, 0), 300), snap(3, datetime(2026, 10, 27, 12, 0), 420)]
    assert _home()["score"]["week_delta"] is None


def test_a_single_snapshot_has_no_weekly_change(db):
    db.snaps = [snap(1, datetime(2026, 10, 27, 12, 0), 420)]
    assert _home()["score"]["week_delta"] is None


def test_the_maximum_is_unknown_without_lanes(db):
    db.lanes = []
    assert _home()["score"]["max"] is None and _home()["score"]["lanes"] == []


# --- rank, rival, competitors ----------------------------------------------------------------------------


def test_rank_is_the_newest_position_with_the_earliest_for_the_recap(db):
    assert _home()["rank"] == {"position": 6, "of": 41, "city": "Davenport", "first_position": 12}


def test_no_rank_position_means_no_rank(db):
    db.snaps[-1]["rank_position"] = None
    assert _home()["rank"] is None


def test_the_rival_is_the_top_competitor_above_the_seat(db):
    assert _home()["rival"] == {"name": "Riverbend Bank & Trust", "initial": "R", "score": 571, "points_to_first": 151, "review_count": 412,
                                "review_avg": 4.7, "article_count": 14}
    assert _home()["competitors"] == {"count": 2}


def test_there_is_no_rival_when_nobody_outscores_the_seat(db):
    db.snaps[-1]["total"] = 571
    body = _home()
    assert body["rival"] is None and body["competitors"] == {"count": 2}


def test_a_competitor_tied_with_the_seat_is_not_a_rival(db):
    db.comps = [dict(db.comps[0], score=420)]
    assert _home()["rival"] is None


def test_the_rival_is_the_highest_score_whatever_the_flag_says(db):
    db.comps = [dict(db.comps[1], position=1, is_market_leader=True), dict(db.comps[0], position=2, is_market_leader=False)]
    assert _home()["rival"]["name"] == "Riverbend Bank & Trust"


def test_no_competitors_means_no_rival_and_a_zero_count(db):
    db.comps = []
    body = _home()
    assert body["rival"] is None and body["competitors"] == {"count": 0}


# --- part 2 (task 7): board, tiles, locked, peers, brief, drafts, events, insights, recap, plans ------------------------


def test_the_board_lists_done_items_newest_first_and_adds_up_their_points(db):
    b = _home()["board"]
    assert [d["label"] for d in b["done"]] == ["Adding your Google category", "Mapped 5 competitors", "Fixed 4 places"]
    assert b["done"][1] == {"label": "Mapped 5 competitors", "points": None}
    assert b["done_count"] == 3 and b["since_claim_points"] == 25


def test_the_latest_activity_is_the_newest_by_its_finish_or_start_time(db):
    assert _home()["board"]["latest"] == {"label": "Adding your Google category", "points": 6, "status": "done",
                                          "started_at": "2026-10-27T10:30:00Z", "completed_at": "2026-10-27T11:00:00Z"}


def test_an_item_in_progress_is_the_latest_but_not_done(db):
    db.activities.append({"label": "Writing your first article", "points": None, "status": "doing", "started_at": datetime(2026, 10, 27, 11, 56), "completed_at": None})
    b = _home()["board"]
    assert b["latest"]["status"] == "doing" and b["latest"]["completed_at"] is None and b["done_count"] == 3 and len(b["done"]) == 3


def test_an_activity_with_no_dates_does_not_break_the_page(db):
    # the table allows both times to be null (second review): such a row sorts first, so a dated row stays the latest
    db.activities.append({"label": "Undated", "points": 2, "status": "done", "started_at": None, "completed_at": None})
    b = _home()["board"]
    assert b["latest"]["label"] == "Adding your Google category" and b["done_count"] == 4


def test_plan_items_that_are_not_a_list_become_an_empty_list(db):
    db.plans[0]["items"] = {"a": 1}
    assert _home()["plans"][0]["items"] == []


def test_no_activity_means_no_latest_and_zeros(db):
    db.activities = []
    b = _home()["board"]
    assert b["latest"] is None and b["done"] == [] and b["done_count"] == 0 and b["since_claim_points"] == 0


def test_the_board_carries_moves_streak_next_moves_and_the_needs_you_count(db):
    b = _home()["board"]
    assert b["moves"] == {"done": 2, "goal": 3} and b["streak_weeks"] == 1 and b["needs_you_count"] == 2
    assert [m["title"] for m in b["next_moves"]] == ["Start publishing", "Fix my website", "Add your credentials"]
    assert b["next_moves"][0] == {"icon": "pen", "title": "Start publishing", "subtitle": "Free VOCE credits.", "recommended": True, "target": "voce", "points": 85}


def test_the_map_tile_counts_top_three_cells_and_keeps_the_cells(db):
    m = _home()["tiles"]["map"]
    assert m["total"] == 49 and m["top3"] == sum(1 for c in db.cells if c["rank"] is not None and c["rank"] <= 3)
    assert len(m["cells"]) == 49 and m["cells"][0] == {"row": 0, "col": 0, "rank": 1} and m["scanned_at"] is None


def test_the_map_scan_time_is_the_newest_snapshots(db):
    db.snaps[-1]["map_scanned_at"] = datetime(2026, 10, 20, 8, 0)
    assert _home()["tiles"]["map"]["scanned_at"] == "2026-10-20T08:00:00Z"


def test_no_map_cells_means_no_map_tile(db):
    db.cells = []
    assert _home()["tiles"]["map"] is None


def test_the_ai_reviews_and_profile_tiles_come_from_the_newest_snapshot(db):
    t = _home()["tiles"]
    assert t["ai"] == {"cited": 1, "checked": 7, "checked_at": "2026-10-27T12:00:00Z"}
    assert t["reviews"] == {"avg": 4.9, "count": 128, "as_of": "2026-10-27T12:00:00Z"}
    assert t["profile_strength"]["pct"] == 64


def test_profile_strength_compares_with_the_week_baseline_else_the_claim(db):
    db.snaps[1]["profile_strength_pct"] = 50
    db.snaps[0]["profile_strength_pct"] = 40
    assert _home()["tiles"]["profile_strength"] == {"pct": 64, "previous_pct": 50}
    db.snaps[1]["as_of"] = datetime(2026, 10, 24, 12, 0)             # no longer a week old: falls back to the claim snapshot
    assert _home()["tiles"]["profile_strength"]["previous_pct"] == 40


def test_a_single_snapshot_has_no_previous_profile_strength(db):
    db.snaps = [snap(3, datetime(2026, 10, 27, 12, 0), 420)]
    assert _home()["tiles"]["profile_strength"]["previous_pct"] is None


def test_the_ai_tile_is_null_when_nothing_was_checked(db):
    db.snaps[-1]["ai_checked"] = None
    assert _home()["tiles"]["ai"] is None


def test_the_website_and_articles_tiles(db):
    t = _home()["tiles"]
    assert t["website"] == {"score": 91, "max": 102, "url": "https://example.test/seat-42"} and t["articles"] == {"published": 3, "total": 4}


def test_no_website_row_means_no_website_tile_and_no_articles_is_a_real_zero(db):
    db.web = None
    db.articles = {"published": 0, "total": 0}
    t = _home()["tiles"]
    assert t["website"] is None and t["articles"] == {"published": 0, "total": 0}


def test_locked_features_are_those_above_the_seats_plan_with_their_points_waiting(db):
    locked = _home()["locked"]
    assert [f["key"] for f in locked["features"]] == ["listings", "voce", "map_rank"]
    assert locked["features"][0] == {"key": "listings", "title": "Listings", "description": "Directories miss you.", "points_waiting": 87, "plan": "engage"}
    assert locked["features"][1]["points_waiting"] == 42 and locked["features"][2]["points_waiting"] is None
    assert locked["points_waiting"] == 129


def test_a_higher_plan_unlocks_what_it_includes(db):
    db.state["plan_position"] = 2
    assert [f["key"] for f in _home()["locked"]["features"]] == ["map_rank"]
    db.state["plan_position"] = 3
    assert _home()["locked"] == {"features": [], "points_waiting": 0}


def test_points_waiting_never_goes_below_zero_and_is_unknown_without_lane_points(db):
    db.lanes[0]["points"] = 999
    assert _home()["locked"]["features"][0]["points_waiting"] == 0
    db.lanes[0]["points"] = None
    assert _home()["locked"]["features"][0]["points_waiting"] is None


def test_the_peer_benchmark_is_for_the_band_the_seat_started_in(db):
    assert _home()["peers"] == {"band_from": "Building", "median_gain": 61, "horizon_days": 90, "cohort_size": 34, "cohort_period": "Jan–Sep 2026",
                                "reached_next_band": 3, "of": 5}
    db.snaps[0]["total"] = 450
    assert _home()["peers"]["band_from"] == "Established" and _home()["peers"]["median_gain"] == 48


def test_no_benchmark_for_that_band_means_no_peers(db):
    db.snaps[0]["total"] = 700
    assert _home()["peers"] is None


def test_the_brief_adds_up_its_items_and_carries_the_next_move_and_away_summary(db):
    b = _home()["brief"]
    assert b == {"week_start": "2026-10-20T00:00:00Z", "points_total": 14, "items": [{"label": "Bio approved", "points": 8}, {"label": "Service areas added", "points": 6}],
                 "next_move": {"label": "Fix my website", "points": 42, "target": "website"}, "away": {"new_reviews": 2, "bio_live": True, "first_article": False}}


def test_no_brief_row_means_no_brief(db):
    db.brief = None
    assert _home()["brief"] is None


def test_only_open_drafts_are_listed(db):
    d = _home()["drafts"]
    assert [x["id"] for x in d] == [1, 2] and d[1] == {"id": 2, "reviewer_label": "Reviewer B. (mock)", "rating": 2, "review_text": "Slow", "draft_text": "Sorry",
                                                       "compliance_status": "needs_edit", "status": "draft"}


def test_expired_events_are_left_out_and_open_ended_ones_stay(db):
    e = _home()["events"]
    assert [x["kind"] for x in e] == ["review", "facebook"] and e[0]["expires_at"] is None and e[1]["expires_at"] == "2026-10-30T12:00:00Z"
    assert all(x["title"] != "Expired" for x in e)


def test_insights_and_plans_are_listed_in_order(db):
    body = _home()
    assert [i["position"] for i in body["insights"]] == [1, 2, 3] and body["insights"][0]["action"] == "voce"
    assert [p["key"] for p in body["plans"]] == ["core", "engage", "amplify"] and body["plans"][2] == {"key": "amplify", "name": "Amplify", "tag": "Includes Engage",
                                                                                                          "highlight": True, "items": ["Everything in Engage"]}


def test_the_recap_only_exists_on_the_day_24_layout(db):
    assert _home()["recap"] is None
    db.state["trial_started_at"] = datetime(2026, 10, 3, 9, 0)    # day 25
    r = _home()["recap"]
    assert r["days"] == 25 and r["things_done"] == 3 and r["articles"] == 3 and r["replies"] == 1
    assert r["tiles"] == [{"label": "Score", "from": 300, "to": 420, "delta": 120}, {"label": "Rank", "from": 12, "to": 6, "delta": 6},
                          {"label": "Profile strength", "from": 64, "to": 64, "delta": 0}]


def test_the_recap_leaves_out_a_rank_tile_it_cannot_compute(db):
    db.state["trial_started_at"] = datetime(2026, 10, 3, 9, 0)
    db.snaps[0]["rank_position"] = None
    assert [t["label"] for t in _home()["recap"]["tiles"]] == ["Score", "Profile strength"]


def test_part_two_still_reads_only_with_selects_on_one_connection(db):
    _home()
    assert len(db.opened) == 1
    assert all(" ".join(q.lower().split()).startswith(("select", "with")) and "for update" not in q.lower() for q in _queries(db))


def test_a_rank_that_got_worse_has_a_negative_delta(db):
    db.state["trial_started_at"] = datetime(2026, 10, 3, 9, 0)
    db.snaps[0]["rank_position"], db.snaps[-1]["rank_position"] = 6, 12
    assert [t for t in _home()["recap"]["tiles"] if t["label"] == "Rank"] == [{"label": "Rank", "from": 6, "to": 12, "delta": -6}]
