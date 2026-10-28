"""The Profile read service (srp/profile-page-schema, task 5): ownership, `ready`, the 18 facts (existing-table and own), source lines, preview,
credentials and the expertise-graph counts.

The SQL itself runs on real Postgres in test_seat_profile_integration.py; here the database is a recording fake.
"""
from __future__ import annotations

from datetime import datetime

import pytest
from fastapi import HTTPException

from _base.config import get_settings
from surfaces.srp.seat import profile
from surfaces.srp.seat.schemas import ProfileResponse

SEAT = 42
USER = 7
CLAIMS = {"sub": str(USER)}
FIELDS = ["name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email", "address", "hours", "nmls", "licensed_in", "products",
          "service_areas", "designations", "awards", "education", "company"]
KEYS = {"as_of", "data", "ready", "facts", "preview", "credentials", "graph"}
GROUPS = ["identity", "contact", "licence", "products", "reviews", "presence"]


def fact(field, value=None, source="Confirmed by you", tier="owner_verified", confirmed=datetime(2026, 10, 16, 9, 0), mock=True):
    return {"field": field, "value": value, "source": source, "trust_tier": tier, "confirmed_at": confirmed, "is_mock": mock}


class ProfDB:
    """Answers each query the service runs from plain fields the tests change."""

    def __init__(self):
        self.owner = {"id": SEAT}
        self.person = {"first_name": "Pat", "last_name": "Example", "email": "pat@example.test", "title": "Loan Officer", "profile_photo": "https://example.test/p.jpg",
                       "description": "Helps Davenport-area families buy and refinance homes, with a focus on first-time buyers.", "year_started": "2009",
                       "phone_number": "+15635550100", "mobile_number": "+15635550144"}
        self.facts = [
            fact("name"), fact("title", source="From LinkedIn", tier="imported", confirmed=None), fact("photo", source="From LinkedIn", tier="imported", confirmed=None),
            fact("bio", source="Approved by you"), fact("year_started"), fact("office_phone"), fact("mobile_phone"), fact("email"),
            fact("address", "100 Main St, Davenport, IA 52801"), fact("hours", "Mon–Fri 9:00–5:00", "From Google", "imported", None),
            fact("nmls", "482913"), fact("licensed_in", "Iowa and Illinois", "From NMLS", "authority_verified", None),
            fact("products", ["Conventional", "FHA", "VA"], "From Google", "imported", None), fact("service_areas", "Davenport, Bettendorf", "Added by you", "self_declared"),
            fact("designations", "CMA", "From LinkedIn", "imported", None), fact("awards", "Top Producer 2025", "From LinkedIn", "imported", None),
            fact("education", "B.A. Business, Example University", "Added by you", "self_declared"), fact("company", "Example Lending Co", "From LinkedIn", "imported", None),
        ]
        self.groups = [{"group_key": k, "facts": n} for k, n in zip(GROUPS, [12, 9, 6, 11, 15, 14], strict=True)]
        self.snap = {"review_avg": 4.9, "review_count": 128, "profile_strength_pct": 64, "rank_city": "Davenport"}

    def responder(self, sql, params):
        low = " ".join(sql.lower().split())
        if low.startswith("set transaction"):
            return []
        if "ta.description" in low:
            return [self.person] if self.person else []
        if "from srp_cleanup.tier_agents ta" in low:
            seat_id, user_id = params
            return [self.owner] if self.owner and int(seat_id) == SEAT and int(user_id) == USER else []
        if "from srp_cleanup.profile_facts" in low:
            return list(self.facts)
        if "from srp_cleanup.profile_graph_groups" in low:
            return list(self.groups)
        if "from srp_cleanup.home_snapshots" in low:
            return [self.snap] if self.snap else []
        raise AssertionError(f"unexpected SQL: {sql}")

    def drop(self, *fields):
        self.facts = [f for f in self.facts if f["field"] not in fields]

    def get(self, field):
        return next(f for f in self.facts if f["field"] == field)


@pytest.fixture
def db(monkeypatch, fake_db_for):
    monkeypatch.delenv("SRP_LOCAL_SCHEMA", raising=False)
    get_settings.cache_clear()
    s = ProfDB()
    rec = fake_db_for([])(s.responder)
    opened = []

    def conn():
        opened.append(1)
        return rec.role_connection("service")

    monkeypatch.setattr(profile, "connection", conn)
    s.rec, s.opened = rec, opened
    yield s
    get_settings.cache_clear()


