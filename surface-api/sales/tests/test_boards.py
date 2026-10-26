"""sales boards endpoints (no live DB/auth): the SQL each one sends, in the browser's order, the
raw PostgREST-shaped answers, the tolerant reads, and the note writes (callback time from the
server's clock). No write reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import psycopg
import pytest

from sales.tests.test_contracts import (
    AUTH_READ,
    AUTH_WRITE,
    RID,
    RID2,
    install_fake_db,
    make_client,
    sqls,
    table_of,
)
from surfaces.sales.board import services as q
from surfaces.sales.board.router import router

P = "/sales/boards"
REP = "c1000000-0000-4000-8000-000000000001"
FIXED = dt.datetime(2026, 10, 24, 12, 0, tzinfo=dt.UTC)


@pytest.fixture
def dbfake(monkeypatch):
    monkeypatch.setattr(q, "now", lambda: FIXED)
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/desk/{REP}"), ("post", f"{P}/desk/new-profiles"), ("get", f"{P}/seller-board"),
    ("get", f"{P}/roster"), ("get", f"{P}/category-story"), ("get", f"{P}/board"),
    ("post", f"{P}/notes"), ("post", f"{P}/referral-requests"), ("patch", f"{P}/notes/{RID}"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method in ("post", "patch") else {}
    assert getattr(make_client(router, None), method)(path, **kw).status_code == 403


# --- seller desk -----------------------------------------------------------------------------

def test_desk_three_rounds_raw_with_counts(dbfake):
    log, state, leases = dbfake

    def answer(sql, params):
        t = table_of(sql)
        if t == "exp_sales_reps":
            return [{"id": uuid.UUID(REP), "name": "Rep", "attribution_target": Decimal("1500.50")}]
        if t == "exp_territories":
            return [{"id": uuid.UUID(RID), "label": "A"}, {"id": uuid.UUID(RID2), "label": "B"}]
        if t == "professionals":
            return [{"n": 7 if "claimed IS true" in sql else 40}]
        if t == "exp_revenue_components":
            return [{"source": "upgrade", "amount": Decimal("99.90"), "period_start": dt.date(2026, 10, 1),
                     "seller_id": uuid.UUID(REP), "attributed_seller_id": None}]
        return []

    state["answer"] = answer
    out = client().get(f"{P}/desk/{REP}").json()
    assert leases == [AUTH_READ]
    assert out["rep"] == {"id": REP, "name": "Rep", "attribution_target": 1500.5}
    assert [t["id"] for t in out["territories"]] == [RID, RID2]
    assert out["bookTotal"] == 40 and out["bookClaimed"] == 7
    assert out["revenue"] == [{"source": "upgrade", "amount": 99.9, "period_start": "2026-10-01",
                               "seller_id": REP, "attributed_seller_id": None}]
    assert out["events"] == [] and out["demos"] == [] and out["quarters"] == []
    tables = [table_of(s) for s in sqls(log)]
    assert tables == ["exp_sales_reps", "exp_territories", "professionals", "professionals",
                      "exp_claim_events", "exp_sales_demos", "exp_revenue_components",
                      "exp_sales_quotas"]
    s = sqls(log)
    assert "LIMIT %(param_1)s" in s[0] and "ORDER BY public.exp_territories.label ASC" in s[1]
    assert "public.exp_revenue_components.seller_id = " in s[6] and \
        " OR public.exp_revenue_components.attributed_seller_id = " in s[6]
    assert "period_type = %(period_type_1)s" in s[7] and "ORDER BY public.exp_sales_quotas.period_start ASC" in s[7]


def test_desk_without_territories_counts_zero_without_asking(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(REP)}] if table_of(s) == "exp_sales_reps" else []
    out = client().get(f"{P}/desk/{REP}").json()
    assert out["bookTotal"] == 0 and out["bookClaimed"] == 0
    assert "professionals" not in [table_of(s) for s in sqls(log)]


def test_desk_null_for_no_rep_two_reps_or_a_failed_read(dbfake):
    _log, state, _ = dbfake
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/desk/{REP}").json() is None
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get(f"{P}/desk/{REP}").json() is None
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation("bad uuid")
    assert client().get(f"{P}/desk/not-a-uuid").json() is None


def test_desk_failed_count_is_null(dbfake):
    _, state, _ = dbfake

    def answer(sql, params):
        t = table_of(sql)
        if t == "professionals":
            return psycopg.errors.QueryCanceled("timeout")
        return [{"id": uuid.UUID(RID)}] if t in ("exp_sales_reps", "exp_territories") else []

    state["answer"] = answer
    out = client().get(f"{P}/desk/{REP}").json()
    assert out["bookTotal"] is None and out["bookClaimed"] is None


def test_new_profiles_since_from_the_server_clock(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"n": 3}]
    r = client().post(f"{P}/desk/new-profiles", json={"territory_ids": [RID], "days": 30})
    assert r.json() == {"count": 3} and leases == [AUTH_READ]
    (sql,) = sqls(log)
    assert "count(*)" in sql and "territory_id IN" in sql and "created_at >= " in sql
    params = next(p for _, x, p in log if x == sql)
    assert FIXED - dt.timedelta(days=30) in params.values()
    assert client().post(f"{P}/desk/new-profiles", json={"territory_ids": [], "days": 30}).status_code == 422


# --- seller board / roster / category story --------------------------------------------------

def test_seller_board_three_reads(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"value": Decimal("1200.00")}] if table_of(s) == "exp_sales_pipeline" else []
    out = client().get(f"{P}/seller-board").json()
    assert out == {"reps": [], "quotas": [], "pipeline": [{"value": 1200}]}
    s = sqls(log)
    assert [table_of(x) for x in s] == ["exp_sales_reps", "exp_sales_quotas", "exp_sales_pipeline"]
    assert "ORDER BY public.exp_sales_reps.name ASC" in s[0]
    assert "ORDER BY public.exp_sales_quotas.period_start DESC" in s[1]
    assert "ORDER BY" not in s[2] and "LIMIT %(param_1)s" in s[2]  # the 1000-row cap


def test_roster_and_category_story(dbfake):
    log, _state, _ = dbfake
    assert set(client().get(f"{P}/roster").json()) == {"reps", "metrics", "quotas", "stats"}
    s = sqls(log)
    assert [table_of(x) for x in s] == ["exp_sales_reps", "exp_sales_rep_metrics", "exp_sales_quotas",
                                        "exp_sales_category_stats"]
    assert "ORDER BY public.exp_sales_rep_metrics.period_start DESC" in s[1]
    log.clear()
    assert set(client().get(f"{P}/category-story").json()) == {"stats", "metrics", "reps"}
    assert [table_of(x) for x in sqls(log)] == ["exp_sales_category_stats", "exp_sales_rep_metrics",
                                                "exp_sales_reps"]


def test_roster_tolerates_a_failed_read(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("denied") \
        if table_of(s) == "exp_sales_category_stats" else [{"id": 1}]
    out = client().get(f"{P}/roster").json()
    assert out["stats"] == [] and out["reps"] == [{"id": 1}]


# --- board -----------------------------------------------------------------------------------

def test_board_reads_then_the_orgs_of_adoption_and_claim_logos(dbfake):
    log, state, _ = dbfake
    ORG1, ORG2 = RID, RID2

    def answer(sql, params):
        t = table_of(sql)
        if t == "exp_brand_adoption":
            return [{"org_id": uuid.UUID(ORG1)}, {"org_id": None}]
        if t == "exp_claim_events":
            return [{"logo_org_id": uuid.UUID(ORG2)}, {"logo_org_id": uuid.UUID(ORG1)}]
        if t == "organizations":
            return [{"id": uuid.UUID(ORG1), "name": "A", "logo_url": None, "is_demo": True}]
        return []

    state["answer"] = answer
    out = client().get(f"{P}/board").json()
    assert out["orgs"] == [{"id": ORG1, "name": "A", "logo_url": None, "is_demo": True}]
    s = sqls(log)
    assert [table_of(x) for x in s] == [
        "exp_sales_reps", "exp_claim_events", "exp_revenue_components", "exp_sales_demos",
        "exp_sales_notes", "exp_sales_quotas", "exp_sales_rep_metrics", "exp_territories",
        "exp_category_groups", "exp_brand_adoption", "organizations"]
    claims_sql = s[1]
    assert "ORDER BY public.exp_claim_events.occurred_at DESC" in claims_sql
    claims_params = next(p for _, x, p in log if x == claims_sql)
    assert claims_params["param_1"] == 1000  # .limit(20000) cut to the cap (follow-up 1j)
    org_params = next(p for _, x, p in log if x == s[-1])
    assert sorted(v for k, v in org_params.items() if k.startswith("id_")) == sorted([ORG1, ORG2])


def test_board_without_org_ids_skips_the_org_read(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/board").json()["orgs"] == []
    assert "organizations" not in [table_of(s) for s in sqls(log)]


# --- writes ----------------------------------------------------------------------------------

def test_add_note_only_the_keys_sent(dbfake):
    log, _, leases = dbfake
    body = {"seller_id": REP, "subject_label": "Acme", "subject_type": "contact", "body": "hi",
            "callback_priority": False, "callback_at": None, "created_by": None}
    assert client().post(f"{P}/notes", json=body).json() == {"ok": True}
    assert leases == [AUTH_WRITE]
    ((_, sql, params),) = log
    assert sql.startswith("INSERT INTO public.exp_sales_notes (")
    assert set(params) == set(body)
    assert "RETURNING" not in sql
    assert client().post(f"{P}/notes", json={"id": RID}).status_code == 422


def test_referral_request_callback_from_the_server_clock(dbfake):
    log, _, _ = dbfake
    r = client().post(f"{P}/referral-requests", json={"seller_id": REP, "subject_label": "Acme",
                                                       "body": "Referral requested", "created_by": None})
    assert r.json() == {"ok": True}
    ((_, sql, params),) = log
    assert "INSERT INTO public.exp_sales_notes" in sql
    vals = list(params.values())
    assert "referral_request" in vals and True in vals and FIXED + dt.timedelta(days=2) in vals
    assert client().post(f"{P}/referral-requests", json={"callback_at": "2020-01-01"}).status_code == 422


def test_set_callback_priority(dbfake):
    log, _, leases = dbfake
    assert client().patch(f"{P}/notes/{RID}", json={"callback_priority": True}).json() == {"ok": True}
    ((_, sql, params),) = log
    assert sql.startswith("UPDATE public.exp_sales_notes SET callback_priority=")
    assert "WHERE public.exp_sales_notes.id = " in sql and RID in params.values()
    assert leases == [AUTH_WRITE]
