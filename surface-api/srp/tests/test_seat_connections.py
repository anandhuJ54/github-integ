"""The Connections read service (srp/connections-page-schema, task 5): ownership, `ready`, the eleven accounts with their computed status and powers lines, the summary,
the unconnected suggestions, NORA's notes and the directories card.

The SQL itself runs on real Postgres in test_seat_connections_integration.py; here the database is a recording fake.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException

from _base.config import get_settings
from surfaces.srp.seat import connections
from surfaces.srp.seat.schemas import ConnectionsResponse

SEAT = 42
USER = 7
CLAIMS = {"sub": str(USER)}
KEYS = {"as_of", "data", "ready", "accounts", "summary", "suggest", "notes", "locked"}
ORDER = ["google_business", "search_console", "youtube", "facebook", "instagram", "linkedin", "x", "zillow", "yelp", "website_cms", "loan_system"]
NAMES = ["Google Business Profile", "Search Console", "YouTube", "Facebook", "Instagram", "LinkedIn", "X", "Zillow", "Yelp", "Website / CMS", "Loan system (Encompass)"]
SYNCED = datetime(2026, 10, 20, 9, 0)


def acct(provider, state, synced=SYNCED, mock=True):
    return {"provider": provider, "state": state, "synced_at": None if state == "available" else synced, "is_mock": mock}


def accounts_default():
    return [acct("google_business", "connected"), acct("search_console", "available"), acct("youtube", "connected"), acct("facebook", "connected"),
            acct("instagram", "available"), acct("linkedin", "connected"), acct("x", "available"), acct("zillow", "matched"), acct("yelp", "partial"),
            acct("website_cms", "available"), acct("loan_system", "available")]


class ConnDB:
    """Answers each query the service runs from plain fields the tests change."""

    def __init__(self):
        self.owner = {"id": SEAT}
        self.accounts = accounts_default()
        self.snap = {"id": 900}
        self.lane = {"points": 67, "max_points": 68}
        self.plan = {"plan_key": "core"}

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if low.startswith("set transaction"):
            return []
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            return [self.owner] if self.owner and int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.connected_accounts" in low:
            return list(self.accounts)
        if "from srp_cleanup.home_snapshots" in low:
            return [self.snap] if self.snap else []
        if "from srp_cleanup.home_snapshot_lanes" in low:
            return [self.lane] if self.lane and self.snap else []
        if "from srp_cleanup.home_seat_state" in low:
            return [self.plan] if self.plan else []
        raise AssertionError(f"unexpected SQL: {sql}")

    def set(self, provider, **over):
        for r in self.accounts:
            if r["provider"] == provider:
                r.update(over)


@pytest.fixture
def db(monkeypatch, fake_db_for):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    s = ConnDB()
    rec = fake_db_for([])(s.responder)
    opened = []

    def conn():
        opened.append(1)
        return rec.role_connection("service")

    monkeypatch.setattr(connections, "connection", conn)
    s.rec, s.opened = rec, opened
    yield s
    get_settings.cache_clear()


def _read():
    return connections.connections(CLAIMS, str(SEAT))


def _queries(db):
    return [q for q in db.rec.sql() if not q.lower().lstrip().startswith("set transaction")]


def _by_key(body):
    return {a["key"]: a for a in body["accounts"]}


# --- shape and ownership ---------------------------------------------------------------------------

def test_the_response_has_exactly_the_documented_keys_and_validates_against_the_model(db):
    body = _read()
    assert set(body) == KEYS
    assert ConnectionsResponse.model_validate(body).model_dump() == body


def test_as_of_is_a_utc_time_stamp_and_data_says_mock(db):
    body = _read()
    assert body["as_of"].endswith("Z") and body["data"] == "mock" and body["ready"] is True


def test_the_data_label_is_live_only_when_no_row_is_mock(db):
    for r in db.accounts:
        r["is_mock"] = False
    assert _read()["data"] == "live"
    db.accounts[3]["is_mock"] = True
    assert _read()["data"] == "mock"


@pytest.mark.parametrize("pro_id", ["43", "abc", "4 2", "-1", "42.0", "1" * 40])
def test_another_or_malformed_seat_is_403(db, pro_id):
    with pytest.raises(HTTPException) as e:
        connections.connections(CLAIMS, pro_id)
    assert e.value.status_code == 403 and e.value.detail == "not_your_seat"


def test_a_non_numeric_user_is_403_without_a_query(db):
    with pytest.raises(HTTPException) as e:
        connections.connections({"sub": "abc"}, str(SEAT))
    assert e.value.status_code == 403 and db.rec.log == []


def test_a_seat_that_is_not_the_users_runs_only_the_ownership_query(db):
    with pytest.raises(HTTPException):
        connections.connections({"sub": "8"}, str(SEAT))
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
    for table in ("tier_agents", "users", "home_snapshots", "home_snapshot_lanes", "home_score_lanes", "home_seat_state", "home_plans", "connected_accounts"):
        assert f"srp_cleanup.{table}" in text, table
    for other in ("social_media_connections", "account_users", "google_analytics", "web_checks", "srs_lane_gaps", "profile_facts", "public."):
        assert other not in text, other
    lane = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.home_snapshot_lanes" in q.lower())
    assert "l.key = 'gbp'" in lane and "sl.snapshot_id = %s" in lane
    snap = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.home_snapshots" in q.lower())
    assert "order by as_of desc, id desc limit 1" in snap


# --- ready -----------------------------------------------------------------------------------------

def test_a_seat_with_no_account_rows_is_not_ready_and_every_section_is_null(db):
    db.accounts = []
    body = _read()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(KEYS - {"as_of", "ready", "data"})
    assert ConnectionsResponse.model_validate(body)


def test_a_seat_that_is_not_ready_still_needed_its_ownership_check_first(db):
    db.accounts = []
    with pytest.raises(HTTPException):
        connections.connections({"sub": "8"}, str(SEAT))


# --- the accounts ----------------------------------------------------------------------------------

def test_the_accounts_come_in_the_pages_order_with_the_pages_names_whatever_order_the_rows_have(db):
    db.accounts.reverse()
    body = _read()
    assert [a["key"] for a in body["accounts"]] == ORDER and [a["name"] for a in body["accounts"]] == NAMES


def test_a_missing_account_is_absent_never_invented(db):
    db.accounts = [r for r in db.accounts if r["provider"] != "x"]
    body = _read()
    assert "x" not in _by_key(body) and len(body["accounts"]) == 10


def test_an_unknown_provider_row_is_ignored(db):
    db.accounts.append(acct("myspace", "connected"))
    assert [a["key"] for a in _read()["accounts"]] == ORDER


def test_statuses_follow_the_state_and_the_account(db):
    a = _by_key(_read())
    assert a["google_business"]["status"] == "Connected · synced Oct 20"
    assert a["youtube"]["status"] == "Connected through Google"
    assert a["facebook"]["status"] == "Connected" and a["linkedin"]["status"] == "Connected"
    assert a["search_console"]["status"] == "Part of the Google sign-in, not yet granted"
    assert a["instagram"]["status"] == "" and a["x"]["status"] == "" and a["website_cms"]["status"] == "" and a["loan_system"]["status"] == ""
    assert a["zillow"]["status"] == "Matched, no sign-in needed"
    assert a["yelp"]["status"] == "Match found · replies need Yelp's partner access"


def test_a_connected_search_console_and_a_matched_yelp_read_plainly(db):
    db.set("search_console", state="connected", synced_at=SYNCED)
    db.set("yelp", state="matched")
    a = _by_key(_read())
    assert a["search_console"]["status"] == "Connected" and a["yelp"]["status"] == "Matched, no sign-in needed"


def test_google_business_profile_without_a_sync_time_says_only_connected(db):
    db.set("google_business", synced_at=None)
    a = _by_key(_read())["google_business"]
    assert a["status"] == "Connected" and a["synced_at"] is None


def test_the_sync_day_has_no_leading_zero(db):
    db.set("google_business", synced_at=datetime(2026, 11, 3, 9, 0))
    assert _by_key(_read())["google_business"]["status"] == "Connected · synced Nov 3"


def test_synced_at_is_an_iso_time_for_a_connected_account_and_null_otherwise(db):
    a = _by_key(_read())
    assert a["google_business"]["synced_at"].startswith("2026-10-20T09:00:00") and a["x"]["synced_at"] is None


def test_powers_are_the_pages_text_and_the_gbp_line_carries_the_lane(db):
    a = _by_key(_read())
    assert a["google_business"]["powers"] == "GBP lane (67 of 68), hours, photos, reviews"
    assert [a[k]["powers"] for k in ORDER[1:]] == [
        "Indexing and search queries for Website Analytics", "Videos lane", "Connections lane, posting", "Connections lane, posting",
        "Connections lane, photo, credentials hints", "Connections lane", "Reviews shown on the profile", "Listing check", "Lets NORA apply website fixes",
        "Review requests after each closing"]


@pytest.mark.parametrize("lane, snap", [(None, {"id": 900}), ({"points": 67, "max_points": 68}, None), ({"points": None, "max_points": 68}, {"id": 900}),
                                        ({"points": 67, "max_points": None}, {"id": 900})])
def test_an_unknown_gbp_lane_leaves_the_numbers_out_never_zero(db, lane, snap):
    db.lane, db.snap = lane, snap
    assert _by_key(_read())["google_business"]["powers"] == "GBP lane, hours, photos, reviews"


def test_a_lane_with_zero_points_says_zero(db):
    db.lane = {"points": 0, "max_points": 68}
    assert _by_key(_read())["google_business"]["powers"] == "GBP lane (0 of 68), hours, photos, reviews"


# --- summary, suggestions, notes ---------------------------------------------------------------------

def test_the_summary_counts_connected_and_matched_plus_partial(db):
    assert _read()["summary"] == {"connected": 4, "matched": 2}
    db.set("yelp", state="available", synced_at=None)
    db.set("zillow", state="available", synced_at=None)
    assert _read()["summary"] == {"connected": 4, "matched": 0}


def test_suggest_lists_the_unconnected_search_console_and_website_cms_in_that_order(db):
    assert _read()["suggest"] == [{"key": "search_console", "name": "Search Console"}, {"key": "website_cms", "name": "Website / CMS"}]
    db.set("search_console", state="connected", synced_at=SYNCED)
    assert _read()["suggest"] == [{"key": "website_cms", "name": "Website / CMS"}]
    db.set("website_cms", state="connected", synced_at=SYNCED)
    assert _read()["suggest"] == []


def test_suggest_drops_an_account_that_has_no_row(db):
    db.accounts = [r for r in db.accounts if r["provider"] != "search_console"]
    assert _read()["suggest"] == [{"key": "website_cms", "name": "Website / CMS"}]


def test_the_notes_follow_the_suggestions(db):
    assert _read()["notes"] == [
        {"title": "Search Console is one tap away.", "body": "It's part of your Google sign-in. It shows me which searches find your page.", "cta": "Connect it",
         "connect": "search_console"},
        {"title": "Your Website / CMS would let me apply fixes.", "body": "Right now I can only hand them to your webmaster.", "cta": "Connect it",
         "connect": "website_cms"}]
    db.set("search_console", state="connected", synced_at=SYNCED)
    assert [n["connect"] for n in _read()["notes"]] == ["website_cms"]
    db.set("website_cms", state="connected", synced_at=SYNCED)
    assert _read()["notes"] == []


# --- the directories card ----------------------------------------------------------------------------

@pytest.mark.parametrize("plan, shown", [("core", True), ("engage", False), ("amplify", False), ("other", False)])
def test_the_directories_card_is_for_the_core_plan_only(db, plan, shown):
    db.plan = {"plan_key": plan}
    expected = {"title": "Publish your details to Apple Maps, Bing and 28 directories.", "text": "Unlock with Engage, included in Amplify."}
    assert _read()["locked"] == (expected if shown else None)


def test_an_unknown_plan_shows_no_card(db):
    db.plan = None
    assert _read()["locked"] is None


def test_a_seat_whose_only_rows_are_unknown_providers_is_not_ready(db):
    db.accounts = [acct("myspace", "connected")]
    assert _read()["ready"] is False


@pytest.mark.parametrize("month, name", list(enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)))
def test_every_month_has_its_english_abbreviation_whatever_the_servers_locale(db, month, name):
    db.set("google_business", synced_at=datetime(2026, month, 9, 9, 0))
    assert _by_key(_read())["google_business"]["status"] == f"Connected · synced {name} 9"
