"""sales seller-setup endpoints (no live DB/auth): the SQL each one sends, the PostgREST-shaped
answers, and the writes as the page sent them (quota and attribution values as Decimal, never
rounded). No write reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core.auth import current_user
from sales.queries import core_test as ct
from sales.queries import seller_setup as q
from sales.queries.cpq_test import RID, RID2, values, writes
from sales.routers.seller_setup_data import router

P = "/sales/seller-setup"
CLAIMS, select_list, selects = ct.CLAIMS, ct.select_list, ct.selects
dbfake = ct.dbfake
QUARTERS = ["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def denied(table: str) -> psycopg.Error:
    return psycopg.errors.InsufficientPrivilege(f"permission denied for table {table}")


def table_of(sql: str) -> str:
    return sql.split("FROM public.")[1].split(" ")[0]


ENDPOINTS = [
    ("get", f"{P}?year=2026"), ("get", f"{P}/reps/{RID}/verticals"),
    ("get", f"{P}/reps/{RID}/territories"), ("get", f"{P}/reps/{RID}/quota-ids?year=2026"),
    ("get", f"{P}/brand-links"), ("get", f"{P}/slots?group_key=g&tier=SMB"),
    ("post", f"{P}/reps"), ("patch", f"{P}/reps/{RID}"), ("post", f"{P}/reps/{RID}/verticals"),
    ("delete", f"{P}/verticals/{RID}"), ("patch", f"{P}/quotas/{RID}"), ("post", f"{P}/quotas"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS)
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


def test_quarter_starts():
    assert q.quarter_starts(2026) == QUARTERS


# --- loadSellerSetup -------------------------------------------------------------------------

def test_setup_without_rep_reps_territories_links_no_orgs(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: []
    assert client().get(P, params={"year": 2026}).json() == {
        "reps": [], "territories": [], "rep": None, "verticals": [], "quotas": [],
        "links": [], "orgs": []}
    assert leases == [False]
    sels = selects(log)
    assert [table_of(s) for _, s, _ in sels] == ["exp_sales_reps", "exp_territories",
                                                 "exp_territory_brand"]
    (_, r, rp), (_, t, tp), (_, lk, _lp) = sels
    assert r.startswith(f"SELECT {select_list('exp_sales_reps', q.REP_LIST_COLS)} \n")
    assert r.endswith("ORDER BY public.exp_sales_reps.name ASC \n LIMIT %(param_1)s::INTEGER")
    assert t.startswith(f"SELECT {select_list('exp_territories', q.TERRITORY_COLS)} \n")
    assert "ORDER BY public.exp_territories.tier ASC, public.exp_territories.seq ASC" in t
    assert lk.startswith(f"SELECT {select_list('exp_territory_brand', q.LINK_COLS)} \n")
    assert "WHERE public.exp_territory_brand.success_handoff_at IS NULL" in lk
    assert "ORDER BY" not in lk
    assert list(rp.values()) == [1000] and list(tp.values()) == [1000]


def test_setup_with_rep_reads_rep_verticals_quarters_then_links_and_orgs(dbfake):
    log, state, _ = dbfake

    def answer(s, p):
        t = table_of(s)
        if t == "exp_sales_reps" and "WHERE" in s:
            return [{"id": uuid.UUID(RID), "attribution_target": Decimal("0.25"),
                     "hire_date": dt.date(2025, 3, 4)}]
        if t == "exp_sales_quotas":
            return [{"id": uuid.UUID(RID2), "period_start": dt.date(2026, 4, 1),
                     "target": Decimal("90000.00"), "actual": Decimal("12.5")}]
        if t == "exp_territory_brand":
            return [{"id": uuid.UUID(RID), "territory_id": uuid.UUID(RID), "org_id": uuid.UUID(RID2),
                     "lane": None},
                    {"id": uuid.UUID(RID2), "territory_id": uuid.UUID(RID), "org_id": uuid.UUID(RID2),
                     "lane": "MM"}]
        if t == "organizations":
            return [{"id": uuid.UUID(RID2), "name": "Brand", "logo_url": None}]
        return []
    state["answer"] = answer
    out = client().get(P, params={"year": 2026, "rep_id": RID}).json()
    assert out["rep"] == {"id": RID, "attribution_target": 0.25, "hire_date": "2025-03-04"}
    assert out["quotas"] == [{"id": RID2, "period_start": "2026-04-01", "target": 90000,
                              "actual": 12.5}]
    assert len(out["links"]) == 2 and out["orgs"] == [{"id": RID2, "name": "Brand", "logo_url": None}]
    sels = selects(log)
    assert [table_of(s) for _, s, _ in sels] == [
        "exp_sales_reps", "exp_territories", "exp_sales_reps", "exp_sales_rep_verticals",
        "exp_sales_quotas", "exp_territory_brand", "organizations"]
    rep_sql, rep_p = sels[2][1], sels[2][2]
    assert rep_sql.startswith(f"SELECT {select_list('exp_sales_reps', q.REP_COLS)} \n")
    assert rep_p == {"id_1": RID, "param_1": 2}
    qs, qp = sels[4][1], sels[4][2]
    assert "public.exp_sales_quotas.period_type = %(period_type_1)s" in qs
    assert "public.exp_sales_quotas.period_start IN (" in qs and "::DATE" in qs
    assert qp["period_type_1"] == "quarter"
    assert [v for k, v in qp.items() if k.startswith("param_")][:4] == QUARTERS
    og, op = sels[6][1], sels[6][2]
    assert og.startswith(f"SELECT {select_list('organizations', q.ORG_COLS)} \n")
    assert [v for k, v in op.items() if k.startswith("id_")] == [RID2]  # distinct org ids


def test_setup_every_error_ignored_and_two_reps_is_null(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}, {"id": uuid.UUID(RID2)}] \
        if table_of(s) == "exp_sales_reps" else denied(table_of(s))
    out = client().get(P, params={"year": 2026, "rep_id": RID}).json()
    assert out["rep"] is None and out["territories"] == [] and out["links"] == []
    assert len(out["reps"]) == 2 and out["verticals"] == [] and out["quotas"] == []


# --- reads during the save -------------------------------------------------------------------

@pytest.mark.parametrize("path,table,sel,where", [
    (f"reps/{RID}/verticals", "exp_sales_rep_verticals", q.VERTICAL_COLS,
     "public.exp_sales_rep_verticals.rep_id = %(rep_id_1)s::UUID"),
    (f"reps/{RID}/territories", "exp_territories", "id",
     "public.exp_territories.seller_id = %(seller_id_1)s::UUID"),
    ("brand-links", "exp_territory_brand", q.LINK_COLS, None),
    ("slots?group_key=re&tier=SMB", "exp_territories", q.SLOT_COLS,
     ("public.exp_territories.group_key = %(group_key_1)s::VARCHAR AND "
      "public.exp_territories.tier = %(tier_1)s::VARCHAR")),
    (f"reps/{RID}/quota-ids?year=2026", "exp_sales_quotas", "id,period_start",
     ("public.exp_sales_quotas.rep_id = %(rep_id_1)s::UUID AND "
      "public.exp_sales_quotas.period_type = %(period_type_1)s::VARCHAR AND "
      "public.exp_sales_quotas.period_start IN (")),
])
def test_save_reads_unordered_and_tolerant(dbfake, path, table, sel, where):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/{path}").json() == [{"id": RID}]
    (_, sql, ps), = selects(log)
    assert leases == [False]
    assert sql.startswith(f"SELECT {select_list(table, sel)} \nFROM public.{table}")
    assert "ORDER BY" not in sql
    if where:
        assert f"WHERE {where}" in sql
    else:
        assert "WHERE" not in sql
    assert list(ps.values())[-1] == 1000
    state["answer"] = lambda s, p: denied(table)
    assert client().get(f"{P}/{path}").json() == []


# --- writes ----------------------------------------------------------------------------------

REP_BODY = {
    "name": "Pat", "email": None, "phone": None, "title": None, "photo_url": None,
    "hire_date": "2026-02-03", "on_duty": True, "backup_rep_id": None, "role": "SMB",
    "group_key": "re", "team_name": None, "attribution_target": 0.15, "sdrcloud_url": None,
}


def test_rep_insert_returns_id_decimal_and_date(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().post(f"{P}/reps", json=REP_BODY).json() == {"id": RID}
    (_, sql, ps), = writes(log)
    assert leases == [True]
    assert sql.startswith("INSERT INTO public.exp_sales_reps (")
    assert sql.endswith("RETURNING public.exp_sales_reps.id")
    v = values(ps)
    assert v["attribution_target"] == Decimal("0.15") and isinstance(v["attribution_target"], Decimal)
    assert v["hire_date"] == dt.date(2026, 2, 3)
    assert set(v) == set(REP_BODY)


def test_rep_insert_406_without_a_row_and_refuses_other_columns(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: []
    assert client().post(f"{P}/reps", json=REP_BODY).status_code == 406
    assert client().post(f"{P}/reps", json={**REP_BODY, "is_demo": True}).status_code == 422


def test_rep_update(dbfake):
    log, _, _ = dbfake
    assert client().patch(f"{P}/reps/{RID}", json=REP_BODY).json() == {"ok": True}
    (_, sql, ps), = writes(log)
    assert sql.startswith("UPDATE public.exp_sales_reps SET name=%(name)s")
    assert sql.endswith("WHERE public.exp_sales_reps.id = %(id_1)s::UUID")
    assert values(ps)["id_1"] == RID


def test_rep_update_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: denied("exp_sales_reps")
    assert client().patch(f"{P}/reps/{RID}", json=REP_BODY).status_code == 403


def test_verticals_multi_row_insert_and_delete(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/reps/{RID}/verticals", json={"group_keys": ["a", "b"]})
    client().delete(f"{P}/verticals/{RID2}")
    (_, ins, ip), (_, dl, dp) = writes(log)
    assert ins == ("INSERT INTO public.exp_sales_rep_verticals (rep_id, group_key) VALUES "
                   "(%(rep_id_m0)s::UUID, %(group_key_m0)s::VARCHAR), "
                   "(%(rep_id_m1)s::UUID, %(group_key_m1)s::VARCHAR)")
    assert values(ip) == {"rep_id_m0": RID, "group_key_m0": "a", "rep_id_m1": RID,
                          "group_key_m1": "b"}
    assert dl == ("DELETE FROM public.exp_sales_rep_verticals "
                  "WHERE public.exp_sales_rep_verticals.id = %(id_1)s::UUID")
    assert dp == {"id_1": RID2}


def test_quota_update_and_quarter_insert_as_decimal(dbfake):
    log, _, _ = dbfake
    client().patch(f"{P}/quotas/{RID}", content='{"target": 30000.10, "actual": 0}',
                   headers={"content-type": "application/json"})
    body = {"rep_id": RID, "group_key": "re", "period_start": "2026-07-01", "target": 1.005,
            "actual": 2}
    assert client().post(f"{P}/quotas", json=body).json() == {"ok": True}
    (_, up, upp), (_, ins, ip) = writes(log)
    assert up == ("UPDATE public.exp_sales_quotas SET target=%(target)s, actual=%(actual)s "
                  "WHERE public.exp_sales_quotas.id = %(id_1)s::UUID")
    assert upp["target"] == Decimal("30000.10") and isinstance(upp["target"], Decimal)
    assert ins.startswith("INSERT INTO public.exp_sales_quotas ") and "RETURNING" not in ins
    assert values(ip) == {"rep_id": RID, "group_key": "re", "period_start": dt.date(2026, 7, 1),
                          "target": Decimal("1.005"), "actual": Decimal(2),
                          "period_type": "quarter"}


def test_quarter_insert_refuses_period_type(dbfake):
    log, _, _ = dbfake
    body = {"rep_id": RID, "group_key": "re", "period_start": "2026-07-01", "target": 1,
            "actual": 0, "period_type": "month"}
    assert client().post(f"{P}/quotas", json=body).status_code == 422
    assert log == []
