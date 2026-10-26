"""sales core endpoints (no live DB/auth): the SQL each one sends, the PostgREST-shaped answers,
and the writes as the page sent them (money as Decimal, never rounded). No write reaches a
database here."""
from __future__ import annotations

import datetime as dt
import uuid
from contextlib import contextmanager
from decimal import Decimal

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from sales.tests.test_cpq import RID, RID2, UID, FakeConn, values, writes
from surfaces.sales.queries import core as q
from surfaces.sales.routers.core_data import router

CLAIMS = {"sub": UID, "role": "authenticated", "email": "seller@example.com"}
P = "/sales/core"


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    leases: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS
        leases.append(write)
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state, leases


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def selects(log):
    return [x for x in log if x[1].startswith("SELECT")]


def select_list(table: str, names: str) -> str:
    return ", ".join(f"public.{table}.{c}" for c in names.split(","))


# --- auth ------------------------------------------------------------------------------------

ENDPOINTS = [
    ("get", f"{P}/reps"), ("get", f"{P}/assignments"),
    ("get", f"{P}/activity?since=2026-10-01T00:00:00Z"), ("get", f"{P}/account-tiers"),
    ("get", f"{P}/account-tiers/inputs"), ("put", f"{P}/account-tiers"),
    ("post", f"{P}/organizations/names"), ("get", f"{P}/price-book"),
    ("patch", f"{P}/price-book/{RID}"), ("patch", f"{P}/products/nora/credit-config"),
    ("get", f"{P}/contracts"), ("post", f"{P}/contracts"), ("patch", f"{P}/contracts/{RID}"),
    ("post", f"{P}/line-items"), ("patch", f"{P}/line-items/{RID}"),
    ("delete", f"{P}/line-items/{RID}"), ("post", f"{P}/signatures"),
    ("post", f"{P}/signatures/{RID}/signed"), ("post", f"{P}/renewals"),
    ("patch", f"{P}/renewals/{RID}"), ("get", f"{P}/revenue?today=2026-10-24&in90=2027-01-22"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS)
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


# --- reads -----------------------------------------------------------------------------------

@pytest.mark.parametrize("path,table,names,order", [
    ("reps", "exp_sales_reps", q.REP_COLS,
     "public.exp_sales_reps.group_key ASC, public.exp_sales_reps.role ASC"),
    ("assignments", "exp_sales_assignments", q.ASSIGNMENT_COLS, None),
    ("account-tiers", "exp_account_tier", q.ACCOUNT_TIER_COLS,
     "public.exp_account_tier.agent_count DESC"),
])
def test_list_sql(dbfake, path, table, names, order):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/{path}").json() == [{"id": RID}]
    (write, sql, params), = log
    assert write is False and leases == [False]
    assert sql.startswith(f"SELECT {select_list(table, names)} \nFROM public.{table}")
    assert "WHERE" not in sql
    if order:
        assert f"ORDER BY {order}" in sql and "NULLS" not in sql
    else:
        assert "ORDER BY" not in sql
    assert list(params.values()) == [1000]  # the PostgREST cap


def test_activity_since_desc_and_the_5000_limit_cut_to_1000(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{
        "id": uuid.UUID(RID), "value": {"display_name": "A"},
        "occurred_at": dt.datetime(2026, 10, 2, 3, 4, 5, 120000, tzinfo=dt.UTC)}]
    r = client().get(f"{P}/activity", params={"since": "2026-09-24T10:11:12.345Z"})
    assert r.json() == [{"id": RID, "value": {"display_name": "A"},
                         "occurred_at": "2026-10-02T03:04:05.12+00:00"}]
    (_, sql, params), = log
    assert sql.startswith(f"SELECT {select_list('exp_activity_events', q.ACTIVITY_COLS)} ")
    assert ("WHERE public.exp_activity_events.occurred_at >= "
            "%(occurred_at_1)s::TIMESTAMP WITH TIME ZONE ") in sql
    assert sql.endswith("ORDER BY public.exp_activity_events.occurred_at DESC \n"
                        " LIMIT %(param_1)s::INTEGER")
    assert params["occurred_at_1"] == dt.datetime(2026, 9, 24, 10, 11, 12, 345000, tzinfo=dt.UTC)
    assert params["param_1"] == 1000
    assert client().get(f"{P}/activity").status_code == 422


def test_account_names_in_list(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "name": "Acme"}]
    assert client().post(f"{P}/organizations/names", json={"ids": [RID, RID2]}).json() == \
        [{"id": RID, "name": "Acme"}]
    (w, sql, params), = log
    assert w is False and leases == [False]
    assert sql.startswith("SELECT public.organizations.id, public.organizations.name \n"
                          "FROM public.organizations \nWHERE public.organizations.id IN (")
    assert [v for k, v in params.items() if k.startswith("id_")] == [RID, RID2]
    assert client().post(f"{P}/organizations/names", json={"ids": []}).json() == []
    assert len(log) == 1  # no ids: no statement (the browser returned {} before the call)


