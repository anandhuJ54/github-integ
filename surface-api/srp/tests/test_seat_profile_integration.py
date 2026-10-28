"""The Profile read on real Postgres (srp/profile-page-schema, task 7): the seeded rows, the presence rules, the existing-table facts read from their columns,
ownership, read-only, and that the Profile preview and the Home page agree for the same seat (spec criteria 3, 5, 6, 7 and 13).

Skipped unless SRP_TEST_DATABASE_URL points at a database with the `srp_cleanup` schema (its table shapes are copied into a scratch schema, the Home, SRS and
Profile tables are created there by their scripts, and the seed fills them; the scratch schema is dropped afterwards):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/v3_local uv run pytest srp/tests/test_seat_profile_integration.py
"""
from __future__ import annotations

import os
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time
from pathlib import Path

import psycopg
import pytest
from fastapi import HTTPException
from psycopg import errors
from psycopg.rows import dict_row

from _base.config import get_settings
from _base.db import session as db_session
from surfaces.srp.seat import home, profile
from surfaces.srp.seat import seed_home as sh
from surfaces.srp.seat import seed_profile_plan as pp
from surfaces.srp.seat.schemas import ProfileResponse

URL = os.environ.get("SRP_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="SRP_TEST_DATABASE_URL is not set")

TABLES = ["users", "tier_agents", "tier_agent_details", "srs_config_categories", "user_search_rank_scores", "voce_articles",
          "website_analytics_data", "ai_authority_stats"]
SCRIPT = Path(__file__).resolve().parents[1] / "db" / "local" / "home_schema.sql"
HARDENING = SCRIPT.with_name("home_schema_hardening.sql")
TODAY = date(2026, 10, 27)
N = 26
REFUSED = [(3, "deactivated user"), (8, "manually deactivated"), (17, "soft-deleted seat"), (20, "soft-deleted user"), (999, "no such seat")]
LIVE = [s for s in range(1, N + 1) if s not in {3, 8, 17, 20}]
FIELDS = list(pp.EXISTING_FIELDS + pp.OWN_FIELDS)
ORDER = ["name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email", "address", "hours", "nmls", "licensed_in", "products",
         "service_areas", "designations", "awards", "education", "company"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@pytest.fixture
def schema(monkeypatch):
    name = "srp_it_" + uuid.uuid4().hex[:8]
    with psycopg.connect(URL, autocommit=True) as c:
        if not c.execute("select 1 from pg_namespace where nspname = 'srp_cleanup'").fetchone():
            pytest.skip("the database has no srp_cleanup schema to copy table shapes from")
        c.execute(f"create schema {name}")
        for t in TABLES:
            c.execute(f"create table {name}.{t} (like srp_cleanup.{t} including all)")
        c.execute(re.sub(r"\bsrp_cleanup\b", name, SCRIPT.read_text()))
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.read_text()))   # the live database has the hardening too
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("srs_schema.sql").read_text()))   # the seed also writes the SRS page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("profile_schema.sql").read_text()))   # and the Profile page's tables
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("insights_schema.sql").read_text()))   # and the Insights page's tables
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("web_analytics_schema.sql").read_text()))   # and the Web analytics page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("connections_schema.sql").read_text()))   # and the Connections page's table
        c.execute(re.sub(r"\bsrp_cleanup\b", name, HARDENING.with_name("network_schema.sql").read_text()))   # and the Network page's tables
        for i in range(1, N + 1):
            c.execute(f"insert into {name}.users (id, email, first_name, last_name, password_digest, organization_id, created_at, updated_at) "
                      f"overriding system value values (%s, %s, %s, 'Example', 'x', 1, now(), now())", (i, f"it{i}@example.test", f"User{i}"))
            c.execute(f"insert into {name}.tier_agents (id, tier_id, user_id, title, year_started, created_at, updated_at) "
                      f"overriding system value values (%s, 1, %s, 'Loan officer', %s, now(), now())", (i, i, "2010" if i != 2 else "n/a"))
        c.execute(f"insert into {name}.srs_config_categories (id, name, score, created_at, updated_at) overriding system value values (1, 'Mock', 5, now(), now())")
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.setenv("SRP_LOCAL_SCHEMA", name)
    monkeypatch.setattr(sh, "_today", lambda: TODAY)
    monkeypatch.setattr(home, "_today", lambda: TODAY)
    get_settings.cache_clear()
    db_session.close_pools()
    sh.seed(dry_run=False, backup_path=None)
    # two seats that must not be readable or counted
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"update {name}.users set deactivated_at = now() where id = 3")
        c.execute(f"update {name}.users set is_manual_deactivated = true where id = 8")
        c.execute(f"update {name}.users set deleted_at = now() where id = 20")
        c.execute(f"update {name}.tier_agents set deleted_at = now() where id = 17")
    yield name
    db_session.close_pools()
    get_settings.cache_clear()
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(f"drop schema {name} cascade")



