"""The Web analytics read service (srp/web-analytics-page-schema, task 5): ownership, `ready`, the site, the health gauge, the ten checks with their points text,
the filter counts, the three tiles, the top fix with its JSON-LD snippet, NORA's two notes and the facts.

The SQL itself runs on real Postgres in test_seat_web_analytics_integration.py; here the database is a recording fake.
"""
from __future__ import annotations

import json
from datetime import datetime

import pytest
from fastapi import HTTPException

from _base.config import get_settings
from surfaces.srp.seat import web_analytics
from surfaces.srp.seat.schemas import WebAnalyticsResponse

SEAT = 42
USER = 7
CLAIMS = {"sub": str(USER)}
KEYS = {"as_of", "data", "ready", "site", "health", "checks", "counts", "tiles", "top_fix", "notes", "facts"}
ORDER = ["entity_markup", "nap", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion", "reviews_on_site", "security"]
GROUPS = ["Entity and markup", "Name, address, phone", "Indexing", "Service pages", "Speed", "AI readiness", "Content", "Conversion", "Reviews on site", "Security"]
SCAN = ("From your site scan", "platform_observed")


def row(key, state, result, points=None, maximum=None, headline=None, source=SCAN[0], tier=SCAN[1], mock=True):
    return {"check_key": key, "state": state, "result": result, "headline": headline, "points": points, "points_max": maximum, "source": source, "trust_tier": tier, "is_mock": mock}


def checks_default():
    return [
        row("entity_markup", "fail", "No structured data on the page", 0, 42), row("nap", "pass", "Matches the profile", 30, 30),
        row("indexing", "warn", "Indexed; no sitemap", 10, 20, source="From Google Search Console", tier="imported"),
        row("service_pages", "fail", "No pages for FHA or VA loans", 0, 10),
        row("speed", "warn", "LCP 3.1 s (needs work), INP 180 ms, CLS 0.02", headline="LCP 3.1 s", source="From PageSpeed", tier="imported"),
        row("ai_readiness", "warn", "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content in the page HTML; clear title and description tags", headline="2 of 5"),
        row("content", "fail", "No blog"), row("conversion", "warn", "Click-to-call yes; no booking link"), row("reviews_on_site", "fail", "Widget not installed"),
        row("security", "pass", "HTTPS"),
    ]


class WebDB:
    """Answers each query the service runs from plain fields the tests change."""

    def __init__(self):
        self.owner = {"id": SEAT, "first_name": "Pat", "last_name": "Example"}
        self.checks = checks_default()
        self.snap = {"id": 900}
        self.lane = {"points": 40, "max_points": 102}
        self.site = {"website_url": "https://example.test/seat-42/", "last_refreshed_time": datetime(2026, 10, 16, 9, 0)}
        self.facts = [{"field": "address", "value": "100 Main St, Davenport, IA 52801"}, {"field": "company", "value": "Example Lending Co"}]
        self.phone = "+15635550100"

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if low.startswith("set transaction"):
            return []
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            return [self.owner] if self.owner and int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.web_checks" in low:
            return list(self.checks)
        if "from srp_cleanup.home_snapshots" in low:
            return [self.snap] if self.snap else []
        if "from srp_cleanup.home_snapshot_lanes" in low:
            return [self.lane] if self.lane and self.snap else []
        if "from srp_cleanup.website_analytics_data" in low:
            return [self.site] if self.site else []
        if "from srp_cleanup.profile_facts" in low:
            return list(self.facts)
        if "from srp_cleanup.tier_agents where" in low:
            return [{"phone_number": self.phone}]
        raise AssertionError(f"unexpected SQL: {sql}")

    def set(self, key, **over):
        for r in self.checks:
            if r["check_key"] == key:
                r.update(over)


@pytest.fixture
def db(monkeypatch, fake_db_for):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    s = WebDB()
    rec = fake_db_for([])(s.responder)
    opened = []

    def conn():
        opened.append(1)
        return rec.role_connection("service")

    monkeypatch.setattr(web_analytics, "connection", conn)
    s.rec, s.opened = rec, opened
    yield s
    get_settings.cache_clear()


def _read():
    return web_analytics.web_analytics(CLAIMS, str(SEAT))


def _queries(db):
    return [q for q in db.rec.sql() if not q.lower().lstrip().startswith("set transaction")]


def _by_key(body):
    return {c["key"]: c for c in body["checks"]}


# --- shape and ownership ---------------------------------------------------------------------------


def test_the_response_has_exactly_the_documented_keys_and_validates_against_the_model(db):
    body = _read()
    assert set(body) == KEYS
    assert WebAnalyticsResponse.model_validate(body).model_dump(by_alias=True) == body


def test_as_of_is_a_utc_time_stamp_and_data_says_mock(db):
    body = _read()
    assert body["as_of"].endswith("Z") and body["data"] == "mock" and body["ready"] is True


def test_the_data_label_is_live_only_when_no_row_is_mock(db):
    for r in db.checks:
        r["is_mock"] = False
    assert _read()["data"] == "live"
    db.checks[3]["is_mock"] = True
    assert _read()["data"] == "mock"


@pytest.mark.parametrize("pro_id", ["43", "abc", "4 2", "-1", "42.0", "1" * 40])
def test_another_or_malformed_seat_is_403(db, pro_id):
    with pytest.raises(HTTPException) as e:
        web_analytics.web_analytics(CLAIMS, pro_id)
    assert e.value.status_code == 403 and e.value.detail == "not_your_seat"


def test_a_non_numeric_user_is_403_without_a_query(db):
    with pytest.raises(HTTPException) as e:
        web_analytics.web_analytics({"sub": "abc"}, str(SEAT))
    assert e.value.status_code == 403 and db.rec.log == []


def test_a_seat_that_is_not_the_users_runs_only_the_ownership_query(db):
    with pytest.raises(HTTPException):
        web_analytics.web_analytics({"sub": "8"}, str(SEAT))
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


def test_it_reads_only_the_tables_it_needs(db):
    _read()
    text = " ".join(" ".join(q.lower().split()) for q in _queries(db))
    for table in ("tier_agents", "users", "home_snapshots", "home_snapshot_lanes", "home_score_lanes", "website_analytics_data", "profile_facts", "web_checks"):
        assert f"srp_cleanup.{table}" in text, table
    for other in ("agents_website_data", "website_analytics_categories", "audits", "google_analytics", "ai_authority_stats", "srs_config_", "user_search_rank_scores", "public."):
        assert other not in text, other
    lane = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.home_snapshot_lanes" in q.lower())
    assert "l.key = 'website'" in lane and "sl.snapshot_id = %s" in lane
    snap = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.home_snapshots" in q.lower())
    assert "order by as_of desc, id desc limit 1" in snap
    site = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.website_analytics_data" in q.lower())
    assert "order by last_refreshed_time desc nulls last, id desc limit 1" in site


# --- ready ---------------------------------------------------------------------------------------


def test_a_seat_with_no_check_rows_is_not_ready_and_every_section_is_null(db):
    db.checks = []
    body = _read()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(KEYS - {"as_of", "ready", "data"})


def test_a_seat_that_is_not_ready_still_needed_its_ownership_check_first(db):
    db.checks = []
    with pytest.raises(HTTPException):
        web_analytics.web_analytics({"sub": "8"}, str(SEAT))


# --- the site --------------------------------------------------------------------------------------


@pytest.mark.parametrize("url, shown", [("https://example.test/seat-42/", "example.test/seat-42"), ("http://example.test", "example.test"), ("example.test/a", "example.test/a"),
                                        ("  https://example.test/x//  ", "example.test/x"), ("HTTPS://Example.test/", "Example.test")])
def test_the_address_under_the_title_has_no_scheme_and_no_trailing_slash(db, url, shown):
    db.site["website_url"] = url
    assert _read()["site"]["url"] == shown


def test_the_site_is_null_where_unknown_never_empty_text(db):
    db.site["website_url"] = "   "
    db.site["last_refreshed_time"] = None
    assert _read()["site"] == {"url": None, "last_checked": None}
    db.site = None
    assert _read()["site"] == {"url": None, "last_checked": None}


def test_last_checked_is_a_utc_time_stamp(db):
    assert _read()["site"]["last_checked"] == "2026-10-16T09:00:00Z"


# --- the health gauge ------------------------------------------------------------------------------


def test_the_gauge_is_the_website_lane_of_the_newest_snapshot(db):
    assert _read()["health"] == {"earned": 40, "max": 102, "open": 62}


def test_a_full_lane_and_an_empty_lane_are_real_figures(db):
    db.lane = {"points": 102, "max_points": 102}
    assert _read()["health"] == {"earned": 102, "max": 102, "open": 0}
    db.lane = {"points": 0, "max_points": 102}
    assert _read()["health"] == {"earned": 0, "max": 102, "open": 102}


def test_the_gauge_is_null_not_zero_with_no_snapshot_or_no_lane_row_or_unknown_points(db):
    db.snap = None
    assert _read()["health"] is None
    db.snap = {"id": 900}
    db.lane = None
    assert _read()["health"] is None
    db.lane = {"points": None, "max_points": 102}
    assert _read()["health"] is None
    db.lane = {"points": 40, "max_points": None}
    assert _read()["health"] is None


# --- the checks ------------------------------------------------------------------------------------


def test_the_ten_checks_keep_the_pages_order_and_labels_whatever_order_the_rows_come_in(db):
    db.checks.reverse()
    checks = _read()["checks"]
    assert [c["key"] for c in checks] == ORDER and [c["group"] for c in checks] == GROUPS


def test_each_check_carries_its_stored_values(db):
    c = _by_key(_read())
    assert c["indexing"] == {"key": "indexing", "group": "Indexing", "state": "warn", "result": "Indexed; no sitemap", "points": 10, "max": 20, "points_text": "10 of 20",
                             "source": "From Google Search Console", "trust_tier": "imported"}
    assert c["security"]["points"] is None and c["security"]["max"] is None


def test_a_missing_check_row_is_absent_not_invented(db):
    db.checks = [r for r in db.checks if r["check_key"] != "content"]
    assert "content" not in [c["key"] for c in _read()["checks"]] and len(_read()["checks"]) == 9


@pytest.mark.parametrize("key, points, maximum, state, text", [
    ("entity_markup", 0, 42, "fail", "+42 open"), ("entity_markup", 12, 42, "warn", "+30 open"), ("entity_markup", 42, 42, "pass", "42 of 42"),
    ("nap", 30, 30, "pass", "30 of 30"), ("nap", 20, 30, "warn", "20 of 30"), ("indexing", 10, 20, "warn", "10 of 20"), ("service_pages", 0, 10, "fail", "0 of 10"),
])
def test_the_points_text_of_a_scored_check(db, key, points, maximum, state, text):
    db.set(key, points=points, points_max=maximum, state=state)
    assert _by_key(_read())[key]["points_text"] == text


@pytest.mark.parametrize("state, text", [("pass", "Pass"), ("warn", "—"), ("fail", "—")])
def test_the_points_text_of_an_unscored_check(db, state, text):
    db.set("security", state=state)
    assert _by_key(_read())["security"]["points_text"] == text


def test_counts_add_up_the_states(db):
    assert _read()["counts"] == {"all": 10, "fail": 4, "warn": 4, "pass": 2}
    db.checks = db.checks[:3]
    assert _read()["counts"] == {"all": 3, "fail": 1, "warn": 1, "pass": 1}


def test_counts_tell_the_three_states_apart_and_ignore_a_row_that_is_not_one_of_the_ten(db):
    db.set("security", state="fail")
    db.set("reviews_on_site", state="fail")
    db.checks.append(row("something_else", "fail", "x"))
    assert _read()["counts"] == {"all": 10, "fail": 5, "warn": 4, "pass": 1}


# --- the tiles -------------------------------------------------------------------------------------


def test_the_three_tiles_in_order(db):
    assert _read()["tiles"] == [
        {"key": "speed", "label": "Speed", "value": "LCP 3.1 s", "note": "Needs work", "state": "warn", "check": "speed"},
        {"key": "markup", "label": "Markup", "value": "Missing", "note": "+42 open", "state": "fail", "check": "entity_markup"},
        {"key": "ai_readiness", "label": "AI readiness", "value": "2 of 5", "note": "Needs work", "state": "warn", "check": "ai_readiness"},
    ]


@pytest.mark.parametrize("points, state, value, note", [(0, "fail", "Missing", "+42 open"), (20, "warn", "Partial", "+22 open"), (42, "pass", "Complete", "Passing")])
def test_the_markup_tile_follows_the_markup_check(db, points, state, value, note):
    db.set("entity_markup", points=points, state=state)
    tile = _read()["tiles"][1]
    assert (tile["value"], tile["note"], tile["state"]) == (value, note, state)


@pytest.mark.parametrize("state, label", [("fail", "Failing"), ("warn", "Needs work"), ("pass", "Passing")])
def test_the_speed_and_ai_tiles_name_the_state(db, state, label):
    db.set("speed", state=state)
    db.set("ai_readiness", state=state)
    tiles = _read()["tiles"]
    assert tiles[0]["note"] == label and tiles[2]["note"] == label


def test_a_tile_whose_check_is_missing_is_not_drawn(db):
    db.checks = [r for r in db.checks if r["check_key"] != "speed"]
    assert [t["key"] for t in _read()["tiles"]] == ["markup", "ai_readiness"]


# --- the top fix and the snippet -------------------------------------------------------------------

SNIPPET = ('<script type="application/ld+json">\n{ "@type": "FinancialService",\n  "name": "Pat Example – Example Lending Co",\n  "telephone": "(563) 555-0100",\n'
           '  "address": "100 Main St, Davenport, IA 52801" }\n</script>')


def test_the_top_fix_is_the_markup_opportunity_with_the_snippet_from_the_profile(db):
    assert _read()["top_fix"] == {"open": 42, "snippet": SNIPPET}


def test_a_partial_markup_check_still_has_a_top_fix_with_what_is_open(db):
    db.set("entity_markup", points=12, state="warn")
    assert _read()["top_fix"]["open"] == 30


def test_no_top_fix_when_markup_passes_or_its_check_is_missing(db):
    db.set("entity_markup", points=42, state="pass")
    assert _read()["top_fix"] is None
    db.checks = [r for r in db.checks if r["check_key"] != "entity_markup"]
    assert _read()["top_fix"] is None


def test_the_snippet_leaves_out_what_the_profile_lacks(db):
    db.facts = [{"field": "address", "value": "100 Main St, Davenport, IA 52801"}]
    db.phone = None
    assert _read()["top_fix"]["snippet"] == ('<script type="application/ld+json">\n{ "@type": "FinancialService",\n  "name": "Pat Example",\n'
                                             '  "address": "100 Main St, Davenport, IA 52801" }\n</script>')
    db.facts = []
    assert _read()["top_fix"]["snippet"] == '<script type="application/ld+json">\n{ "@type": "FinancialService",\n  "name": "Pat Example" }\n</script>'


def test_with_no_name_there_is_no_snippet_but_the_fix_is_still_offered(db):
    db.owner = {"id": SEAT, "first_name": None, "last_name": " "}
    assert _read()["top_fix"] == {"open": 42, "snippet": None}


def test_the_snippet_escapes_quotes_backslashes_and_a_closing_script_tag(db):
    db.owner = {"id": SEAT, "first_name": 'Pat "The Pro"', "last_name": "O\\Neil"}
    db.facts = [{"field": "company", "value": "A </script><b>"}, {"field": "address", "value": "1 \"Main\" St"}]
    snippet = _read()["top_fix"]["snippet"]
    assert '"name": "Pat \\"The Pro\\" O\\\\Neil – A <\\/script><b>"' in snippet
    assert '"address": "1 \\"Main\\" St"' in snippet
    assert snippet.count("</script>") == 1, "only the closing tag of the snippet itself"


def test_an_html_comment_opener_in_a_value_cannot_swallow_the_closing_tag(db):
    """`<!--` followed by `<script` puts a script into its double-escaped state, where the closing tag no longer closes it (second review, finding 9)."""
    db.facts = [{"field": "company", "value": "A <!--<script> B"}]
    snippet = _read()["top_fix"]["snippet"]
    assert "<!--" not in snippet
    assert r'"name": "Pat Example – A <\u0021--<script> B"' in snippet
    body = "\n".join(snippet.splitlines()[1:-1])
    assert json.loads(body)["name"] == "Pat Example – A <!--<script> B", "the escape is valid JSON and means the same text"


def test_the_phone_is_shown_in_the_snippet_as_the_profile_shows_it(db):
    for raw, shown in (("+13095557320", "(309) 555-7320"), ("5635550100", "(563) 555-0100"), ("1 (563) 555-0100", "(563) 555-0100"), ("ext. 5", "ext. 5")):
        db.phone = raw
        assert f'"telephone": "{shown}"' in _read()["top_fix"]["snippet"], raw


# --- NORA's notes ----------------------------------------------------------------------------------


def test_the_two_notes_use_the_stored_numbers(db):
    notes = _read()["notes"]
    assert notes[0] == {"title": "Markup is worth 42 points.", "body": "I've written the code — your webmaster only needs to paste it in.", "cta": "Send to my webmaster", "action": "send"}
    assert notes[1] == {"title": "AI can only partly read your page.", "body": "GPTBot blocked in robots.txt; no llms.txt; no FAQ; content in the page HTML; clear title and description tags.",
                        "cta": "See the checks", "action": "close"}
    assert len(notes) == 2


def test_the_markup_note_says_what_is_open(db):
    db.set("entity_markup", points=12, state="warn")
    assert _read()["notes"][0]["title"] == "Markup is worth 30 points."


def test_each_note_is_dropped_when_its_condition_is_not_met(db):
    db.set("entity_markup", points=42, state="pass")
    assert [n["cta"] for n in _read()["notes"]] == ["See the checks"]
    db.set("ai_readiness", state="pass")
    assert _read()["notes"] == []
    db.set("entity_markup", points=0, state="fail")
    assert [n["cta"] for n in _read()["notes"]] == ["Send to my webmaster"]


@pytest.mark.parametrize("state, title", [("fail", "AI can't read your page yet."), ("warn", "AI can only partly read your page.")])
def test_the_ai_note_says_what_the_state_says(db, state, title):
    """A check that still reads part of the page cannot say "can't read" (second review, finding 5)."""
    db.set("ai_readiness", state=state)
    note = _read()["notes"][1]
    assert note["title"] == title and note["cta"] == "See the checks" and note["action"] == "close"


# --- the facts -------------------------------------------------------------------------------------


def test_the_facts_are_the_profiles(db):
    assert _read()["facts"] == {"name": "Pat Example", "company": "Example Lending Co", "phone": "+15635550100", "address": "100 Main St, Davenport, IA 52801"}


def test_a_missing_fact_is_null_and_blank_text_counts_as_missing(db):
    db.facts = [{"field": "address", "value": "   "}, {"field": "company", "value": None}]
    db.phone = "  "
    db.owner = {"id": SEAT, "first_name": "  Pat ", "last_name": None}
    assert _read()["facts"] == {"name": "Pat", "company": None, "phone": None, "address": None}


def test_a_fact_that_is_not_text_is_ignored(db):
    db.facts = [{"field": "address", "value": ["a", "b"]}, {"field": "company", "value": 5}]
    f = _read()["facts"]
    assert f["address"] is None and f["company"] is None
