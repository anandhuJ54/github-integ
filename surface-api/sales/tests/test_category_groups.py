"""sales category-groups endpoints (no live DB/auth): every read as compiled SQL with its
tolerance (the hydration counts included), and the two member writes compiled only."""
from __future__ import annotations

import uuid
from decimal import Decimal

import psycopg
import pytest
from surfaces.sales.routers.category_groups_data import router

from sales.tests.test_contracts import (
    AUTH_READ,
    AUTH_WRITE,
    RID,
    install_fake_db,
    make_client,
    sqls,
)

P = "/sales/category-groups"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


def params(log):
    return [p for _, s, p in log if "savepoint" not in s]


def boom():
    return psycopg.errors.InsufficientPrivilege("permission denied for table x")


@pytest.mark.parametrize("method,path", [
    ("get", ""), ("get", "/admin"), ("get", "/members"), ("get", "/quotas"), ("get", "/metrics"),
    ("get", "/search?term=ba"), ("delete", f"/members/{RID}"), ("get", "/g/scorecard"),
    ("get", "/g/hydration"), ("post", "/g/members"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method == "post" else {}
    assert getattr(make_client(router, None), method)(P + path, **kw).status_code == 403


def test_groups_and_admin_groups_by_label(dbfake):
    log, _, leases = dbfake
    client().get(P)
    client().get(f"{P}/admin")
    a, b = sqls(log)
    assert a.startswith("SELECT public.exp_category_groups.id") and \
        "ORDER BY public.exp_category_groups.label ASC" in a
    assert b.startswith("SELECT public.exp_category_groups.group_key, "
                        "public.exp_category_groups.label, public.exp_category_groups.is_catchall \n")
    assert "ORDER BY public.exp_category_groups.label ASC" in b
    assert leases == [AUTH_READ, AUTH_READ]


def test_members_then_names_tolerant(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: (
        [{"id": uuid.UUID(RID), "group_key": "bakeries", "gcid": "gcid:bakery"}]
        if "exp_category_group_members" in s else boom())
    assert client().get(f"{P}/members?group_key=bakeries").json() == {
        "members": [{"id": RID, "group_key": "bakeries", "gcid": "gcid:bakery"}], "cats": []}
    m = sqls(log)[0]
    assert "WHERE public.exp_category_group_members.group_key = %(group_key_1)s::VARCHAR" in m
    assert "ORDER BY public.exp_category_group_members.gcid ASC" in m
    log.clear()
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/members").json() == {"members": [], "cats": []}
    assert len(sqls(log)) == 1 and "WHERE" not in sqls(log)[0]
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/members").status_code == 403


def test_quotas_and_metrics_newest_first_filter_when_given(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"target": Decimal("100.00")}]
    assert client().get(f"{P}/quotas?group_key=g").json() == [{"target": 100}]
    client().get(f"{P}/metrics")
    q, m = sqls(log)
    assert q.startswith("SELECT public.exp_sales_quotas.id, public.exp_sales_quotas.rep_id, "
                        "public.exp_sales_quotas.group_key, public.exp_sales_quotas.period_type, ")
    assert "WHERE public.exp_sales_quotas.group_key" in q
    assert "ORDER BY public.exp_sales_quotas.period_start DESC" in q
    assert "WHERE" not in m and "ORDER BY public.exp_sales_rep_metrics.period_start DESC" in m


def test_search_name_or_gcid_limit_25_throws(dbfake):
    log, state, _ = dbfake
    client().get(f"{P}/search?term=bak")
    s, = sqls(log)
    assert ("WHERE public.gbp_categories.display_name ILIKE %(display_name_1)s::VARCHAR "
            "OR public.gbp_categories.gcid ILIKE %(gcid_1)s::VARCHAR") in s
    assert params(log)[0] == {"display_name_1": "%bak%", "gcid_1": "%bak%", "param_1": 25}
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/search?term=bak").status_code == 403


def test_scorecard_reads_reps_and_pipeline_tolerant(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: boom() if "exp_sales_pipeline" in s else [{"x": 1}]
    out = client().get(f"{P}/real_estate/scorecard").json()
    assert out == {"quotas": [{"x": 1}], "metrics": [{"x": 1}], "territories": [{"x": 1}],
                   "reps": [{"x": 1}], "pipeline": []}
    ss = sqls(log)
    t = next(s for s in ss if "FROM public.exp_territories" in s)
    assert "WHERE public.exp_territories.group_key" in t
    pipe = next(s for s in ss if "exp_sales_pipeline" in s)
    assert pipe.startswith("SELECT public.exp_sales_pipeline.owner, public.exp_sales_pipeline.stage, "
                           "public.exp_sales_pipeline.value, public.exp_sales_pipeline.is_demo \n")
    assert "ORDER BY" not in pipe
    state["answer"] = lambda s, p: boom() if "exp_sales_rep_metrics" in s else []
    assert client().get(f"{P}/real_estate/scorecard").status_code == 403


def test_hydration_counts_only_with_members(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/g/hydration").json() == {"members": [], "total": None, "deep": None}
    assert len(sqls(log)) == 1
    log.clear()

    def answer(s, p):
        if "exp_category_group_members" in s:
            return [{"gcid": "gcid:a"}, {"gcid": "gcid:b"}]
        if "->>" in s:
            return boom()  # ignored: count null
        return [{"count": 147}]
    state["answer"] = answer
    assert client().get(f"{P}/g/hydration").json() == {
        "members": [{"gcid": "gcid:a"}, {"gcid": "gcid:b"}], "total": 147, "deep": None}
    _, total, deep = sqls(log)[:3]
    assert total.startswith("SELECT count(*) AS count \nFROM public.exp_etl_staging \n"
                            "WHERE public.exp_etl_staging.gcid IN (")
    assert "(public.exp_etl_staging.payload ->> %(payload_1)s::TEXT) = %(param_1)s::VARCHAR" in deep


def test_member_writes(dbfake):
    log, _, leases = dbfake
    assert client().post(f"{P}/bakeries/members", json={"gcid": "gcid:bakery"}).json() == {"ok": True}
    client().delete(f"{P}/members/{RID}")
    (_, a, ap), (_, b, _) = log
    assert a == ("INSERT INTO public.exp_category_group_members (group_key, gcid) VALUES "
                 "(%(group_key)s::VARCHAR, %(gcid)s::VARCHAR)")
    assert ap == {"group_key": "bakeries", "gcid": "gcid:bakery"}
    assert b == ("DELETE FROM public.exp_category_group_members WHERE "
                 "public.exp_category_group_members.id = %(id_1)s::UUID")
    assert leases == [AUTH_WRITE, AUTH_WRITE]
    assert client().post(f"{P}/bakeries/members", json={"gcid": "x", "id": RID}).status_code == 422
