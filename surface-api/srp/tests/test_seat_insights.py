"""The Insights read service (srp/insights-page-schema, task 5): ownership, `ready`, the visibility figures, the map with its leaders, the AI engines, the
competitor table with the seat's computed average, the target, the locked cards and NORA's two notes.

The SQL itself runs on real Postgres in test_seat_insights_integration.py; here the database is a recording fake.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException

from _base.config import get_settings
from surfaces.srp.seat import insights
from surfaces.srp.seat.schemas import InsightsResponse

SEAT = 42
USER = 7
CLAIMS = {"sub": str(USER)}
KEYS = {"as_of", "data", "ready", "visibility", "map", "ai", "competitors", "target", "locked", "notes"}
METRICS = ["search_views", "maps_views", "calls", "directions", "website_clicks", "profile_views"]


def vis(metric, value, source="From Google", tier="imported", mock=True, days=30):
    return {"metric": metric, "value": value, "period_days": days, "source": source, "trust_tier": tier, "is_mock": mock}


def eng(engine, cited, checked, note="A note.", mock=True):
    return {"engine": engine, "cited": cited, "checked": checked, "note": note, "is_mock": mock}


def comp(position, name, score=500, leader=False, reviews=100, avg=4.5, articles=5):
    return {"id": 100 + position, "name": name, "score": score, "is_market_leader": leader, "review_count": reviews, "review_avg": avg,
            "article_count": articles, "position": position}


class InsDB:
    """Answers each query the service runs from plain fields the tests change."""

    def __init__(self):
        self.owner = {"id": SEAT, "first_name": "Pat", "last_name": "Example"}
        self.vis = [vis("search_views", 1240), vis("maps_views", 860), vis("calls", 41), vis("directions", 18), vis("website_clicks", 57),
                    vis("profile_views", 312, "From Experience.com", "platform_observed")]
        self.engines = [eng("chatgpt", 1, 3, "Names you for refinance questions."), eng("gemini", 0, 2, "Does not mention you yet."),
                        eng("perplexity", 0, 2, "Gives no answer that mentions you.")]
        self.snap = {"id": 900, "review_avg": 4.9, "review_count": 128, "map_scanned_at": datetime(2026, 10, 16, 9, 0)}
        # 49 cells: the first 3 ranked 2, 1, 3; the next 6 ranked 7; the rest "20+" (None)
        ranks = [2, 1, 3] + [7] * 6 + [None] * 40
        self.cells = [{"id": 1000 + i, "row_no": i // 7, "col_no": i % 7, "rank": ranks[i]} for i in range(49)]
        self.rivals = [comp(1, "Riverbend Bank & Trust", leader=True, reviews=412, avg=4.7, articles=14), comp(2, "Prairie Home Lending", reviews=230, avg=4.8),
                       comp(3, "Bluff City Mortgage", reviews=188, avg=4.6), comp(4, "Mississippi Valley Loans", reviews=96, avg=4.5),
                       comp(5, "Heartland Credit Union", reviews=151, avg=4.4)]
        self.positions = [{"competitor_id": 101, "avg_position": 2.1, "is_mock": True}, {"competitor_id": 102, "avg_position": 3.4, "is_mock": True},
                          {"competitor_id": 103, "avg_position": 4.0, "is_mock": True}, {"competitor_id": 104, "avg_position": 5.2, "is_mock": True},
                          {"competitor_id": 105, "avg_position": 5.9, "is_mock": True}]
        self.leaders = []
        for c in self.cells:
            you = c["rank"] if c["rank"] is not None and c["rank"] <= 3 else None
            names = iter(["Prairie Home Lending", "Bluff City Mortgage", "Riverbend Bank & Trust"])
            for p in (1, 2, 3):
                self.leaders.append({"cell_id": c["id"], "position": p, "name": None if you == p else next(names), "is_you": you == p, "is_mock": True})
        self.address = "100 Main St, Davenport, IA 52801"
        self.state = {"plan_position": 1, "top_position": 3}

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if low.startswith("set transaction"):
            return []
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            return [self.owner] if self.owner and int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.insights_visibility" in low:
            return list(self.vis)
        if "from srp_cleanup.insights_ai_engines" in low:
            return list(self.engines)
        if "from srp_cleanup.insights_competitor_positions" in low:
            return list(self.positions)
        if "from srp_cleanup.insights_spot_leaders" in low:
            return list(self.leaders)
        if "from srp_cleanup.home_snapshots" in low:
            return [self.snap] if self.snap else []
        if "from srp_cleanup.home_map_cells" in low:
            return list(self.cells) if self.snap else []
        if "from srp_cleanup.home_competitors" in low:
            return list(self.rivals)
        if "from srp_cleanup.profile_facts" in low:
            return [{"value": self.address}] if self.address else []
        if "from srp_cleanup.home_seat_state" in low:
            return [self.state] if self.state else []
        raise AssertionError(f"unexpected SQL: {sql}")

    def set_ranks(self, ranks):
        for c, r in zip(self.cells, ranks, strict=True):
            c["rank"] = r


@pytest.fixture
def db(monkeypatch, fake_db_for):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    s = InsDB()
    rec = fake_db_for([])(s.responder)
    opened = []

    def conn():
        opened.append(1)
        return rec.role_connection("service")

    monkeypatch.setattr(insights, "connection", conn)
    s.rec, s.opened = rec, opened
    yield s
    get_settings.cache_clear()


def _read():
    return insights.insights(CLAIMS, str(SEAT))


def _queries(db):
    return [q for q in db.rec.sql() if not q.lower().lstrip().startswith("set transaction")]


def _comps(body):
    return {c["name"]: c for c in body["competitors"]}


# --- shape and ownership ---------------------------------------------------------------------------


def test_the_response_has_exactly_the_documented_keys_and_validates_against_the_model(db):
    body = _read()
    assert set(body) == KEYS
    InsightsResponse.model_validate(body)


def test_as_of_is_a_utc_time_stamp_and_data_says_mock(db):
    body = _read()
    assert body["as_of"].endswith("Z") and body["data"] == "mock" and body["ready"] is True


def test_the_data_label_is_live_only_when_no_row_is_mock(db):
    for rows in (db.vis, db.engines, db.positions, db.leaders):
        for r in rows:
            r["is_mock"] = False
    assert _read()["data"] == "live"
    db.leaders[-1]["is_mock"] = True
    assert _read()["data"] == "mock"
    db.leaders[-1]["is_mock"] = False
    db.vis[0]["is_mock"] = True
    assert _read()["data"] == "mock"


@pytest.mark.parametrize("pro_id", ["43", "abc", "4 2", "-1", "42.0", "1" * 40])
def test_another_or_malformed_seat_is_403(db, pro_id):
    with pytest.raises(HTTPException) as e:
        insights.insights(CLAIMS, pro_id)
    assert e.value.status_code == 403 and e.value.detail == "not_your_seat"


def test_a_non_numeric_user_is_403_without_a_query(db):
    with pytest.raises(HTTPException) as e:
        insights.insights({"sub": "abc"}, str(SEAT))
    assert e.value.status_code == 403 and db.rec.log == []


def test_a_seat_that_is_not_the_users_runs_only_the_ownership_query(db):
    with pytest.raises(HTTPException):
        insights.insights({"sub": "8"}, str(SEAT))
    assert len(_queries(db)) == 1 and "from srp_cleanup.tier_agents ta" in _queries(db)[0].lower()


# --- reads only ------------------------------------------------------------------------------------


def test_the_transaction_is_declared_read_only_before_anything_else(db):
    _read()
    assert db.rec.sql()[0].lower().strip() == "set transaction read only"
    assert "from srp_cleanup.tier_agents ta" in db.rec.sql()[1].lower()


def test_only_select_statements_run_on_one_connection_with_no_lock(db):
    _read()
    assert len(db.opened) == 1
    for q in _queries(db):
        low = " ".join(q.lower().split())
        assert low.startswith(("select", "with")) and "for update" not in low and "for share" not in low, q


def test_it_reads_only_the_insights_tables_and_the_home_and_profile_ones_it_needs(db):
    _read()
    text = " ".join(" ".join(q.lower().split()) for q in _queries(db))
    for table in ("tier_agents", "users", "home_snapshots", "home_map_cells", "home_competitors", "home_seat_state", "home_plans", "profile_facts",
                  "insights_visibility", "insights_ai_engines", "insights_competitor_positions", "insights_spot_leaders"):
        assert f"srp_cleanup.{table}" in text, table
    for other in ("google_analytics", "ai_authority_stats", "srs_config_", "user_search_rank_scores", "locations", "tier_locations", "public."):
        assert other not in text, other
    snap = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.home_snapshots" in q.lower())
    assert "order by as_of desc, id desc limit 1" in snap


# --- ready ---------------------------------------------------------------------------------------


def test_a_seat_with_no_insights_rows_is_not_ready_and_every_section_is_null(db):
    db.vis, db.engines, db.positions, db.leaders = [], [], [], []
    body = _read()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(KEYS - {"as_of", "ready", "data"})


def test_one_table_with_rows_is_enough_to_be_ready(db):
    db.vis, db.engines, db.positions = [], [], []
    body = _read()
    assert body["ready"] is True and body["visibility"] == [] and body["ai"] is None
    db.leaders = []
    db.positions = [{"competitor_id": 101, "avg_position": 2.1, "is_mock": True}]
    assert _read()["ready"] is True


def test_a_seat_that_is_not_ready_still_needed_its_ownership_check_first(db):
    db.vis, db.engines, db.positions, db.leaders = [], [], [], []
    with pytest.raises(HTTPException):
        insights.insights({"sub": "8"}, str(SEAT))


# --- visibility ------------------------------------------------------------------------------------


def test_the_visibility_figures_keep_the_pages_order_and_carry_a_source_line(db):
    db.vis.reverse()
    v = _read()["visibility"]
    assert [x["metric"] for x in v] == METRICS
    assert v[0] == {"metric": "search_views", "value": 1240, "period_days": 30, "source": "From Google", "trust_tier": "imported",
                    "source_line": "Last 30 days · From Google"}
    assert v[5]["source_line"] == "Last 30 days · From Experience.com" and v[5]["trust_tier"] == "platform_observed"


def test_a_metric_with_no_row_is_absent_not_zero_and_a_real_zero_stays(db):
    db.vis = [x for x in db.vis if x["metric"] != "calls"]
    v = _read()["visibility"]
    assert "calls" not in [x["metric"] for x in v] and len(v) == 5
    db.vis.append(vis("calls", 0, days=7))
    calls = next(x for x in _read()["visibility"] if x["metric"] == "calls")
    assert calls["value"] == 0 and calls["source_line"] == "Last 7 days · From Google"


# --- the map ---------------------------------------------------------------------------------------


def test_the_map_has_the_address_the_scan_date_the_counts_and_49_cells_in_order(db):
    m = _read()["map"]
    assert m["address"] == "100 Main St, Davenport, IA 52801" and m["scanned_at"] == "2026-10-16T09:00:00Z"
    assert m["spots"] == 49 and m["top3"] == 3
    assert [(c["row"], c["col"]) for c in m["cells"]] == [(r, c) for r in range(7) for c in range(7)]
    assert [c["rank"] for c in m["cells"][:11]] == [2, 1, 3, 7, 7, 7, 7, 7, 7, None, None]


def test_every_cell_carries_its_three_leaders_in_place_order(db):
    first = _read()["map"]["cells"][0]
    assert first["rank"] == 2
    assert first["leaders"] == [{"position": 1, "name": "Prairie Home Lending", "is_you": False}, {"position": 2, "name": None, "is_you": True},
                                {"position": 3, "name": "Bluff City Mortgage", "is_you": False}]
    assert all(len(c["leaders"]) == 3 for c in _read()["map"]["cells"])


def test_leaders_come_back_in_place_order_even_when_the_database_returns_them_shuffled(db):
    db.leaders.reverse()
    assert [[l["position"] for l in c["leaders"]] for c in _read()["map"]["cells"]][:2] == [[1, 2, 3], [1, 2, 3]]


def test_a_cell_with_no_leader_rows_has_an_empty_list(db):
    db.leaders = [l for l in db.leaders if l["cell_id"] != 1000]
    assert _read()["map"]["cells"][0]["leaders"] == []


def test_top3_counts_only_ranks_one_to_three(db):
    db.set_ranks([1, 2, 3, 4, 3, 2, 1] + [None] * 42)
    assert _read()["map"]["top3"] == 6


def test_a_seat_with_no_address_has_a_null_address_and_one_with_no_scan_date_a_null_date(db):
    db.address = None
    db.snap["map_scanned_at"] = None
    m = _read()["map"]
    assert m["address"] is None and m["scanned_at"] is None


def test_a_blank_or_padded_address_is_null_or_trimmed(db):
    db.address = "   "
    assert _read()["map"]["address"] is None
    db.address = "  100 Main St, Davenport, IA 52801 "
    assert _read()["map"]["address"] == "100 Main St, Davenport, IA 52801"


def test_a_seat_with_no_snapshot_has_no_map_and_no_seat_rating(db):
    db.snap = None
    body = _read()
    assert body["map"] is None
    you = next(c for c in body["competitors"] if c["is_you"])
    assert you["rating"] is None and you["reviews"] is None and you["avg_position"] is None


# --- the AI engines ----------------------------------------------------------------------------------


def test_the_ai_block_adds_up_the_engines_in_the_pages_order(db):
    db.engines.reverse()
    ai = _read()["ai"]
    assert [e["engine"] for e in ai["engines"]] == ["chatgpt", "gemini", "perplexity"]
    assert (ai["cited"], ai["checked"]) == (1, 7)
    assert ai["engines"][0] == {"engine": "chatgpt", "cited": 1, "checked": 3, "note": "Names you for refinance questions."}


def test_a_missing_engine_is_absent_and_no_engines_means_no_ai_block(db):
    db.engines = [e for e in db.engines if e["engine"] != "gemini"]
    ai = _read()["ai"]
    assert [e["engine"] for e in ai["engines"]] == ["chatgpt", "perplexity"] and ai["checked"] == 5
    db.engines = []
    assert _read()["ai"] is None


# --- the competitor table ------------------------------------------------------------------------------


def test_the_seats_average_counts_a_20_plus_cell_as_21_and_rounds_to_one_decimal(db):
    # ranks 1 x 6 and "20+" x 43 -> (6 + 43 * 21) / 49 = 18.551... -> 18.6
    db.set_ranks([1] * 6 + [None] * 43)
    you = next(c for c in _read()["competitors"] if c["is_you"])
    assert you["avg_position"] == 18.6
    db.set_ranks([5] * 49)
    assert next(c for c in _read()["competitors"] if c["is_you"])["avg_position"] == 5.0
    db.set_ranks([1, 2] + [3] * 47)  # (1 + 2 + 141) / 49 = 2.9387...
    assert next(c for c in _read()["competitors"] if c["is_you"])["avg_position"] == 2.9


def test_the_average_rounds_half_up(db):
    # 49 cells; sum 49 * 2.5 is not integral for 49 cells, so use a sum whose mean ends in exactly .x5: 98 + 0.05 * 49 is not an integer either;
    # the mean of 49 integers has at most 49 distinct fractions, so test the rounding helper on exact halves
    assert insights._one_decimal(2.25) == 2.3 and insights._one_decimal(2.35) == 2.4 and insights._one_decimal(2.24) == 2.2


def test_the_table_is_sorted_by_average_position_with_the_seat_among_the_rivals(db):
    db.set_ranks([4] * 49)  # the seat averages 4.0 and ties Bluff City (4.0): rivals first
    rows = _read()["competitors"]
    assert [c["name"] for c in rows] == ["Riverbend Bank & Trust", "Prairie Home Lending", "Bluff City Mortgage", "Pat Example", "Mississippi Valley Loans", "Heartland Credit Union"]
    assert [c["place"] for c in rows] == [1, 2, 3, 4, 5, 6]
    assert next(c for c in rows if c["is_you"])["avg_position"] == 4.0


def test_a_seat_that_averages_best_is_first_and_one_that_averages_worst_is_last(db):
    db.set_ranks([1] * 49)
    assert _read()["competitors"][0]["is_you"] is True
    db.set_ranks([None] * 49)  # 21.0
    assert _read()["competitors"][-1]["is_you"] is True


def test_an_unknown_average_sorts_last_and_is_null_never_zero(db):
    db.positions = [p for p in db.positions if p["competitor_id"] != 102]
    rows = _read()["competitors"]
    assert rows[-1]["name"] == "Prairie Home Lending" and rows[-1]["avg_position"] is None
    assert [c["place"] for c in rows] == [1, 2, 3, 4, 5, 6]


def test_unknown_averages_keep_the_rivals_in_home_position_order_and_put_the_seat_before_them(db):
    db.positions = []
    db.snap = None  # the seat has no average either: it is the one with the highest place
    rows = _read()["competitors"]
    assert [c["name"] for c in rows][:5] == [r["name"] for r in db.rivals]
    assert rows[-1]["is_you"] is True


def test_rivals_show_their_stored_rating_reviews_and_flags_and_the_seat_the_newest_snapshots(db):
    rows = _comps(_read())
    r = rows["Riverbend Bank & Trust"]
    assert (r["rating"], r["reviews"], r["is_leader"], r["is_you"], r["avg_position"]) == (4.7, 412, True, False, 2.1)
    you = rows["Pat Example"]
    assert (you["rating"], you["reviews"], you["is_leader"], you["is_you"]) == (4.9, 128, False, True)
    assert sum(1 for c in rows.values() if c["is_leader"]) == 1


def test_a_seat_without_a_name_is_called_you(db):
    db.owner = {"id": SEAT, "first_name": None, "last_name": "  "}
    assert [c["name"] for c in _read()["competitors"] if c["is_you"]] == ["You"]


def test_the_target_is_the_market_leader_or_null(db):
    assert _read()["target"] == {"name": "Riverbend Bank & Trust"}
    for r in db.rivals:
        r["is_market_leader"] = False
    body = _read()
    assert body["target"] is None and not any(c["is_leader"] for c in body["competitors"])


# --- the locked cards ----------------------------------------------------------------------------------


def test_below_the_top_plan_the_two_cards_are_shown_and_name_the_leader(db):
    locked = _read()["locked"]
    assert [x["key"] for x in locked] == ["map_rank_tracking", "ai_citation_monitoring"]
    assert locked[0] == {"key": "map_rank_tracking", "title": "Map Rank tracking", "text": "Re-scan every week and see the day you pass Riverbend"}
    assert locked[1] == {"key": "ai_citation_monitoring", "title": "AI-citation monitoring", "text": "Track every answer that names you"}


def test_the_first_card_does_not_name_a_rival_when_there_is_no_leader(db):
    for r in db.rivals:
        r["is_market_leader"] = False
    assert _read()["locked"][0]["text"] == "Re-scan every week and see how your map rank moves"


def test_at_the_top_plan_there_are_no_locked_cards_and_with_no_plan_none_are_claimed(db):
    db.state = {"plan_position": 3, "top_position": 3}
    assert _read()["locked"] == []
    db.state = None
    assert _read()["locked"] == []


# --- NORA's notes --------------------------------------------------------------------------------------


def test_the_two_notes_use_the_stored_numbers(db):
    notes = _read()["notes"]
    assert notes[0] == {"title": "Riverbend wins on volume.", "body": "412 reviews and 14 articles. Your 4.9 rating is better than their 4.7.",
                        "cta": "Start publishing", "action": "voce"}
    # the lowest share: Gemini and Perplexity are both 0 of 2; ties keep the page's order, so Gemini
    assert notes[1] == {"title": "Gemini never names you.", "body": "Does not mention you yet.", "cta": "Write an article", "action": "voce"}
    assert len(notes) == 2


@pytest.mark.parametrize("seat_rating, words", [(4.9, "better than"), (4.7, "the same as"), (4.5, "below")])
def test_the_rating_comparison_follows_the_two_ratings(db, seat_rating, words):
    db.snap["review_avg"] = seat_rating
    assert f"Your {seat_rating:.1f} rating is {words} their 4.7." in _read()["notes"][0]["body"]


def test_a_part_whose_figure_is_unknown_is_left_out(db):
    db.snap["review_avg"] = None
    assert _read()["notes"][0]["body"] == "412 reviews and 14 articles."
    db.snap["review_avg"] = 4.9
    db.rivals[0]["review_avg"] = None
    assert _read()["notes"][0]["body"] == "412 reviews and 14 articles."
    db.rivals[0]["review_count"] = None
    assert _read()["notes"][0]["body"] == "14 articles."
    db.rivals[0]["article_count"] = None
    assert _read()["notes"][0]["body"] == ""


def test_with_no_market_leader_there_is_no_first_note(db):
    for r in db.rivals:
        r["is_market_leader"] = False
    notes = _read()["notes"]
    assert len(notes) == 1 and notes[0]["title"].startswith(("Gemini", "Perplexity", "ChatGPT"))


def test_the_engine_note_picks_the_lowest_share_and_names_its_counts(db):
    db.engines = [eng("chatgpt", 2, 3, "Names you for refinance questions."), eng("gemini", 1, 2), eng("perplexity", 1, 4, "Names you for local lender questions.")]
    n = _read()["notes"][1]
    assert n["title"] == "Perplexity names you in 1 of 4." and n["body"] == "Names you for local lender questions."


def test_an_engine_that_checked_nothing_is_never_the_lowest_and_no_checks_means_no_second_note(db):
    db.engines = [eng("chatgpt", 0, 0), eng("gemini", 1, 2), eng("perplexity", 2, 2)]
    assert _read()["notes"][1]["title"] == "Gemini names you in 1 of 2."
    db.engines = [eng("chatgpt", 0, 0)]
    assert len(_read()["notes"]) == 1
    db.engines = []
    assert len(_read()["notes"]) == 1


def test_an_engine_with_no_stored_note_gives_an_empty_body(db):
    db.engines = [eng("chatgpt", 0, 3, None)]
    assert _read()["notes"][1] == {"title": "ChatGPT never names you.", "body": "", "cta": "Write an article", "action": "voce"}


def test_the_volume_claim_is_made_only_when_the_leader_has_more_reviews_than_the_seat(db):
    """The page must not say a rival "wins on volume" beside a review count that is higher or equal on the seat's own side (second review, finding 1)."""
    body_of = lambda: _read()["notes"][0]
    for seat_reviews in (413, 412, 500):  # leader has 412
        db.snap["review_count"] = seat_reviews
        assert body_of()["title"] == "Riverbend is your top rival.", seat_reviews
        assert body_of()["body"].startswith("412 reviews and 14 articles."), "the figures are still shown"
    db.snap["review_count"] = 411
    assert body_of()["title"] == "Riverbend wins on volume."