def test_tier_inputs_two_reads_cut_to_1000(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/account-tiers/inputs").json() == \
        {"orgs": [{"id": RID}], "pros": [{"id": RID}]}
    (_, o, op), (_, pr, pp) = selects(log)
    assert o.startswith("SELECT public.organizations.id, public.organizations.name, "
                        "public.organizations.parent_org_id \nFROM public.organizations")
    assert pr.startswith("SELECT public.professionals.id, public.professionals.primary_org_id \n"
                         "FROM public.professionals")
    assert "ORDER BY" not in o + pr
    assert list(op.values()) == [1000] and list(pp.values()) == [1000]  # limit(20000) → 1000


def test_price_book_two_reads(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: (
        [{"id": uuid.UUID(RID), "list_price": Decimal("79.00"), "cost_value": Decimal("0.35"),
          "discount_tiers": [{"min": 10, "pct": 5}]}]
        if "exp_price_book" in s else [{"product_key": "nora", "name": "NORA", "sort": 1}])
    assert client().get(f"{P}/price-book").json() == {
        "book": [{"id": RID, "list_price": 79, "cost_value": 0.35,
                  "discount_tiers": [{"min": 10, "pct": 5}]}],
        "products": [{"product_key": "nora", "name": "NORA", "sort": 1}]}
    (_, b, _), (_, pr, _) = selects(log)
    assert b.startswith(f"SELECT {select_list('exp_price_book', q.PRICE_BOOK_COLS)} \n")
    assert "ORDER BY" not in b
    assert pr.startswith("SELECT public.exp_products.product_key, public.exp_products.name, "
                         "public.exp_products.sort \nFROM public.exp_products")
    assert "ORDER BY public.exp_products.sort ASC" in pr


def test_price_book_errors_reach_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "permission denied for table exp_price_book") if "exp_price_book" in s else []
    assert client().get(f"{P}/price-book").status_code == 403


def test_contracts_bundle(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "mrr": Decimal("102.88")}] \
        if "FROM public.exp_contracts " in s else []
    assert client().get(f"{P}/contracts").json() == {
        "contracts": [{"id": RID, "mrr": 102.88}], "lineItems": [], "signatures": [],
        "renewals": []}
    (_, c, _), (_, li, _), (_, sg, _), (_, rn, _) = selects(log)
    assert c.startswith(f"SELECT {select_list('exp_contracts', q.CONTRACT_COLS)} \n")
    assert "ORDER BY public.exp_contracts.name ASC" in c
    assert li.startswith(f"SELECT {select_list('exp_contract_line_items', q.LINE_COLS)} \n")
    assert sg.startswith(f"SELECT {select_list('exp_contract_signatures', q.SIGNATURE_COLS)} \n")
    assert rn.startswith(f"SELECT {select_list('exp_contract_renewals', q.RENEWAL_COLS)} \n")
    assert "ORDER BY" not in li + sg + rn


