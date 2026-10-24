"""sales navigation endpoints (no live DB/auth): the SQL each one sends, the raw PostgREST-shaped
answers, which reads throw and which are tolerant, the browse paging (exact count, 416 past the
end). Read-only."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import psycopg
import pytest

from sales.queries import nav as q
from sales.queries.contracts_test import (
    AUTH_READ,
    RID,
    RID2,
    install_fake_db,
    make_client,
    sqls,
    table_of,
)
from sales.routers.nav_data import router

P = "/sales/nav"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


def params_of(log, sql):
    return next(p for _, x, p in log if x == sql)


@pytest.mark.parametrize("path", [
    f"{P}/overview?period=month&since=2026-10-01", f"{P}/browse?tab=categories&page_size=6",
    f"{P}/scores/{RID}", f"{P}/organizations/{RID}", f"{P}/organizations/{RID}/brand-rollup",
    f"{P}/professionals/{RID}", f"{P}/events", f"{P}/sellers/{RID}",
    f"{P}/category-dashboard?gcid=gcid:x", f"{P}/teams/insurance",
])
def test_every_read_needs_a_signed_in_user(path):
    assert make_client(router, None).get(path).status_code == 403


def test_seller_book_needs_a_signed_in_user():
    assert make_client(router, None).post(f"{P}/seller-book", json={}).status_code == 403


# --- overview --------------------------------------------------------------------------------

def test_overview_reads_counts_and_the_capped_events(dbfake):
    log, state, leases = dbfake

    def answer(sql, params):
        if "count(*)" in sql:
            return [{"n": {"gbp_categories": 4041, "professionals": 1, "organizations": 2}[table_of(sql)]}]
        if table_of(sql) == "exp_contracts":
            return [{"id": uuid.UUID(RID), "mrr": Decimal("250.00"),
                     "created_at": dt.datetime(2026, 10, 2, 1, 2, 3, 400000, tzinfo=dt.UTC)}]
        return []

    state["answer"] = answer
    out = client().get(f"{P}/overview", params={"period": "month", "since": "2026-10-01"}).json()
    assert leases == [AUTH_READ]
    assert out["cats"] == 4041 and out["proClaims"] == 1 and out["orgClaims"] == 2
    assert out["contracts"] == [{"id": RID, "mrr": 250, "created_at": "2026-10-02T01:02:03.4+00:00"}]
    s = sqls(log)
    assert [table_of(x) for x in s] == ["exp_sales_reps", "exp_sales_quotas", "exp_contracts",
                                        "gbp_categories", "professionals", "organizations",
                                        "exp_activity_events", "exp_sales_assignments"]
    quota = params_of(log, s[1])
    assert quota["period_type_1"] == "month" and dt.date(2026, 10, 1) in quota.values()
    since_ts = dt.datetime(2026, 10, 1, tzinfo=dt.UTC)
    assert since_ts in params_of(log, s[4]).values() and since_ts in params_of(log, s[5]).values()
    assert "is_demo IS false" in s[4] and "claimed_at >= " in s[4]
    ev = params_of(log, s[6])
    assert "ORDER BY" not in s[6] and "LIMIT" in s[6] and 1000 in ev.values()  # .limit(5000) cut to the cap


def test_overview_tolerates_errors_and_a_failed_count_is_null(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("denied") \
        if "count(*)" in s else [{"id": 1}]
    out = client().get(f"{P}/overview", params={"period": "year", "since": "2026-01-01"}).json()
    assert out["cats"] is None and out["proClaims"] is None and out["reps"] == [{"id": 1}]


# --- browse ----------------------------------------------------------------------------------

def test_browse_categories_page_and_exact_count(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 30}] if "count(*)" in s else [{"gcid": "gcid:a"}]
    out = client().get(f"{P}/browse", params={"tab": "categories", "q": " agent* ", "page": 2,
                                              "page_size": 6}).json()
    assert out == {"rows": [{"gcid": "gcid:a"}], "count": 30}
    rows_sql, count_sql = sqls(log)
    assert "ORDER BY public.gbp_categories.display_name ASC" in rows_sql
    assert "display_name ILIKE" in rows_sql and "display_name ILIKE" in count_sql
    p = params_of(log, rows_sql)
    assert p["param_1"] == 6 and p["param_2"] == 6  # LIMIT 6 OFFSET 6
    assert "%agent%%" in p.values()  # trimmed; `*` read as `%`


def test_browse_no_query_no_filter(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 0}] if "count(*)" in s else []
    assert client().get(f"{P}/browse", params={"tab": "categories", "page_size": 6}).json() == \
        {"rows": [], "count": 0}
    assert "WHERE" not in sqls(log)[0]


def test_browse_past_the_end_is_416(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 5}] if "count(*)" in s else []
    r = client().get(f"{P}/browse", params={"tab": "professionals", "page": 3, "page_size": 6})
    assert r.status_code == 416
    state["answer"] = lambda s, p: [{"n": 6}] if "count(*)" in s else []
    assert client().get(f"{P}/browse", params={"tab": "professionals", "page": 2,
                                               "page_size": 6}).status_code == 200


def test_browse_professionals_filters(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 1}] if "count(*)" in s else []
    client().get(f"{P}/browse", params={"tab": "professionals", "q": "x", "page_size": 6,
                                        "gcid": "gcid:real_estate_agent"})
    rows_sql = sqls(log)[0]
    assert "is_demo IS false" in rows_sql and "professionals.gcid = " in rows_sql
    assert "ORDER BY public.professionals.display_name ASC" in rows_sql
    log.clear()
    client().get(f"{P}/browse", params={"tab": "professionals", "page_size": 6, "include_demo": True})
    assert "is_demo IS false" not in sqls(log)[0]


def test_browse_brands_and_locations_entity_types(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 0}] if "count(*)" in s else []
    client().get(f"{P}/browse", params={"tab": "brands", "page_size": 6})
    p = params_of(log, sqls(log)[0])
    assert {"brand", "enterprise", "company"} <= set(p.values())
    log.clear()
    client().get(f"{P}/browse", params={"tab": "locations", "page_size": 6})
    p = params_of(log, sqls(log)[0])
    assert {"office", "location", "branch", "firm"} <= set(p.values())
    assert "ORDER BY public.organizations.name ASC" in sqls(log)[0]


def test_browse_teams_and_sellers_every_rep(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "group_key": "insurance"}]
    out = client().get(f"{P}/browse", params={"tab": "teams", "page_size": 6}).json()
    assert out == {"rows": [{"id": RID, "group_key": "insurance"}], "count": None}
    (sql,) = sqls(log)
    assert "ORDER BY public.exp_sales_reps.group_key ASC, public.exp_sales_reps.name ASC" in sql


def test_browse_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.QueryCanceled("canceling statement")
    assert client().get(f"{P}/browse", params={"tab": "brands", "page_size": 6}).status_code == 400
    assert client().get(f"{P}/browse", params={"tab": "nope", "page_size": 6}).status_code == 422


# --- drill-downs -----------------------------------------------------------------------------

def test_score_newest_one(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"entity_id": uuid.UUID(RID), "total_score": Decimal("612.5")}]
    assert client().get(f"{P}/scores/{RID}").json() == {"entity_id": RID, "total_score": 612.5}
    (sql,) = sqls(log)
    assert "ORDER BY public.search_rank_scores.calculated_at DESC" in sql
    assert params_of(log, sql)["param_1"] == 1
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/scores/{RID}").json() is None


def test_org_and_professional_star_maybe_single(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/organizations/{RID}").json() == {"id": RID}
    assert client().get(f"{P}/professionals/{RID}").json() == {"id": RID}
    assert "public.organizations.hierarchy_depth" in sqls(log)[0]  # select("*")
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get(f"{P}/organizations/{RID}").status_code == 406
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation("invalid input syntax")
    assert client().get(f"{P}/professionals/x").status_code == 400


def test_brand_rollup_locations_threw_the_rest_tolerant(dbfake):
    log, state, _ = dbfake

    def answer(sql, params):
        if "count(*)" in sql:
            if "JOIN public.organizations" in sql:
                return psycopg.errors.UndefinedTable("no embed")
            return [{"n": 3}]
        if table_of(sql) == "exp_claim_events":
            return [{"entity_id": uuid.UUID(RID), "entity_type": "location", "event_type": "claimed"}]
        return [{"id": uuid.UUID(RID2)}]

    state["answer"] = answer
    out = client().get(f"{P}/organizations/{RID}/brand-rollup").json()
    assert out == {"locations": [{"id": RID2}], "childCount": 3, "directCount": 3,
                   "viaOfficesCount": None,
                   "claims": [{"entity_id": RID, "entity_type": "location", "event_type": "claimed"}]}
    s = sqls(log)
    assert "ORDER BY public.organizations.name ASC" in s[0] and params_of(log, s[0])["param_1"] == 500
    via = next(x for x in s if "JOIN public.organizations" in x)
    assert "professionals.primary_org_id = public.organizations.id" in via
    assert "public.organizations.parent_org_id = " in via
    claims_sql = next(x for x in s if "FROM public.exp_claim_events" in x)
    assert "ORDER BY" not in claims_sql and params_of(log, claims_sql)["param_1"] == 1000
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"{P}/organizations/{RID}/brand-rollup").status_code == 403


def test_events_for_first_filter_given(dbfake):
    log, _, _ = dbfake
    client().get(f"{P}/events", params={"account_id": "a", "logo": "l"})
    (sql,) = sqls(log)
    assert "exp_activity_events.account_id = " in sql and ".logo = " not in sql
    assert "ORDER BY public.exp_activity_events.occurred_at DESC" in sql
    log.clear()
    client().get(f"{P}/events")
    assert "WHERE" not in sqls(log)[0]


def test_seller_rep_threw_quotas_and_assignments_tolerant(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("x") \
        if table_of(s) == "exp_sales_assignments" else [{"id": uuid.UUID(RID)}]
    out = client().get(f"{P}/sellers/{RID}").json()
    assert out == {"rep": {"id": RID}, "quotas": [{"id": RID}], "assignments": []}
    assert "ORDER BY public.exp_sales_quotas.period_start DESC" in sqls(log)[1]
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get(f"{P}/sellers/{RID}").status_code == 406


def test_seller_book(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/seller-book", json={"account_ids": [RID]}).json() == \
        {"contracts": [], "events": []}
    s = sqls(log)
    assert table_of(s[0]) == "exp_contracts" and "account_id IN" in s[0]
    assert "ORDER BY public.exp_activity_events.occurred_at DESC" in s[1]
    assert params_of(log, s[1])["param_1"] == 500
    assert client().post(f"{P}/seller-book", json={"account_ids": []}).status_code == 422


def test_category_dashboard(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 9}] if "count(*)" in s else [{"gcid": "gcid:x"}]
    out = client().get(f"{P}/category-dashboard", params={"gcid": "gcid:x"}).json()
    assert out == {"category": {"gcid": "gcid:x"}, "orgCount": 9, "proCount": 9,
                   "sampleOrgs": [{"gcid": "gcid:x"}]}
    s = sqls(log)
    assert params_of(log, s[0])["gcid_1"] == "gcid:x"  # stored exactly, prefix kept
    assert "ORDER BY public.organizations.name ASC" in s[-1] and params_of(log, s[-1])["param_1"] == 25


def test_team(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/teams/insurance").json() == {"reps": [], "quotas": [], "tiers": []}
    s = sqls(log)
    assert [table_of(x) for x in s] == ["exp_sales_reps", "exp_sales_quotas", "exp_account_tier"]
    assert "ORDER BY public.exp_sales_reps.role ASC" in s[0]


def test_like_of_is_postgrest():
    assert q.like_of(" a*b ") == "%a%b%"