def test_the_volume_claim_needs_both_review_counts(db):
    db.snap["review_count"] = None  # the seat's count is unknown: nothing to compare
    assert _read()["notes"][0]["title"] == "Riverbend is your top rival."
    db.snap["review_count"] = 128
    db.rivals[0]["review_count"] = None  # the leader's is unknown
    assert _read()["notes"][0]["title"] == "Riverbend is your top rival."
    db.snap = None  # no snapshot at all
    assert _read()["notes"][0]["title"] == "Riverbend is your top rival."


@pytest.mark.parametrize("reviews, articles, want", [
    (1, 1, "1 review and 1 article."), (1, 2, "1 review and 2 articles."), (2, 1, "2 reviews and 1 article."), (0, 0, "0 reviews and 0 articles."),
    (1, None, "1 review."), (None, 1, "1 article."), (5, None, "5 reviews."), (None, 5, "5 articles."),
])
def test_the_counts_in_the_first_note_agree_in_number(db, reviews, articles, want):
    """"1 articles" was seen on a live seat; a single review or article is singular."""
    db.snap["review_avg"] = None  # leave the rating sentence out
    db.rivals[0]["review_count"], db.rivals[0]["article_count"] = reviews, articles
    assert _read()["notes"][0]["body"] == want


def test_a_leader_with_a_single_word_name_is_named_whole(db):
    db.rivals[0]["name"] = "Prairie"
    assert _read()["notes"][0]["title"] == "Prairie wins on volume."