def _profile():
    return profile.profile(CLAIMS, str(SEAT))


def _queries(db):
    return [q for q in db.rec.sql() if not q.lower().lstrip().startswith("set transaction")]


def _facts(body):
    return {f["field"]: f for f in body["facts"]}


# --- shape and ownership ---------------------------------------------------------------------------


def test_the_response_has_exactly_the_documented_keys_and_all_eighteen_facts_in_order(db):
    body = _profile()
    assert set(body) == KEYS and [f["field"] for f in body["facts"]] == FIELDS


def test_as_of_is_a_utc_time_stamp_and_data_says_mock(db):
    body = _profile()
    assert body["as_of"].endswith("Z") and body["data"] == "mock" and body["ready"] is True


def test_the_data_label_is_live_only_when_no_fact_is_mock(db):
    for f in db.facts:
        f["is_mock"] = False
    assert _profile()["data"] == "live"
    db.facts[0]["is_mock"] = True
    assert _profile()["data"] == "mock"


@pytest.mark.parametrize("pro_id", ["43", "abc", "4 2", "-1", "42.0", "1" * 40])
def test_another_or_malformed_seat_is_403(db, pro_id):
    with pytest.raises(HTTPException) as e:
        profile.profile(CLAIMS, pro_id)
    assert e.value.status_code == 403 and e.value.detail == "not_your_seat"


def test_a_non_numeric_user_is_403_without_a_query(db):
    with pytest.raises(HTTPException) as e:
        profile.profile({"sub": "abc"}, str(SEAT))
    assert e.value.status_code == 403 and db.rec.log == []


def test_a_seat_that_is_not_the_users_runs_only_the_ownership_query(db):
    with pytest.raises(HTTPException):
        profile.profile({"sub": "8"}, str(SEAT))
    assert len(_queries(db)) == 1 and "from srp_cleanup.tier_agents ta" in _queries(db)[0].lower()


# --- reads only ------------------------------------------------------------------------------------


def test_the_transaction_is_declared_read_only_before_anything_else(db):
    _profile()
    assert db.rec.sql()[0].lower().strip() == "set transaction read only"
    assert "from srp_cleanup.tier_agents ta" in db.rec.sql()[1].lower()


def test_only_select_statements_run_on_one_connection_with_no_lock(db):
    _profile()
    assert len(db.opened) == 1
    for q in _queries(db):
        low = " ".join(q.lower().split())
        assert low.startswith(("select", "with")) and "for update" not in low and "for share" not in low, q


def test_it_reads_only_the_profile_tables_the_seat_and_the_newest_snapshot(db):
    _profile()
    text = " ".join(" ".join(q.lower().split()) for q in _queries(db))
    for table in ("tier_agents", "users", "profile_facts", "profile_graph_groups", "home_snapshots"):
        assert f"srp_cleanup.{table}" in text, table
    for other in ("srs_config_", "user_search_rank_scores", "ai_authority_stats", "locations", "tier_locations", "agent_locations", "tiers ", "public."):
        assert other not in text, other
    snap = next(" ".join(q.lower().split()) for q in _queries(db) if "from srp_cleanup.home_snapshots" in q.lower())
    assert "order by as_of desc, id desc limit 1" in snap


# --- ready ---------------------------------------------------------------------------------------


def test_a_seat_with_no_fact_rows_is_not_ready_and_every_section_is_null(db):
    db.facts = []
    body = _profile()
    assert body["ready"] is False and body["data"] is None
    assert {k: v for k, v in body.items() if k not in ("as_of", "ready", "data")} == dict.fromkeys(KEYS - {"as_of", "ready", "data"})


def test_a_seat_that_is_not_ready_still_needed_its_ownership_check_first(db):
    db.facts = []
    with pytest.raises(HTTPException):
        profile.profile({"sub": "8"}, str(SEAT))


# --- the facts that are read from the existing tables ------------------------------------------------------