def q(schema, sql, *params):
    with psycopg.connect(URL, autocommit=True, row_factory=dict_row) as c:
        return c.execute(sql.replace("{s}", schema), params).fetchall()


def run(schema, sql, *params):
    with psycopg.connect(URL, autocommit=True) as c:
        c.execute(sql.replace("{s}", schema), params)


def get(seat):
    return profile.profile({"sub": str(seat)}, str(seat))


def facts_of(body):
    return {f["field"]: f for f in body["facts"]}


def planned():
    seats = list(range(1, N + 1))
    plans = sh.build_plan(seats, [sh.Category(1, 5)])
    markets = {p.seat_id: p.zipcode for p in plans}
    prof = {s.seat_id: s for s in pp.build_profile_plan(seats, datetime.combine(TODAY, time(12, 0)), markets).seats}
    return prof, {p.seat_id: p for p in plans}


def line(source, when):
    return source if when is None else f"{source} · {MONTHS[when.month - 1]} {when.day}"


# --- every value is the stored one ------------------------------------------------------------------------------------


def test_every_seat_gets_its_planned_facts_in_the_pages_order(schema):
    prof, home_plans = planned()
    for seat in LIVE:
        body, exp, hp_ = get(seat), prof[seat], home_plans[seat]
        assert ProfileResponse.model_validate(body).model_dump() == body, seat
        assert body["ready"] is True and body["data"] == "mock" and [f["field"] for f in body["facts"]] == ORDER, seat
        got, planned_facts = facts_of(body), {f.field: f for f in exp.facts}
        c = exp.columns
        existing = {"name": f"User{seat} Example", "title": c.title, "photo": c.profile_photo, "bio": c.description, "year_started": hp_.year_started,
                    "office_phone": c.phone_number, "mobile_phone": c.mobile_number, "email": f"it{seat}@example.test"}
        for field in ORDER:
            g = got[field]
            value = existing[field] if field in existing else (planned_facts[field].value if field in planned_facts else None)
            assert g["value"] == (value if value else None), (seat, field)
            assert g["present"] == bool(value), (seat, field)
            if g["present"] and field in planned_facts:
                f = planned_facts[field]
                assert (g["source"], g["trust_tier"], g["source_line"]) == (f.source, f.trust_tier, line(f.source, f.confirmed_at)), (seat, field)
                assert g["confirmed_at"] == (f.confirmed_at.strftime("%Y-%m-%dT%H:%M:%SZ") if f.confirmed_at else None), (seat, field)
            else:
                assert (g["source"], g["trust_tier"], g["source_line"], g["confirmed_at"]) == (None,) * 4, (seat, field)
        assert body["credentials"] == {"added": sum(got[f]["present"] for f in ("designations", "awards", "education")), "of": 3}, seat
        assert body["graph"]["groups"] == [{"key": g.key, "facts": g.facts} for g in exp.groups], seat
        assert body["graph"]["facts_total"] == sum(g.facts for g in exp.groups) and body["graph"]["sources"] == sum(1 for g in exp.groups if g.facts > 0), seat


def test_json_strings_stay_strings_and_products_stay_a_list_of_strings(schema):
    for seat in LIVE:
        got = facts_of(get(seat))
        for field in ("address", "hours", "nmls", "licensed_in", "service_areas", "designations", "awards", "education", "company"):
            assert got[field]["value"] is None or type(got[field]["value"]) is str, (seat, field)
        products = got["products"]["value"]
        assert products is None or (isinstance(products, list) and all(type(p) is str for p in products)), seat
        if got["nmls"]["present"]:
            assert got["nmls"]["value"].isdigit(), "an NMLS number is a string of digits, never a JSON number"


def test_the_existing_table_facts_are_read_from_their_columns_not_from_a_copy(schema):
    run(schema, "update {s}.users set first_name = 'Zed', last_name = 'Quill', email = 'zed@example.test' where id = 1")
    run(schema, "update {s}.tier_agents set title = 'Chief', description = 'A new bio that is certainly long enough to count as a full one.', "
                "phone_number = '+15635550199', mobile_number = '+13095550188', year_started = '1999' where id = 1")
    f = facts_of(get(1))
    assert (f["name"]["value"], f["email"]["value"], f["title"]["value"], f["office_phone"]["value"], f["mobile_phone"]["value"], f["year_started"]["value"]) == (
        "Zed Quill", "zed@example.test", "Chief", "+15635550199", "+13095550188", "1999")
    assert f["bio"]["value"].startswith("A new bio")
    assert q(schema, "select count(*) n from {s}.profile_facts where value::text like '%%Zed%%' or value::text like '%%Chief%%'")[0]["n"] == 0


