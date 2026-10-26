"""sales teams endpoints (no live DB/auth): the SQL each one sends, the PostgREST-shaped answers,
and the writes as the page sent them (quota targets as Decimal, never rounded). No write reaches
a database here — the territory move included."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from sales.tests import test_core as ct
from sales.tests.test_cpq import RID, RID2, values, writes
from surfaces.sales.queries import teams as q
from surfaces.sales.routers.teams_data import router

P = "/sales/teams"
CLAIMS, select_list, selects = ct.CLAIMS, ct.select_list, ct.selects
dbfake = ct.dbfake
R3 = "33333333-3333-4333-8333-333333333333"


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def denied(table: str) -> psycopg.Error:
    return psycopg.errors.InsufficientPrivilege(f"permission denied for table {table}")


ENDPOINTS = [
    ("get", f"{P}/reps"), ("get", f"{P}/rep-names"), ("get", f"{P}/territories"),
    ("get", f"{P}/territories/all"), ("get", f"{P}/territories/{RID}"),
    ("get", f"{P}/territories/{RID}/counts"), ("post", f"{P}/brands"),
    ("get", f"{P}/quotas?group_key=g"), ("get", f"{P}/quotas/lookup?rep_id={RID}&group_key=g"),
    ("get", f"{P}/organizations/{RID}/offices"), ("patch", f"{P}/territories/{RID}"),
    ("patch", f"{P}/brand-links/{RID}"), ("patch", f"{P}/organizations/{RID}/territory"),
    ("patch", f"{P}/organizations/{RID}/offices/territory"),
    ("patch", f"{P}/professionals/territory"), ("patch", f"{P}/quotas/{RID}"),
    ("post", f"{P}/quotas"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS)
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


# --- reads -----------------------------------------------------------------------------------

def test_reps_by_name_capped(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "name": "A"}]
    assert client().get(f"{P}/reps").json() == [{"id": RID, "name": "A"}]
    (w, sql, params), = log
    assert w is False and leases == [False]
    assert sql.startswith(f"SELECT {select_list('exp_sales_reps', q.REP_COLS)} \n"
                          "FROM public.exp_sales_reps ORDER BY public.exp_sales_reps.name ASC")
    assert "WHERE" not in sql and "NULLS" not in sql
    assert list(params.values()) == [1000]


def test_rep_names_unordered_and_error_reaches_the_page(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/rep-names").json() == []
    (_, sql, params), = log
    assert sql.startswith("SELECT public.exp_sales_reps.id, public.exp_sales_reps.name \n"
                          "FROM public.exp_sales_reps")
    assert "ORDER BY" not in sql and "WHERE" not in sql and list(params.values()) == [1000]
    state["answer"] = lambda s, p: denied("exp_sales_reps")
    assert client().get(f"{P}/rep-names").status_code == 403


@pytest.mark.parametrize("params,where", [({}, None), ({"group_key": "re"}, "re"),
                                          ({"group_key": ""}, "")])
def test_territories_star_by_tier_seq_optional_group(dbfake, params, where):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "seq": 1}]
    assert client().get(f"{P}/territories", params=params).json() == [{"id": RID, "seq": 1}]
    (_, sql, ps), = log
    assert sql.startswith("SELECT public.exp_territories.id, public.exp_territories.label, ")
    assert "public.exp_territories.region \nFROM public.exp_territories" in sql
    assert "ORDER BY public.exp_territories.tier ASC, public.exp_territories.seq ASC" in sql
    if where is None:
        assert "WHERE" not in sql
    else:
        assert "WHERE public.exp_territories.group_key = %(group_key_1)s" in sql
        assert ps["group_key_1"] == where
    assert ps["param_1"] == 1000


def test_territories_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: denied("exp_territories")
    assert client().get(f"{P}/territories").status_code == 403


def test_all_territories_unordered(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/territories/all").json() == []
    (_, sql, ps), = log
    assert "FROM public.exp_territories" in sql and "ORDER BY" not in sql and "WHERE" not in sql
    assert list(ps.values()) == [1000]


def test_territory_by_id_null_row_or_406(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/territories/{RID}").json() is None
    (_, sql, ps), = log
    assert "WHERE public.exp_territories.id = %(id_1)s::UUID" in sql
    assert ps == {"id_1": RID, "param_1": 2}
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/territories/{RID}").json() == {"id": RID}
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}, {"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/territories/{RID}").status_code == 406


def test_detail_counts_professionals_then_offices(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 7 if "professionals" in s else 3}]
    assert client().get(f"{P}/territories/{RID}/counts").json() == {"profiles": 7, "offices": 3}
    (_, pr, pp), (_, of, op) = selects(log)
    assert pr.startswith("SELECT count(*) AS n \nFROM public.professionals \n"
                         "WHERE public.professionals.territory_id = %(territory_id_1)s::UUID")
    assert of.startswith("SELECT count(*) AS n \nFROM public.organizations \n"
                         "WHERE public.organizations.territory_id = %(territory_id_1)s::UUID AND "
                         "public.organizations.entity_type = %(entity_type_1)s")
    assert op["entity_type_1"] == "office" and pp["territory_id_1"] == RID


def test_recount_counts_brands_offices_professionals_failed_is_null(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: denied("organizations") if "organizations" in s else [{"n": 2}]
    r = client().get(f"{P}/territories/{RID}/counts", params={"brands": "true"})
    assert r.json() == {"brands": 2, "offices": None, "profiles": 2}
    tables = [s.split("FROM public.")[1].split(" ")[0] for _, s, _ in selects(log)][-3:]  # the one-at-a-time retry
    assert tables == ["exp_territory_brand", "organizations", "professionals"]


def test_brands_no_ids_no_statement(dbfake):
    log, _, _ = dbfake
    empty = {"links": [], "orgs": [], "offices": [], "profiles": []}
    assert client().post(f"{P}/brands", json={"territory_ids": []}).json() == empty
    assert log == []


def test_brands_links_then_orgs_then_counts(dbfake):
    log, state, _ = dbfake
    org_a, org_b = RID2, R3
    link_rows = [
        {"id": uuid.UUID(RID), "territory_id": uuid.UUID(RID), "lane": "ENT", "org_id": uuid.UUID(org_a)},
        {"id": uuid.UUID(RID2), "territory_id": uuid.UUID(RID), "lane": "MM", "org_id": uuid.UUID(org_b)},
        {"id": uuid.UUID(R3), "territory_id": uuid.UUID(RID2), "lane": "SMB", "org_id": uuid.UUID(org_a)},
    ]

    def answer(s, p):
        if "FROM public.exp_territory_brand" in s:
            return link_rows
        if s.startswith("SELECT public.organizations.id"):
            return [{"id": uuid.UUID(org_a), "name": "A", "slug": None, "account_tier": None,
                     "is_demo": True, "logo_url": None}]
        if "parent_org_id" in s:
            return [{"n": 11 if p["parent_org_id_1"] == org_a else 22}]
        return [{"n": 5 if p["territory_id_1"] == RID else 6}]
    state["answer"] = answer
    out = client().post(f"{P}/brands", json={"territory_ids": [RID, RID2]}).json()
    assert [r["id"] for r in out["links"]] == [RID, RID2, R3]
    assert out["orgs"][0]["id"] == org_a
    assert out["offices"] == [11, 22]  # distinct orgs, in link order
    assert out["profiles"] == [5, 5, 6]  # one per link
    sels = selects(log)
    lk, lp = sels[0][1], sels[0][2]
    assert lk.startswith(f"SELECT {select_list('exp_territory_brand', q.LINK_COLS)} \n")
    assert "public.exp_territory_brand.territory_id IN (" in lk
    assert "public.exp_territory_brand.success_handoff_at IS NULL" in lk
    assert "ORDER BY" not in lk
    assert [v for k, v in lp.items() if k.startswith("territory_id")] == [RID, RID2]
    og, op = sels[1][1], sels[1][2]
    assert og.startswith(f"SELECT {select_list('organizations', q.ORG_COLS)} \n")
    assert [v for k, v in op.items() if k.startswith("id_")] == [org_a, org_b]
    assert len(sels) == 2 + 2 + 3


def test_brands_links_error_thrown_others_ignored(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: denied("exp_territory_brand")
    assert client().post(f"{P}/brands", json={"territory_ids": [RID]}).status_code == 403

    def answer(s, p):
        if "FROM public.exp_territory_brand" in s:
            return [{"id": uuid.UUID(RID), "territory_id": uuid.UUID(RID), "lane": None,
                     "org_id": uuid.UUID(RID2)}]
        return denied("organizations") if "organizations" in s else [{"n": 4}]
    state["answer"] = answer
    assert client().post(f"{P}/brands", json={"territory_ids": [RID]}).json() == {
        "links": [{"id": RID, "territory_id": RID, "lane": None, "org_id": RID2}],
        "orgs": [], "offices": [None], "profiles": [4]}


def test_brands_refuses_other_keys(dbfake):
    assert client().post(f"{P}/brands", json={"ids": [RID]}).status_code == 422


def test_group_quotas_current_period_by_server_clock_errors_ignored(dbfake, monkeypatch):
    log, state, _ = dbfake
    monkeypatch.setattr(q, "now", lambda: dt.datetime(2026, 10, 31, 23, 59, tzinfo=dt.UTC))
    state["answer"] = lambda s, p: [{"rep_id": uuid.UUID(RID), "target": Decimal("1500.50"),
                                     "group_key": "re", "period_start": dt.date(2026, 10, 1)}]
    assert client().get(f"{P}/quotas", params={"group_key": "re"}).json() == [
        {"rep_id": RID, "target": 1500.5, "group_key": "re", "period_start": "2026-10-01"}]
    (_, sql, ps), = selects(log)
    assert sql.startswith(f"SELECT {select_list('exp_sales_quotas', q.QUOTA_COLS)} \n")
    assert "public.exp_sales_quotas.period_start = %(param_1)s::DATE" in sql
    assert ps["group_key_1"] == "re" and ps["param_1"] == "2026-10-01"
    assert "ORDER BY" not in sql
    state["answer"] = lambda s, p: denied("exp_sales_quotas")
    assert client().get(f"{P}/quotas", params={"group_key": "re"}).json() == []


def test_quota_lookup_one_none_two_or_error(dbfake, monkeypatch):
    log, state, _ = dbfake
    monkeypatch.setattr(q, "now", lambda: dt.datetime(2027, 1, 15, tzinfo=dt.UTC))
    params = {"rep_id": RID, "group_key": "re"}
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID2)}]
    assert client().get(f"{P}/quotas/lookup", params=params).json() == {"id": RID2}
    (_, sql, ps), = selects(log)
    assert sql.startswith("SELECT public.exp_sales_quotas.id \nFROM public.exp_sales_quotas \n"
                          "WHERE public.exp_sales_quotas.rep_id = %(rep_id_1)s::UUID AND "
                          "public.exp_sales_quotas.group_key = %(group_key_1)s")
    assert ps["param_1"] == "2027-01-01" and ps["param_2"] == 2
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}, {"id": uuid.UUID(RID2)}]
    assert client().get(f"{P}/quotas/lookup", params=params).json() is None
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/quotas/lookup", params=params).json() is None
    state["answer"] = lambda s, p: denied("exp_sales_quotas")
    assert client().get(f"{P}/quotas/lookup", params=params).json() is None


def test_office_ids_limit_50000_cut_to_1000_errors_ignored(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID2)}]
    assert client().get(f"{P}/organizations/{RID}/offices").json() == [{"id": RID2}]
    (_, sql, ps), = selects(log)
    assert sql.startswith("SELECT public.organizations.id \nFROM public.organizations \n"
                          "WHERE public.organizations.parent_org_id = %(parent_org_id_1)s::UUID")
    assert "ORDER BY" not in sql
    assert ps["param_1"] == 1000  # the browser's limit(50000), cut as PostgREST did (1j)
    state["answer"] = lambda s, p: denied("organizations")
    assert client().get(f"{P}/organizations/{RID}/offices").json() == []


# --- writes ----------------------------------------------------------------------------------

def test_territory_patch_only_sent_keys(dbfake):
    log, _, leases = dbfake
    r = client().patch(f"{P}/territories/{RID}", json={"seller_id": RID2, "status": "assigned"})
    assert r.json() == {"ok": True} and leases == [True]
    (_, sql, ps), = writes(log)
    assert sql.startswith("UPDATE public.exp_territories SET seller_id=%(seller_id)s::UUID, "
                          "status=%(status)s")
    assert sql.endswith("WHERE public.exp_territories.id = %(id_1)s::UUID")
    assert values(ps) == {"seller_id": RID2, "status": "assigned", "id_1": RID}

    client().patch(f"{P}/territories/{RID}", json={"seller_id": None, "status": "unassigned"})
    assert values(writes(log)[1][2])["seller_id"] is None

    client().patch(f"{P}/territories/{RID}",
                   json={"brand_count": 1, "office_count": 0, "agent_count": 12})
    assert values(writes(log)[2][2]) == {"brand_count": 1, "office_count": 0, "agent_count": 12,
                                         "id_1": RID}


def test_territory_patch_refuses_other_columns_and_fractions(dbfake):
    log, _, _ = dbfake
    assert client().patch(f"{P}/territories/{RID}", json={"label": "x"}).status_code == 422
    assert client().patch(f"{P}/territories/{RID}", json={"agent_count": 1.5}).status_code == 422
    assert log == []


def test_territory_patch_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: denied("exp_territories")
    assert client().patch(f"{P}/territories/{RID}", json={"status": "x"}).status_code == 403


@pytest.mark.parametrize("path,table,where", [
    (f"brand-links/{RID}", "exp_territory_brand", "public.exp_territory_brand.id = %(id_1)s::UUID"),
    (f"organizations/{RID}/territory", "organizations", "public.organizations.id = %(id_1)s::UUID"),
    (f"organizations/{RID}/offices/territory", "organizations",
     "public.organizations.parent_org_id = %(parent_org_id_1)s::UUID"),
])
def test_move_steps_one_statement_each(dbfake, path, table, where):
    log, _, leases = dbfake
    assert client().patch(f"{P}/{path}", json={"territory_id": RID2}).json() == {"ok": True}
    (_, sql, ps), = log
    assert leases == [True]
    assert sql == f"UPDATE public.{table} SET territory_id=%(territory_id)s::UUID WHERE {where}"
    assert ps["territory_id"] == RID2 and RID in ps.values()


def test_move_professionals_chunk(dbfake):
    log, _, _ = dbfake
    body = {"org_ids": [RID, RID2], "territory_id": R3}
    assert client().patch(f"{P}/professionals/territory", json=body).json() == {"ok": True}
    (_, sql, ps), = log
    assert sql.startswith("UPDATE public.professionals SET territory_id=%(territory_id)s::UUID "
                          "WHERE public.professionals.primary_org_id IN (")
    assert [v for k, v in ps.items() if k.startswith("primary_org_id")] == [RID, RID2]
    assert ps["territory_id"] == R3


def test_move_professionals_refuses_more_than_500_and_other_keys(dbfake):
    log, _, _ = dbfake
    big = {"org_ids": [RID] * 501, "territory_id": R3}
    assert client().patch(f"{P}/professionals/territory", json=big).status_code == 422
    assert client().patch(f"{P}/professionals/territory",
                          json={"org_ids": [RID], "territory_id": R3, "x": 1}).status_code == 422
    assert log == []


def test_quota_target_decimal_never_float(dbfake):
    log, _, _ = dbfake
    client().patch(f"{P}/quotas/{RID}", content='{"target": 12345.675}',
                   headers={"content-type": "application/json"})
    (_, sql, ps), = log
    assert sql == ("UPDATE public.exp_sales_quotas SET target=%(target)s "
                   "WHERE public.exp_sales_quotas.id = %(id_1)s::UUID")
    assert ps["target"] == Decimal("12345.675") and isinstance(ps["target"], Decimal)


def test_month_quota_insert_constants_and_server_period(dbfake, monkeypatch):
    log, _, _ = dbfake
    monkeypatch.setattr(q, "now", lambda: dt.datetime(2026, 12, 1, 0, 0, 1, tzinfo=dt.UTC))
    body = {"rep_id": RID, "group_key": "re", "target": 2500}
    assert client().post(f"{P}/quotas", json=body).json() == {"ok": True}
    (_, sql, ps), = log
    assert sql.startswith("INSERT INTO public.exp_sales_quotas ") and "RETURNING" not in sql
    assert values(ps) == {"rep_id": RID, "group_key": "re", "target": Decimal(2500),
                          "period_type": "month", "period_start": dt.date(2026, 12, 1),
                          "actual": 0}


def test_month_quota_refuses_client_constants(dbfake):
    log, _, _ = dbfake
    for extra in ({"period_type": "quarter"}, {"period_start": "2026-01-01"}, {"actual": 5}):
        body = {"rep_id": RID, "group_key": "re", "target": 1, **extra}
        assert client().post(f"{P}/quotas", json=body).status_code == 422
    assert log == []


def test_current_period_start_is_the_utc_month():
    assert q.current_period_start()[-3:] == "-01"