def test_existing_table_facts_come_from_their_columns(db):
    f = _facts(_profile())
    assert f["name"]["value"] == "Pat Example" and f["title"]["value"] == "Loan Officer" and f["photo"]["value"] == "https://example.test/p.jpg"
    assert f["bio"]["value"].startswith("Helps Davenport-area") and f["year_started"]["value"] == "2009"
    assert f["office_phone"]["value"] == "+15635550100" and f["mobile_phone"]["value"] == "+15635550144" and f["email"]["value"] == "pat@example.test"
    assert all(f[k]["present"] for k in ("name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email"))


@pytest.mark.parametrize("column,field", [("title", "title"), ("profile_photo", "photo"), ("description", "bio"), ("year_started", "year_started"),
                                          ("phone_number", "office_phone"), ("mobile_number", "mobile_phone"), ("email", "email")])
@pytest.mark.parametrize("blank", [None, "", "   "])
def test_a_blank_column_is_a_missing_fact_even_when_a_source_row_exists(db, column, field, blank):
    db.person[column] = blank
    got = _facts(_profile())[field]
    assert got == {"field": field, "present": False, "value": None, "source": None, "trust_tier": None, "confirmed_at": None, "source_line": None}


def test_the_name_is_the_first_and_last_name_and_missing_when_both_are_blank(db):
    db.person.update(last_name=None)
    assert _facts(_profile())["name"]["value"] == "Pat"
    db.person.update(first_name=" ", last_name="Example")
    assert _facts(_profile())["name"]["value"] == "Example"
    db.person.update(first_name=None, last_name="  ")
    assert _facts(_profile())["name"]["present"] is False


def test_a_present_column_without_a_source_row_shows_its_value_and_no_source(db):
    db.drop("title")
    got = _facts(_profile())["title"]
    assert got["present"] is True and got["value"] == "Loan Officer" and (got["source"], got["trust_tier"], got["source_line"]) == (None, None, None)


# --- the facts whose value lives in profile_facts ----------------------------------------------------------


def test_own_facts_come_from_their_rows(db):
    f = _facts(_profile())
    assert f["address"]["value"] == "100 Main St, Davenport, IA 52801" and f["nmls"]["value"] == "482913" and f["company"]["value"] == "Example Lending Co"
    assert f["products"]["value"] == ["Conventional", "FHA", "VA"] and isinstance(f["licensed_in"]["value"], str)


@pytest.mark.parametrize("field", ["address", "hours", "nmls", "licensed_in", "products", "service_areas", "designations", "awards", "education", "company"])
def test_an_own_fact_with_no_row_is_missing(db, field):
    db.drop(field)
    assert _facts(_profile())[field] == {"field": field, "present": False, "value": None, "source": None, "trust_tier": None, "confirmed_at": None, "source_line": None}


@pytest.mark.parametrize("blank", [None, "", "  ", []])
def test_an_own_fact_row_with_a_blank_value_is_missing(db, blank):
    db.get("nmls")["value"] = blank
    assert _facts(_profile())["nmls"]["present"] is False


def test_a_fact_the_plan_does_not_know_is_ignored(db):
    db.facts.append(fact("favourite_colour", "blue"))
    assert [f["field"] for f in _profile()["facts"]] == FIELDS


# --- source lines --------------------------------------------------------------------------------


def test_the_source_line_adds_the_date_only_when_there_is_one(db):
    f = _facts(_profile())
    assert f["name"]["source_line"] == "Confirmed by you · Oct 16" and f["name"]["source"] == "Confirmed by you"
    assert f["title"]["source_line"] == "From LinkedIn" and f["title"]["confirmed_at"] is None
    assert f["name"]["trust_tier"] == "owner_verified" and f["title"]["trust_tier"] == "imported" and f["licensed_in"]["trust_tier"] == "authority_verified"


@pytest.mark.parametrize("when,text", [(datetime(2026, 1, 5, 9, 0), "Jan 5"), (datetime(2026, 12, 31, 23, 59), "Dec 31"), (datetime(2026, 2, 10, 0, 0), "Feb 10"),
                                       (datetime(2026, 10, 16, 9, 0), "Oct 16")])
def test_the_date_is_month_and_day_without_a_leading_zero(db, when, text):
    db.get("name")["confirmed_at"] = when
    assert _facts(_profile())["name"]["source_line"] == f"Confirmed by you · {text}"


def test_confirmed_at_is_an_iso_time_stamp_with_a_z(db):
    assert _facts(_profile())["name"]["confirmed_at"] == "2026-10-16T09:00:00Z"