@pytest.mark.parametrize("column,field", [("title", "title"), ("description", "bio"), ("phone_number", "office_phone"), ("mobile_number", "mobile_phone")])
def test_a_blank_column_is_a_missing_fact_even_though_its_source_row_stays(schema, column, field):
    prof, _ = planned()
    seat = next(s for s in LIVE if field in {f.field for f in prof[s].facts})
    run(schema, f"update {{s}}.tier_agents set {column} = '   ' where id = %s", seat)
    got = facts_of(get(seat))[field]
    assert (got["present"], got["value"], got["source"], got["source_line"]) == (False, None, None, None)
    assert q(schema, "select count(*) n from {s}.profile_facts where tier_agent_id = %s and field = %s", seat, field)[0]["n"] == 1


def test_an_own_fact_without_its_row_is_missing_and_the_other_seats_are_unaffected(schema):
    prof, _ = planned()
    seat = next(s for s in LIVE if "address" in {f.field for f in prof[s].facts})
    other = next(s for s in LIVE if s != seat and "address" in {f.field for f in prof[s].facts})
    before = facts_of(get(other))["address"]
    run(schema, "delete from {s}.profile_facts where tier_agent_id = %s and field = 'address'", seat)
    assert facts_of(get(seat))["address"]["present"] is False
    assert facts_of(get(other))["address"] == before


def test_each_seat_sees_only_its_own_facts_and_groups(schema):
    prof, _ = planned()
    a, b = LIVE[0], LIVE[1]
    run(schema, "update {s}.profile_facts set value = to_jsonb('Only Seat A'::text) where tier_agent_id = %s and field = 'company'", a)
    run(schema, "update {s}.profile_graph_groups set facts = 99 where tier_agent_id = %s and group_key = 'reviews'", a)
    assert facts_of(get(a))["company"]["value"] == "Only Seat A" and facts_of(get(b))["company"]["value"] == next(f.value for f in prof[b].facts if f.field == "company")
    assert {g["key"]: g["facts"] for g in get(a)["graph"]["groups"]}["reviews"] == 99
    assert {g["key"]: g["facts"] for g in get(b)["graph"]["groups"]}["reviews"] == next(g.facts for g in prof[b].groups if g.key == "reviews")


# --- the preview and the Home page agree (criterion 5) -------------------------------------------------------------------


def test_the_preview_equals_the_home_pages_figures_for_every_seat(schema):
    for seat in LIVE:
        p, h = get(seat)["preview"], home.home({"sub": str(seat)}, str(seat))
        assert p["rating"] == h["tiles"]["reviews"]["avg"] and p["reviews"] == h["tiles"]["reviews"]["count"], seat
        assert p["strength_pct"] == h["tiles"]["profile_strength"]["pct"] and p["city"] == h["rank"]["city"], seat
        assert p["title"] == facts_of(get(seat))["title"]["value"] and p["photo_url"] == facts_of(get(seat))["photo"]["value"], seat
        assert p["nmls"] == facts_of(get(seat))["nmls"]["value"] and p["company"] == facts_of(get(seat))["company"]["value"], seat


def test_they_still_agree_after_a_newer_snapshot_is_added(schema):
    run(schema, "insert into {s}.home_snapshots (tier_agent_id, as_of, total, band_id, rank_position, rank_of, rank_city, profile_strength_pct, review_avg, review_count) "
                "select tier_agent_id, as_of + interval '1 hour', 100, band_id, 2, rank_of, 'Newtown', 11, 3.5, 7 from {s}.home_snapshots "
                "where tier_agent_id = 1 order by as_of desc limit 1")
    p, h = get(1)["preview"], home.home({"sub": "1"}, "1")
    assert (p["city"], p["rating"], p["reviews"], p["strength_pct"]) == ("Newtown", 3.5, 7, 11) == (h["rank"]["city"], h["tiles"]["reviews"]["avg"], h["tiles"]["reviews"]["count"], h["tiles"]["profile_strength"]["pct"])


def test_with_no_snapshot_the_preview_figures_are_unknown_and_the_facts_still_show(schema):
    run(schema, "delete from {s}.home_snapshots where tier_agent_id = 2")
    body = get(2)
    p = body["preview"]
    assert (p["rating"], p["reviews"], p["strength_pct"], p["city"]) == (None, None, None, None)
    assert body["ready"] is True and facts_of(body)["name"]["present"]