def test_contracts_bundle_ignores_side_read_errors_but_not_the_contracts(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied") \
        if "exp_contract_signatures" in s else [{"id": RID}]
    out = client().get(f"{P}/contracts").json()
    assert out["signatures"] == [] and out["lineItems"] == [{"id": RID}]
    assert out["renewals"] == [{"id": RID}]
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied") \
        if "FROM public.exp_contracts " in s else []
    assert client().get(f"{P}/contracts").status_code == 403


def test_revenue(dbfake):
    log, state, _ = dbfake

    def answer(s, p):
        if "count(*)" in s:
            return [{"n": 2 if "exp_contracts" in s else 1}]
        return [{"mrr": Decimal("100.50")}, {"mrr": None}]

    state["answer"] = answer
    r = client().get(f"{P}/revenue", params={"today": "2026-10-24", "in90": "2027-01-22"})
    assert r.json() == {"active": [{"mrr": 100.5}, {"mrr": None}], "expiring": 2,
                        "pendingSignatures": 1}
    (_, a, ap), (_, e, ep), (_, s, sp) = selects(log)
    assert a.startswith("SELECT public.exp_contracts.mrr \nFROM public.exp_contracts \n"
                        "WHERE public.exp_contracts.status = %(status_1)s::VARCHAR")
    assert ap == {"status_1": "active", "param_1": 1000}
    assert e.startswith("SELECT count(*) AS n \nFROM public.exp_contracts \n"
                        "WHERE public.exp_contracts.status = %(status_1)s::VARCHAR AND "
                        "public.exp_contracts.end_date >= %(end_date_1)s::DATE AND "
                        "public.exp_contracts.end_date <= %(end_date_2)s::DATE")
    assert ep["end_date_1"] == dt.date(2026, 10, 24) and ep["end_date_2"] == dt.date(2027, 1, 22)
    assert s.startswith("SELECT count(*) AS n \nFROM public.exp_contract_signatures \n"
                        "WHERE public.exp_contract_signatures.status = %(status_1)s::VARCHAR")
    assert sp["status_1"] == "sent"


def test_revenue_counts_null_on_error_active_throws(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.QueryCanceled("statement timeout") \
        if "count(*)" in s else []
    r = client().get(f"{P}/revenue", params={"today": "2026-10-24", "in90": "2027-01-22"})
    assert r.json() == {"active": [], "expiring": None, "pendingSignatures": None}
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied") \
        if "count(*)" not in s else [{"n": 0}]
    assert client().get(f"{P}/revenue", params={"today": "2026-10-24",
                                                "in90": "2027-01-22"}).status_code == 403


# --- writes: price book + products -----------------------------------------------------------

def test_save_price_sent_keys_as_decimal(dbfake):
    log, _, leases = dbfake
    body = {"list_price": 79.99, "contract_price": 1234.5600000000002, "credit_cost_per_unit": None}
    assert client().patch(f"{P}/price-book/{RID}", json=body).json() == {"ok": True}
    assert leases == [True]
    (w, sql, params), = log
    assert w is True and sql.startswith("UPDATE public.exp_price_book SET ")
    assert sql.endswith("WHERE public.exp_price_book.id = %(id_1)s::UUID")
    assert params == {"list_price": Decimal("79.99"),
                      "contract_price": Decimal("1234.5600000000002"),
                      "credit_cost_per_unit": None, "id_1": RID}
    assert all(not isinstance(v, float) for v in params.values())
    assert client().patch(f"{P}/price-book/{RID}", json={"id": RID2}).status_code == 422
    assert client().patch(f"{P}/price-book/{RID}", json={"productName": "x"}).status_code == 422


def test_save_price_refuses_columns_the_page_never_sends(dbfake):
    log, _, _ = dbfake
    for body in ({"discount_tiers": [{"min": 5, "pct": 2.5}]}, {"floor_margin_pct": 10},
                 {"product_key": "nora"}):
        assert client().patch(f"{P}/price-book/{RID}", json=body).status_code == 422
    assert log == []


def test_save_credit_config(dbfake):
    log, _, _ = dbfake
    body = {"consumes_llm_credits": True, "est_credits_per_professional": 12.5,
            "est_credits_per_location": None}
    assert client().patch(f"{P}/products/nora/credit-config", json=body).json() == {"ok": True}
    (_, sql, params), = log
    assert sql.startswith("UPDATE public.exp_products SET ")
    assert sql.endswith("WHERE public.exp_products.product_key = %(product_key_1)s::VARCHAR")
    assert params == {"consumes_llm_credits": True,
                      "est_credits_per_professional": Decimal("12.5"),
                      "est_credits_per_location": None, "product_key_1": "nora"}
    assert client().patch(f"{P}/products/nora/credit-config",
                          json={"price_monthly": 1}).status_code == 422


def test_empty_patch_writes_nothing(dbfake):
    log, _, _ = dbfake
    for path in (f"price-book/{RID}", "products/nora/credit-config", f"contracts/{RID}",
                 f"line-items/{RID}", f"renewals/{RID}"):
        assert client().patch(f"{P}/{path}", json={}).json() == {"ok": True}
    assert log == []


# --- writes: account tiers -------------------------------------------------------------------

def test_upsert_account_tiers_on_conflict_with_server_updated_at(dbfake):
    log, _, _ = dbfake
    rows = [{"account_id": RID, "agent_count": 12, "tier": "smb", "group_key": "insurance"},
            {"account_id": RID2, "agent_count": 0, "tier": "individual", "group_key": "insurance"}]
    assert client().put(f"{P}/account-tiers", json={"rows": rows}).json() == {"ok": True}
    (w, sql, params), = log
    assert w is True and sql.startswith("INSERT INTO public.exp_account_tier ")
    assert sql.count("), (") == 1
    assert sql.endswith("ON CONFLICT (account_id) DO UPDATE SET agent_count = excluded.agent_count, "
                        "tier = excluded.tier, group_key = excluded.group_key, "
                        "updated_at = excluded.updated_at")
    assert params["account_id_m0"] == RID and params["agent_count_m0"] == 12
    assert params["tier_m1"] == "individual"
    assert isinstance(params["updated_at_m0"], dt.datetime)
    assert params["updated_at_m0"] == params["updated_at_m1"]


def test_upsert_account_tiers_validation(dbfake):
    log, _, _ = dbfake
    row = {"account_id": RID, "agent_count": 1.5, "tier": "smb", "group_key": "x"}
    assert client().put(f"{P}/account-tiers", json={"rows": [row]}).status_code == 422
    row = {"account_id": RID, "agent_count": 1, "tier": "smb", "group_key": "x",
           "updated_at": "2020-01-01"}
    assert client().put(f"{P}/account-tiers", json={"rows": [row]}).status_code == 422
    assert client().put(f"{P}/account-tiers", json={"rows": []}).json() == {"ok": True}
    assert log == []


# --- writes: contracts -----------------------------------------------------------------------

def test_create_contract_returns_id_and_keeps_created_by_from_the_page(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    body = {"name": "Acme (copy)", "account_id": RID2, "org_id": RID2, "status": "draft",
            "start_date": "2026-11-01", "end_date": None, "token_package": 500, "mrr": 0,
            "created_by": "other-user"}
    assert client().post(f"{P}/contracts", json=body).json() == {"id": RID}
    assert leases == [True]
    (_, sql, params), = log
    assert sql.startswith("INSERT INTO public.exp_contracts ")
    assert sql.endswith("RETURNING public.exp_contracts.id")
    assert params == {**body, "mrr": Decimal(0)}
    assert params["created_by"] == "other-user"  # duplicateContract's original creator


def test_create_contract_single_406_and_integer_token_package(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: []
    assert client().post(f"{P}/contracts", json={"name": "Q"}).status_code == 406
    assert client().post(f"{P}/contracts", json={"name": "Q", "token_package": 1.5}).status_code \
        == 422
    assert client().post(f"{P}/contracts", json={"name": "Q", "terms": {}}).status_code == 422
    assert len(log) == 1  # the 422s sent nothing


@pytest.mark.parametrize("body", [
    {"mrr": 4321.1},                                                  # syncContractMrr
    {"status": "active"},                                             # setContractStatus
    {"cost": 12.34, "net": 56.78, "margin_pct": 0.7827,
     "approval_state": "not_required"},                               # persistQuoteMargins
    {"cost": 0, "net": 0, "margin_pct": None, "approval_state": "required"},
    {"approval_state": "pending", "approval_note": "below floor"},    # requestMarginApproval
    {"approval_state": "approved"},                                   # setMarginApproval
    {"sold_by": RID2}, {"sold_by": None},                             # setContractSeller
])
def test_update_contract_sent_keys(dbfake, body):
    log, _, _ = dbfake
    assert client().patch(f"{P}/contracts/{RID}", json=body).json() == {"ok": True}
    (w, sql, params), = log
    assert w is True and sql.startswith("UPDATE public.exp_contracts SET ")
    assert sql.endswith("WHERE public.exp_contracts.id = %(id_1)s::UUID")
    money = {"mrr", "cost", "net", "margin_pct"}
    expected = {k: (Decimal(str(v)) if k in money and v is not None else v) for k, v in body.items()}
    assert params == {**expected, "id_1": RID}
    assert all(not isinstance(v, float) for v in params.values())


def test_update_contract_refuses_other_columns(dbfake):
    log, _, _ = dbfake
    for bad in ({"created_by": UID}, {"terms": {}}, {"is_locked": False}, {"executed_at": "x"}):
        assert client().patch(f"{P}/contracts/{RID}", json=bad).status_code == 422
    assert log == []


def test_contract_write_refused_is_403(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "exp_contracts"')
    assert client().patch(f"{P}/contracts/{RID}", json={"status": "active"}).status_code == 403


# --- writes: line items ----------------------------------------------------------------------

def test_add_line_item_one_row_with_discount(dbfake):
    log, _, _ = dbfake
    row = {"contract_id": RID, "product_key": "nora", "qty": 3, "unit_price": 99.99,
           "term": "monthly", "discount_pct": 0, "notes": None}
    assert client().post(f"{P}/line-items", json={"rows": [row]}).json() == {"ok": True}
    (w, sql, params), = log
    assert w is True and sql.startswith("INSERT INTO public.exp_contract_line_items (")
    assert "RETURNING" not in sql
    assert values(params) == {"contract_id_m0": RID, "product_key_m0": "nora",
                              "qty_m0": Decimal(3), "unit_price_m0": Decimal("99.99"),
                              "term_m0": "monthly", "discount_pct_m0": Decimal(0),
                              "notes_m0": None}


def test_duplicate_line_items_one_insert_without_discount_column(dbfake):
    log, _, _ = dbfake
    rows = [{"contract_id": RID, "product_key": "nora", "qty": 3, "unit_price": 1188.0,
             "term": "annual", "notes": "a"},
            {"contract_id": RID, "product_key": "setup", "qty": 1, "unit_price": 499.99,
             "term": "one_time", "notes": None}]
    client().post(f"{P}/line-items", json={"rows": rows})
    (_, sql, params), = log
    assert sql.count("), (") == 1 and "discount_pct" not in sql
    assert params["unit_price_m1"] == Decimal("499.99") and params["qty_m0"] == Decimal(3)


def test_line_items_union_of_keys_missing_is_null(dbfake):
    log, _, _ = dbfake
    rows = [{"contract_id": RID, "qty": 1}, {"contract_id": RID, "notes": "x"}]
    client().post(f"{P}/line-items", json={"rows": rows})
    (_, sql, params), = log
    assert "(contract_id, qty, notes)" in sql
    assert params == {"contract_id_m0": RID, "qty_m0": Decimal(1), "notes_m0": None,
                      "contract_id_m1": RID, "qty_m1": None, "notes_m1": "x"}


def test_line_items_refuse_other_columns_and_skip_empty(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/line-items", json={"rows": [{"cost": 1}]}).status_code == 422
    assert client().post(f"{P}/line-items", json={"rows": []}).json() == {"ok": True}
    assert log == []


@pytest.mark.parametrize("body", [
    {"discount_pct": 12.5},                                       # setLineDiscount
    {"cost": 10.01, "net": 99.99, "margin_pct": 0.8999},          # persistQuoteMargins
    {"cost": 0, "net": 0, "margin_pct": None},
])
def test_update_line_item(dbfake, body):
    log, _, _ = dbfake
    assert client().patch(f"{P}/line-items/{RID}", json=body).json() == {"ok": True}
    (_, sql, params), = log
    assert sql.startswith("UPDATE public.exp_contract_line_items SET ")
    assert sql.endswith("WHERE public.exp_contract_line_items.id = %(id_1)s::UUID")
    assert params == {**{k: None if v is None else Decimal(str(v)) for k, v in body.items()},
                      "id_1": RID}
    assert client().patch(f"{P}/line-items/{RID}", json={"qty": 1}).status_code == 422


def test_remove_line_item(dbfake):
    log, _, _ = dbfake
    assert client().delete(f"{P}/line-items/{RID}").json() == {"ok": True}
    (w, sql, params), = log
    assert w is True
    assert sql == ("DELETE FROM public.exp_contract_line_items "
                   "WHERE public.exp_contract_line_items.id = %(id_1)s::UUID")
    assert params == {"id_1": RID}


# --- writes: signatures + renewals -----------------------------------------------------------

def test_send_signature(dbfake):
    log, _, _ = dbfake
    body = {"contract_id": RID, "signer_name": "Pat Buyer", "signer_email": "p@example.com",
            "status": "sent"}
    assert client().post(f"{P}/signatures", json=body).json() == {"ok": True}
    (_, sql, params), = log
    assert sql.startswith("INSERT INTO public.exp_contract_signatures (")
    assert "RETURNING" not in sql
    assert params == {f"{k}_m0": v for k, v in body.items()}
    assert client().post(f"{P}/signatures", json={**body, "signed_at": "x"}).status_code == 422


def test_mark_signed_stamps_server_time(dbfake):
    log, _, _ = dbfake
    before = dt.datetime.now(dt.UTC)
    assert client().post(f"{P}/signatures/{RID}/signed").json() == {"ok": True}
    (_, sql, params), = log
    assert sql == ("UPDATE public.exp_contract_signatures SET status=%(status)s::VARCHAR, "
                   "signed_at=%(signed_at)s::TIMESTAMP WITH TIME ZONE WHERE public.exp_contract_signatures.id = %(id_1)s::UUID")
    assert params["status"] == "signed" and params["id_1"] == RID
    assert before <= params["signed_at"] <= dt.datetime.now(dt.UTC)


def test_renewals(dbfake):
    log, _, _ = dbfake
    body = {"contract_id": RID, "renewal_date": "2027-10-01", "reminder_state": "scheduled",
            "notes": None}
    assert client().post(f"{P}/renewals", json=body).json() == {"ok": True}
    assert client().patch(f"{P}/renewals/{RID}", json={"reminder_state": "sent"}).json() == \
        {"ok": True}
    (_, ins, ip), (_, upd, up) = writes(log)
    assert ins.startswith("INSERT INTO public.exp_contract_renewals (") and "RETURNING" not in ins
    assert ip == {f"{k}_m0": v for k, v in body.items()}
    assert upd == ("UPDATE public.exp_contract_renewals SET reminder_state=%(reminder_state)s::VARCHAR "
                   "WHERE public.exp_contract_renewals.id = %(id_1)s::UUID")
    assert up == {"reminder_state": "sent", "id_1": RID}
    assert client().patch(f"{P}/renewals/{RID}", json={"notes": "x"}).status_code == 422