# --- credentials and graph -----------------------------------------------------------------------


@pytest.mark.parametrize("drop,added", [((), 3), (("designations",), 2), (("designations", "awards"), 1), (("designations", "awards", "education"), 0), (("education",), 2)])
def test_credentials_count_the_present_designations_awards_and_education(db, drop, added):
    db.drop(*drop)
    assert _profile()["credentials"] == {"added": added, "of": 3}


def test_the_graph_adds_up_and_counts_the_groups_with_facts(db):
    assert _profile()["graph"] == {"groups": [{"key": k, "facts": n} for k, n in zip(GROUPS, [12, 9, 6, 11, 15, 14], strict=True)], "facts_total": 67, "sources": 6}


def test_a_group_with_no_facts_is_not_a_source_and_the_order_is_the_pages(db):
    db.groups = list(reversed(db.groups))
    db.groups[0]["facts"] = 0  # presence
    g = _profile()["graph"]
    assert [x["key"] for x in g["groups"]] == GROUPS and g["facts_total"] == 53 and g["sources"] == 5


def test_a_seat_with_no_group_rows_has_an_empty_graph(db):
    db.groups = []
    assert _profile()["graph"] == {"groups": [], "facts_total": 0, "sources": 0}


# --- preview -------------------------------------------------------------------------------------


def test_the_preview_is_the_facts_and_the_newest_snapshot(db):
    assert _profile()["preview"] == {"title": "Loan Officer", "company": "Example Lending Co", "city": "Davenport", "rating": 4.9, "reviews": 128,
                                     "nmls": "482913", "strength_pct": 64, "photo_url": "https://example.test/p.jpg"}


def test_with_no_snapshot_rating_reviews_strength_and_city_are_unknown_not_zero(db):
    db.snap = None
    p = _profile()["preview"]
    assert (p["rating"], p["reviews"], p["strength_pct"], p["city"]) == (None, None, None, None)
    assert p["nmls"] == "482913"


def test_a_snapshot_with_null_figures_keeps_them_null(db):
    db.snap = {"review_avg": None, "review_count": None, "profile_strength_pct": None, "rank_city": None}
    p = _profile()["preview"]
    assert (p["rating"], p["reviews"], p["strength_pct"], p["city"]) == (None, None, None, None)


def test_a_missing_nmls_company_title_or_photo_is_null_in_the_preview(db):
    db.drop("nmls", "company")
    db.person.update(title=None, profile_photo=None)
    p = _profile()["preview"]
    assert (p["nmls"], p["company"], p["title"], p["photo_url"]) == (None, None, None, None)


def test_a_decimal_rating_is_a_float(db):
    from decimal import Decimal
    db.snap["review_avg"] = Decimal("4.5")
    assert _profile()["preview"]["rating"] == 4.5 and isinstance(_profile()["preview"]["rating"], float)


# --- the response model --------------------------------------------------------------------------


def test_the_service_output_is_a_valid_profile_response(db):
    body = ProfileResponse.model_validate(_profile()).model_dump()
    assert body == _profile() | {"as_of": body["as_of"]}


def test_a_not_ready_answer_is_a_valid_profile_response(db):
    db.facts = []
    body = ProfileResponse.model_validate(_profile())
    assert body.ready is False and body.facts is None and body.graph is None


def test_the_response_model_refuses_an_unknown_field_or_tier(db):
    body = _profile()
    body["facts"][0]["field"] = "favourite_colour"
    with pytest.raises(ValueError):
        ProfileResponse.model_validate(body)
    body = _profile()
    body["facts"][0]["trust_tier"] = "verified"
    with pytest.raises(ValueError):
        ProfileResponse.model_validate(body)


def test_every_per_seat_query_is_scoped_to_the_owned_seat(db):
    _profile()
    text = {t: " ".join(q.lower().split()) for q in _queries(db) for t in ("ta.description", "profile_facts", "profile_graph_groups", "home_snapshots") if t in q.lower()}
    assert "where ta.id = %s" in text["ta.description"] and "where ta.id <>" not in text["ta.description"]
    for table in ("profile_facts", "profile_graph_groups", "home_snapshots"):
        assert "where tier_agent_id = %s" in text[table] and "<> %s" not in text[table], table
