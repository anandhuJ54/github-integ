"""The SRS read service (srp/srs-page-schema, task 5): ownership, `ready`, score, band, rank, rival, the ten lanes (earned, open, status,
order), the filter counts and NORA's three notes.

The SQL itself runs on real Postgres in test_seat_srs_integration.py; here the database is a recording fake.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException

from _base.config import get_settings
from surfaces.srp.seat import srs
from surfaces.srp.seat.schemas import SrsResponse

SEAT = 42
USER = 7
CLAIMS = {"sub": str(USER)}
KEYS = {"as_of", "data", "ready", "score", "rank", "rival", "lanes", "counts", "notes"}
BANDS = [{"name": "Building", "min_points": 0}, {"name": "Established", "min_points": 400}, {"name": "Leading", "min_points": 600},
         {"name": "Elite", "min_points": 750}]
# The ten SRS v5 lanes (key, name, short name, budget). The default seat earns 390 of 850 and has the screen's sample gaps.
LANES = [("reviews", "Reviews", "Reviews", 187), ("completeness", "Completeness", "Completeness", 182), ("website", "Website", "Website", 102),
         ("articles", "Articles", "Articles", 103), ("gbp", "Google Business Profile", "GBP", 68), ("directories", "Directories", "Directories", 90),
         ("qa", "Q&A", "Q&A", 34), ("connections", "Connections", "Connections", 51), ("videos", "Videos", "Videos", 27), ("audio", "Audio", "Audio", 6)]
EARNED = {"reviews": 142, "completeness": 77, "website": 40, "articles": 18, "gbp": 67, "directories": 42, "qa": 0, "connections": 4, "videos": 0, "audio": 0}
GAPS = {
    "reviews": ("128", "412 reviews", "31 in the last 12 months", False, "See reviews", "reviews"),
    "completeness": ("Bio thin, service areas missing", "a full profile", None, False, "Fill my profile", "profile"),
    "website": ("No markup", "full markup", None, False, "Fix my website", "website"),
    "articles": ("0", "14 articles", None, True, "Start publishing", "voce"),
    "gbp": ("Connected", "Connected", "services added today", False, "View connection", "connections"),
    "directories": ("9 consistent", "28", None, False, "Unlock Listings", "billing"),
    "qa": ("0", "12 answered", None, True, "Answer questions", "chat"),
    "connections": ("2", "5 connected accounts", None, False, "Connect accounts", "connections"),
    "videos": ("Last video 23 months old", "a video a month", None, True, "Plan a video", "chat"),
    "audio": ("No audio", "3 episodes", None, True, "Plan a podcast", "chat"),
}


def snap(total=390, position=6):
    return {"id": 3, "as_of": datetime(2026, 10, 27, 12, 0), "total": total, "band_name": "Building", "rank_position": position, "rank_of": 41,
            "rank_city": "Davenport", "profile_strength_pct": 64, "review_avg": 4.9, "review_count": 128, "map_scanned_at": None, "ai_cited": 1,
            "ai_checked": 7, "ai_checked_at": datetime(2026, 10, 27, 10, 0)}


class SrsDB:
    """Answers each query the service runs from plain fields the tests change."""

    def __init__(self):
        self.owner = {"id": SEAT}
        self.state = {"is_mock": True, "plan_key": "core", "plan_position": 1}
        self.snaps = [snap()]
        self.lanes = [{"key": k, "name": n, "short_name": sn, "max_points": mx, "position": i + 1, "points": EARNED[k]} for i, (k, n, sn, mx) in enumerate(LANES)]
        self.bands = list(BANDS)
        self.comps = [{"name": "Riverbend Bank & Trust", "score": 571, "is_market_leader": True, "review_count": 412, "review_avg": 4.7, "article_count": 14, "position": 1},
                      {"name": "Prairie Home Lending", "score": 500, "is_market_leader": False, "review_count": 300, "review_avg": 4.5, "article_count": 9, "position": 2}]
        self.gaps = [{"key": k, "you_text": g[0], "rival_text": g[1], "note": g[2], "is_missing": g[3], "action_label": g[4], "action_target": g[5]} for k, g in GAPS.items()]
        self.locked = [{"lane_key": "directories", "plan_position": 2}, {"lane_key": "articles", "plan_position": 2}, {"lane_key": None, "plan_position": 3}]

    def set_points(self, **points):
        for lane in self.lanes:
            if lane["key"] in points:
                lane["points"] = points[lane["key"]]

    def lane(self, key):
        return next(r for r in self.lanes if r["key"] == key)

    def gap(self, key):
        return next(r for r in self.gaps if r["key"] == key)

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if low.startswith("set transaction"):
            return []
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            return [self.owner] if self.owner and int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.home_seat_state" in low:
            return [self.state] if self.state else []
        if "from srp_cleanup.home_snapshots" in low:
            return list(self.snaps)
        if "from srp_cleanup.home_score_lanes l" in low:
            return list(self.lanes)
        if "from srp_cleanup.srs_lane_gaps" in low:
            return list(self.gaps)
        if "from srp_cleanup.home_locked_features" in low:
            return list(self.locked)
        if "from srp_cleanup.home_score_bands" in low:
            return list(self.bands)
        if "from srp_cleanup.home_competitors" in low:
            return list(self.comps)
        raise AssertionError(f"unexpected SQL: {sql}")


@pytest.fixture
def db(monkeypatch, fake_db_for):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    s = SrsDB()
    rec = fake_db_for([])(s.responder)
    opened = []

    def conn():
        opened.append(1)
        return rec.role_connection("service")

    monkeypatch.setattr(srs, "connection", conn)
    s.rec, s.opened = rec, opened
    yield s
    get_settings.cache_clear()


def _srs():
    return srs.srs(CLAIMS, str(SEAT))


def _queries(db):
    return [q for q in db.rec.sql() if not q.lower().lstrip().startswith("set transaction")]


def _lanes(body):
    return {l["key"]: l for l in body["lanes"]}


# --- shape and ownership ---------------------------------------------------------------------------


def test_the_response_has_exactly_the_documented_keys(db):
    assert set(_srs()) == KEYS


def test_as_of_is_a_utc_time_stamp_and_data_says_mock(db):
    body = _srs()
    assert body["as_of"].endswith("Z") and body["data"] == "mock" and body["ready"] is True


def test_the_data_label_is_live_when_the_seat_is_not_mock(db):
    db.state["is_mock"] = False
    assert _srs()["data"] == "live"


@pytest.mark.parametrize("pro_id", ["43", "abc", "4 2", "-1", "42.0", "1" * 40])
def test_another_or_malformed_seat_is_403(db, pro_id):
    with pytest.raises(HTTPException) as e:
        srs.srs(CLAIMS, pro_id)
    assert e.value.status_code == 403 and e.value.detail == "not_your_seat"


def test_a_non_numeric_user_is_403_without_a_query(db):
    with pytest.raises(HTTPException) as e:
        srs.srs({"sub": "abc"}, str(SEAT))
    assert e.value.status_code == 403 and db.rec.log == []


def test_a_seat_that_is_not_the_users_runs_only_the_ownership_query(db):
    with pytest.raises(HTTPException):
        srs.srs({"sub": "8"}, str(SEAT))
    assert len(_queries(db)) == 1 and "from srp_cleanup.tier_agents ta" in _queries(db)[0].lower()


def test_ownership_uses_the_same_guards_as_home(db):
    _srs()
    sql = " ".join(_queries(db)[0].lower().split())
    for guard in ("ta.user_id = %s", "ta.deleted_at is null", "u.deleted_at is null", "u.deactivated_at is null", "is_manual_deactivated"):
        assert guard in sql


# --- reads only ------------------------------------------------------------------------------------


def test_the_transaction_is_declared_read_only_before_anything_else(db):
    _srs()
    assert db.rec.sql()[0].lower().strip() == "set transaction read only"
    assert "from srp_cleanup.tier_agents ta" in db.rec.sql()[1].lower()


def test_only_select_statements_run_on_one_connection_with_no_lock(db):
    _srs()
    assert len(db.opened) == 1
    for q in _queries(db):
        low = " ".join(q.lower().split())
        assert low.startswith(("select", "with")) and "for update" not in low and "for share" not in low, q


def test_it_reads_the_home_tables_and_the_gap_table_and_nothing_legacy(db):
    _srs()
    text = " ".join(" ".join(q.lower().split()) for q in _queries(db))
    for table in ("home_seat_state", "home_snapshots", "home_score_lanes", "home_score_bands", "home_competitors", "home_locked_features", "srs_lane_gaps"):
        assert f"srp_cleanup.{table}" in text, table
    for legacy in ("srs_config_", "user_search_rank_scores", "ai_authority_stats", "public."):
        assert legacy not in text, legacy


# --- ready -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("what", ["state", "snaps"])
def test_a_seat_with_no_home_rows_is_not_ready_and_every_section_is_null(db, what):
    setattr(db, what, None if what == "state" else [])
    body = _srs()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == {k: None for k in KEYS - {"as_of", "ready", "data"}}


def test_a_seat_that_is_not_ready_still_needed_its_ownership_check_first(db):
    db.state = None
    with pytest.raises(HTTPException):
        srs.srs({"sub": "8"}, str(SEAT))


# --- score, band, rank, rival ---------------------------------------------------------------------------


def test_the_score_is_the_newest_snapshot_with_the_lane_budget_total(db):
    assert _srs()["score"] == {"total": 390, "max": 850, "open_total": 460, "as_of": "2026-10-27T12:00:00Z",
                               "band": {"name": "Building", "min_points": 0, "next": {"name": "Established", "min_points": 400, "points_needed": 10}}}


@pytest.mark.parametrize("total,band,nxt,need", [
    (0, "Building", "Established", 400), (399, "Building", "Established", 1), (400, "Established", "Leading", 200),
    (599, "Established", "Leading", 1), (600, "Leading", "Elite", 150), (750, "Elite", None, None), (850, "Elite", None, None),
])
def test_the_band_and_the_points_to_the_next_one(db, total, band, nxt, need):
    db.snaps = [snap(total)]
    got = _srs()["score"]["band"]
    assert got["name"] == band
    assert (got["next"] or {}).get("name") == nxt and (got["next"] or {}).get("points_needed") == need


def test_the_open_total_is_the_budget_minus_the_total(db):
    db.snaps = [snap(500)]
    assert _srs()["score"]["open_total"] == 350


def test_rank_is_the_newest_snapshots(db):
    assert _srs()["rank"] == {"position": 6, "of": 41, "city": "Davenport"}


def test_a_snapshot_without_a_rank_gives_no_rank(db):
    db.snaps[0]["rank_position"] = None
    assert _srs()["rank"] is None


def test_the_rival_is_the_best_competitor_who_outscores_the_seat(db):
    assert _srs()["rival"] == {"name": "Riverbend Bank & Trust", "score": 571, "points_to_first": 181, "review_count": 412, "review_avg": 4.7}


def test_no_rival_when_nobody_outscores_the_seat(db):
    db.snaps = [snap(600)]
    assert _srs()["rival"] is None


# --- the lanes ----------------------------------------------------------------------------------------


def test_there_are_ten_lanes_whose_budgets_add_to_850_and_earned_plus_open_is_the_budget(db):
    lanes = _srs()["lanes"]
    assert len(lanes) == 10 and sum(l["max"] for l in lanes) == 850
    assert all(l["earned"] + l["open"] == l["max"] for l in lanes)
    assert sum(l["earned"] for l in lanes) == 390


def test_lanes_are_ordered_by_open_points_then_lane_position(db):
    keys = [l["key"] for l in _srs()["lanes"]]
    assert keys == ["completeness", "articles", "website", "directories", "connections", "reviews", "qa", "videos", "audio", "gbp"]


def test_equal_open_points_keep_the_lane_order(db):
    db.set_points(reviews=187 - 120, completeness=182 - 120)  # both 120 open, more than any other lane
    keys = [l["key"] for l in _srs()["lanes"]]
    assert keys[:2] == ["reviews", "completeness"]


def test_a_lane_carries_its_gap_texts_and_action(db):
    lane = _lanes(_srs())["reviews"]
    assert lane == {"key": "reviews", "name": "Reviews", "short_name": "Reviews", "earned": 142, "max": 187, "open": 45, "status": "Strong",
                    "you_text": "128", "rival_text": "412 reviews", "note": "31 in the last 12 months", "action_label": "See reviews", "action_target": "reviews"}


def test_a_lane_without_a_gap_row_has_no_texts_and_no_action(db):
    db.gaps = [g for g in db.gaps if g["key"] != "website"]
    lane = _lanes(_srs())["website"]
    assert (lane["you_text"], lane["rival_text"], lane["note"], lane["action_label"], lane["action_target"]) == (None, None, None, None, None)
    assert lane["status"] == "Fix"


def test_a_lane_without_a_short_name_returns_null_and_keeps_its_name(db):
    db.lane("gbp")["short_name"] = None
    assert _lanes(_srs())["gbp"]["short_name"] is None and _lanes(_srs())["gbp"]["name"] == "Google Business Profile"


@pytest.mark.parametrize("earned,status", [(74, "Fix"), (75, "Strong"), (76, "Strong"), (0, "Fix")])
def test_a_lane_is_strong_from_three_quarters_of_its_budget(db, earned, status):
    db.lane("reviews")["max_points"] = 100
    db.set_points(reviews=earned)
    db.gap("reviews")["is_missing"] = False
    assert _lanes(_srs())["reviews"]["status"] == status


@pytest.mark.parametrize("earned,status", [(140, "Fix"), (141, "Strong")])
def test_the_strong_boundary_holds_for_a_budget_that_is_not_round(db, earned, status):
    db.set_points(reviews=earned)
    assert _lanes(_srs())["reviews"]["status"] == status


def test_a_missing_lane_is_missing_unless_it_is_already_strong(db):
    db.gap("articles")["is_missing"] = True
    assert _lanes(_srs())["articles"]["status"] == "Missing"
    db.set_points(articles=103)
    assert _lanes(_srs())["articles"]["status"] == "Strong"


def test_a_lane_behind_a_higher_plan_is_locked_and_missing_wins_over_locked(db):
    lanes = _lanes(_srs())
    assert lanes["directories"]["status"] == "Fix · locked"
    assert lanes["articles"]["status"] == "Missing"  # articles is missing and locked: missing wins
    db.gap("articles")["is_missing"] = False
    assert _lanes(_srs())["articles"]["status"] == "Fix · locked"


def test_a_feature_of_the_seats_own_plan_or_lower_does_not_lock_its_lane(db):
    db.state["plan_position"] = 2
    assert _lanes(_srs())["directories"]["status"] == "Fix"
    db.state["plan_position"] = 1
    db.locked = [{"lane_key": "directories", "plan_position": 1}]
    assert _lanes(_srs())["directories"]["status"] == "Fix"


def test_a_feature_without_a_lane_locks_nothing(db):
    db.locked = [{"lane_key": None, "plan_position": 3}]
    assert all(l["status"] != "Fix · locked" for l in _srs()["lanes"])


def test_the_sample_seat_gets_the_screens_statuses(db):
    status = {k: l["status"] for k, l in _lanes(_srs()).items()}
    assert status == {"reviews": "Strong", "completeness": "Fix", "website": "Fix", "articles": "Missing", "gbp": "Strong", "directories": "Fix · locked",
                      "qa": "Missing", "connections": "Fix", "videos": "Missing", "audio": "Missing"}


def test_a_lane_with_no_points_in_the_snapshot_is_unknown_not_zero(db):
    db.lane("website")["points"] = None
    lane = _lanes(_srs())["website"]
    assert (lane["earned"], lane["open"], lane["status"]) == (None, None, None)
    assert _srs()["lanes"][-1]["key"] == "website", "unknown open points sort last"


# --- counts ------------------------------------------------------------------------------------------


def test_the_counts_group_the_statuses_and_locked_counts_as_fix(db):
    assert _srs()["counts"] == {"all": 10, "missing": 4, "fix": 4, "strong": 2}


def test_unknown_lanes_are_only_in_all(db):
    db.lane("website")["points"] = None
    assert _srs()["counts"] == {"all": 10, "missing": 4, "fix": 3, "strong": 2}


# --- notes -------------------------------------------------------------------------------------------


def test_the_three_notes_for_the_sample_seat(db):
    notes = _srs()["notes"]
    assert notes == [
        {"title": "Completeness gets you to Established.", "body": "It's 105 points open, and you only need 10 to cross 400.",
         "cta": "Fill my profile", "action": "profile"},
        {"title": "Your Articles is costing you 85 points.", "body": "Riverbend Bank & Trust: 14 articles. You: 0.", "cta": "Start publishing", "action": "voce"},
        {"title": "GBP is already strong.", "body": "services added today", "cta": "View connection", "action": "connections"},
    ]


def test_note_one_says_the_lane_gets_the_seat_to_the_next_band_when_it_is_enough(db):
    db.set_points(completeness=100, articles=10)  # completeness 82 open, articles 93 open (the most)
    first = _srs()["notes"][0]
    assert first == {"title": "Articles gets you to Established.", "body": "It's 93 points open, and you only need 10 to cross 400.",
                     "cta": "Start publishing", "action": "voce"}


def test_note_one_needs_the_lane_to_cover_the_whole_gap_to_the_next_band(db):
    db.snaps = [snap(300)]  # needs 100; the biggest open lane has 105 open: enough
    assert _srs()["notes"][0]["title"].endswith("gets you to Established.")
    db.set_points(completeness=100)  # 82 open: no lane has 100 open
    assert _srs()["notes"][0]["title"] == "Articles is your biggest gap."


def test_the_top_band_has_no_next_band_so_note_one_is_the_biggest_gap(db):
    db.snaps = [snap(760)]
    assert _srs()["notes"][0]["title"].endswith("is your biggest gap.")


def test_note_two_needs_a_rival(db):
    db.snaps = [snap(600)]
    titles = [n["title"] for n in _srs()["notes"]]
    assert not any(t.startswith("Your ") for t in titles)


def test_note_two_skips_lanes_without_a_rival_text_and_the_lane_of_note_one(db):
    db.gap("articles")["rival_text"] = None
    db.set_points(completeness=0)
    notes = _srs()["notes"]
    assert notes[0]["title"].startswith("Completeness") and notes[1]["title"] == "Your Website is costing you 62 points."


def test_note_three_is_the_strongest_lane_by_share_and_needs_a_strong_lane(db):
    assert _srs()["notes"][2]["title"] == "GBP is already strong."  # 67 of 68 beats 142 of 187
    db.set_points(reviews=10, gbp=10)
    assert len(_srs()["notes"]) == 2


def test_note_three_falls_back_to_the_texts_when_the_lane_has_no_note(db):
    db.gap("gbp")["note"] = None
    assert _srs()["notes"][2]["body"] == "Connected"
    db.gaps = [g for g in db.gaps if g["key"] != "gbp"]
    assert _srs()["notes"][2] == {"title": "GBP is already strong.", "body": "67 of 68 points earned.", "cta": None, "action": None}


def test_with_no_open_points_only_the_strong_note_remains_and_ties_go_to_the_first_lane(db):
    for lane in db.lanes:
        lane["points"] = lane["max_points"]
    db.snaps = [snap(850)]
    assert [n["title"] for n in _srs()["notes"]] == ["Reviews is already strong."]


def test_with_no_known_points_there_are_no_notes(db):
    for lane in db.lanes:
        lane["points"] = None
    assert _srs()["notes"] == [] and _srs()["counts"] == {"all": 10, "missing": 0, "fix": 0, "strong": 0}


def test_a_note_without_an_action_has_no_call_to_action(db):
    db.gaps = [g for g in db.gaps if g["key"] != "completeness"]
    first = _srs()["notes"][0]
    assert first["title"] == "Completeness gets you to Established." and first["cta"] is None and first["action"] is None


def test_note_one_counts_a_lane_that_exactly_covers_the_gap_to_the_next_band(db):
    db.snaps = [snap(295)]  # needs 105 and the biggest open lane has exactly 105 open
    assert _srs()["notes"][0]["title"] == "Completeness gets you to Established."


def test_the_budget_total_is_the_sum_of_the_lane_budgets_not_a_constant(db):
    db.lane("audio")["max_points"] = 16
    score = _srs()["score"]
    assert score["max"] == 860 and score["open_total"] == 470


def test_it_reads_only_the_newest_snapshot(db):
    _srs()
    sql = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.home_snapshots" in q.lower())
    assert "order by sn.as_of desc, sn.id desc limit 1" in sql and "sn.tier_agent_id = %s" in sql


# --- the response model --------------------------------------------------------------------------------------


def test_the_service_output_is_a_valid_srs_response(db):
    body = SrsResponse.model_validate(_srs()).model_dump()
    assert body == _srs() | {"as_of": body["as_of"]}


@pytest.mark.parametrize("what", ["state", "snaps"])
def test_a_not_ready_answer_is_a_valid_srs_response(db, what):
    setattr(db, what, None if what == "state" else [])
    body = SrsResponse.model_validate(_srs())
    assert body.ready is False and body.lanes is None and body.score is None


def test_the_response_model_refuses_an_unknown_status_or_target(db):
    body = _srs()
    body["lanes"][0]["status"] = "Great"
    with pytest.raises(ValueError):
        SrsResponse.model_validate(body)
    body = _srs()
    body["lanes"][0]["action_target"] = "elsewhere"
    with pytest.raises(ValueError):
        SrsResponse.model_validate(body)


def test_one_open_point_is_singular_in_the_notes(db):
    for lane in db.lanes:
        lane["points"] = lane["max_points"] - 1
    notes = _srs()["notes"]
    assert notes[0]["body"] == "It's 1 point open."
    assert notes[1]["title"] == "Your Completeness is costing you 1 point."


def test_one_point_needed_for_the_next_band_reads_naturally(db):
    db.snaps = [snap(399)]
    db.set_points(completeness=181)  # completeness has 1 open
    for lane in db.lanes:
        lane["points"] = lane["max_points"] - 1
    assert _srs()["notes"][0] == {"title": "Reviews gets you to Established.", "body": "It's 1 point open, and you only need 1 to cross 400.",
                                  "cta": "See reviews", "action": "reviews"}