# --- not ready, ownership, read only ------------------------------------------------------------------------------------


def test_a_seat_with_no_fact_rows_is_not_ready(schema):
    run(schema, "delete from {s}.profile_facts where tier_agent_id = 2")
    body = get(2)
    assert body["ready"] is False and body["facts"] is None and body["preview"] is None and body["graph"] is None
    assert get(1)["ready"] is True


@pytest.mark.parametrize("seat,why", REFUSED)
def test_a_seat_that_is_not_the_callers_or_not_active_is_403(schema, seat, why):
    user = seat if seat not in (17, 999) else 1
    with pytest.raises(HTTPException) as e:
        profile.profile({"sub": str(user)}, str(seat))
    assert e.value.status_code == 403, why


def test_one_user_cannot_read_another_users_seat(schema):
    with pytest.raises(HTTPException):
        profile.profile({"sub": "1"}, "2")


def test_the_read_runs_in_a_read_only_transaction_and_writes_nothing(schema, monkeypatch):
    seen = {}
    real = profile.connection

    class Spy:
        def __init__(self, conn):
            self.conn = conn

        def execute(self, sql, *a, **k):
            cur = self.conn.execute(sql, *a, **k)
            if "read" not in seen:
                seen["read"] = self.conn.execute("show transaction_read_only").fetchone()["transaction_read_only"]
            return cur

    @contextmanager
    def spy():
        with real() as conn:
            yield Spy(conn)

    monkeypatch.setattr(profile, "connection", spy)
    counts = lambda: q(schema, "select (select count(*) from {s}.profile_facts) f, (select count(*) from {s}.profile_graph_groups) g, (select count(*) from {s}.tier_agents) t")
    before = counts()
    get(1)
    assert seen["read"] == "on" and counts() == before


def test_the_database_refuses_a_write_inside_that_transaction(schema):
    with db_session.connection() as conn:
        conn.execute("set transaction read only")
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute(f"update {schema}.profile_facts set source = 'x'")


# --- what the database enforces (criterion 7) --------------------------------------------------------------------------------


def test_the_seeded_database_keeps_its_rules(schema):
    groups = q(schema, "select tier_agent_id, count(*) n from {s}.profile_graph_groups group by 1")
    assert len(groups) == N and all(r["n"] == 6 for r in groups)
    with pytest.raises(errors.CheckViolation):  # a second copy of an existing-table value
        run(schema, "update {s}.profile_facts set value = to_jsonb('Copy'::text) where id = (select min(id) from {s}.profile_facts where field = 'name')")
    with pytest.raises(errors.CheckViolation):
        run(schema, "update {s}.profile_facts set trust_tier = 'verified' where id = (select min(id) from {s}.profile_facts)")
    with pytest.raises(errors.UniqueViolation):
        run(schema, "insert into {s}.profile_facts (tier_agent_id, field, source, trust_tier) select tier_agent_id, field, 'x', 'imported' from {s}.profile_facts where value is null limit 1")
    with pytest.raises(errors.CheckViolation):
        run(schema, "update {s}.profile_graph_groups set facts = -1 where id = (select min(id) from {s}.profile_graph_groups)")


def test_a_group_with_no_row_is_not_invented(schema):
    run(schema, "delete from {s}.profile_graph_groups where tier_agent_id = 1 and group_key = 'presence'")
    g = get(1)["graph"]
    assert [x["key"] for x in g["groups"]] == ["identity", "contact", "licence", "products", "reviews"] and g["sources"] == 5


def test_the_seeded_facts_agree_with_each_other_and_with_the_home_market(schema):
    """The SRS review's lesson on the written rows: the address city is the Home market city, a licensed state goes with an NMLS number, the graph follows the facts."""
    for seat in LIVE:
        body, h = get(seat), home.home({"sub": str(seat)}, str(seat))
        f = facts_of(body)
        if f["address"]["present"]:
            assert h["rank"]["city"] in f["address"]["value"], seat
        assert f["nmls"]["present"] == f["licensed_in"]["present"], seat
        groups = {g["key"]: g["facts"] for g in body["graph"]["groups"]}
        assert (groups["products"] > 0) == f["products"]["present"], seat
        assert (groups["licence"] > 0) == (f["nmls"]["present"] or f["licensed_in"]["present"]), seat
        if f["bio"]["present"] and len(f["bio"]["value"]) < 60:
            assert f["bio"]["source"] != "Approved by you", seat
