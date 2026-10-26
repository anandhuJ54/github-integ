"""sales CPQ endpoints (no live DB/auth): the SQL each one sends, the PostgREST-shaped answers,
and the writes as the page sent them (money as Decimal, never rounded). No write and no RPC
reaches a database here."""
from __future__ import annotations

import datetime as dt
import decimal
import uuid
from contextlib import contextmanager
from decimal import Decimal

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from _base.auth import current_user
from _base.db import session as core_db
from sales.queries import cpq as q
from sales.routers.cpq_data import router

UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CLAIMS = {"sub": UID, "role": "authenticated"}
RID = "11111111-1111-4111-8111-111111111111"
RID2 = "22222222-2222-4222-8222-222222222222"
P = "/sales/cpq"


class Cur:
    def __init__(self, rows, description=True):
        self.rows = rows or []
        self.description = description

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def execute(self, sql, params=None):
        self.log.append((self.write, sql, params or {}))
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)

    def cursor(self):
        conn = self

        class C(Cur):
            def __init__(self):
                super().__init__([], None)

            def execute(self, sql, params=None):
                self.rows = conn.execute(sql, params).rows
                # a write without RETURNING has no result set (psycopg: description None)
                self.description = None if sql.startswith(("UPDATE", "INSERT", "DELETE")) \
                    and "RETURNING" not in sql else True

            def fetchall(self):
                if self.description is None:
                    raise AssertionError("fetchall on a statement with no result set")
                return self.rows

        return C()


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


def writes(log):
    return [x for x in log if x[1].startswith(("UPDATE", "INSERT", "DELETE"))]


def values(params):
    return {k: (v.obj if isinstance(v, Jsonb) else v) for k, v in params.items()}


def rls_error(table: str) -> psycopg.Error:
    return psycopg.errors.InsufficientPrivilege(
        f'new row violates row-level security policy for table "{table}"')


# --- auth ------------------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/quotes"), ("get", f"{P}/quotes/state?name=Q-1"), ("put", f"{P}/quotes"),
    ("get", f"{P}/quotes/by-opportunity/{RID}"), ("get", f"{P}/accounts"),
    ("post", f"{P}/contracts"), ("patch", f"{P}/contracts/{RID}"),
    ("delete", f"{P}/contracts/{RID}/line-items"), ("post", f"{P}/contracts/{RID}/line-items"),
    ("get", f"{P}/contracts/{RID}/approval"), ("post", f"{P}/rpc/exp_contract_provision"),
    ("get", f"{P}/price-tiers"), ("post", f"{P}/price-tiers"), ("patch", f"{P}/price-tiers/{RID}"),
    ("delete", f"{P}/price-tiers/{RID}"), ("get", f"{P}/promos"),
    ("get", f"{P}/promos/find?code=x"), ("post", f"{P}/promos"), ("patch", f"{P}/promos/{RID}"),
    ("get", f"{P}/promo-redemptions"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


# --- reads -----------------------------------------------------------------------------------

@pytest.mark.parametrize("path,table,select_cols,order", [
    ("quotes", "exp_quotes", q.QUOTE_LIST_COLS, "exp_quotes.updated_at DESC NULLS LAST"),
    ("accounts", "exp_accounts", q.ACCOUNT_COLS, "exp_accounts.name ASC"),
    ("promos", "exp_promo_codes", q.PROMO_COLS, "exp_promo_codes.created_at DESC NULLS LAST"),
    ("promo-redemptions", "exp_promo_redemptions", "code", None),
])
def test_list_sql(dbfake, path, table, select_cols, order):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": RID}]
    assert client().get(f"{P}/{path}").json() == [{"id": RID}]
    (write, sql, params), = log
    assert write is False and leases == [False]
    cols = ", ".join(f"public.{table}.{c}" for c in select_cols.split(","))
    assert sql.startswith(f"SELECT {cols} \nFROM public.{table}")
    assert "WHERE" not in sql
    if order:
        assert f"ORDER BY public.{order}" in sql
    else:
        assert "ORDER BY" not in sql
    assert list(params.values()) == [1000]  # the PostgREST cap


def test_price_tiers_sql_selects_every_column_in_product_then_min_qty_order(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "unit_price": Decimal("12.50"),
                                     "min_qty": 1, "pooled_credits": 5000,
                                     "effective_from": dt.date(2026, 1, 1)}]
    assert client().get(f"{P}/price-tiers").json() == [
        {"id": RID, "unit_price": 12.5, "min_qty": 1, "pooled_credits": 5000,
         "effective_from": "2026-01-01"}]
    (_, sql, params), = log
    assert "public.exp_price_tiers.tier_kind" in sql and "public.exp_price_tiers.sort" in sql
    assert ("ORDER BY public.exp_price_tiers.product_key ASC, "
            "public.exp_price_tiers.min_qty ASC") in sql
    assert list(params.values()) == [1000]


def test_numeric_and_json_rows_are_postgrest_shaped(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: [{
        "id": uuid.UUID(RID), "summary": {"estimatedArr": 12345.67, "bundle": 100},
        "updated_at": dt.datetime(2026, 1, 2, 3, 4, 5, 280300, tzinfo=dt.UTC),
        "amount": decimal.Decimal("15.00"), "discount_pct": decimal.Decimal("12.5"),
        "applies_to_products": ["nora", "voce"], "starts_at": dt.date(2026, 10, 4),
    }]
    assert client().get(f"{P}/quotes").json() == [{
        "id": RID, "summary": {"estimatedArr": 12345.67, "bundle": 100},
        "updated_at": "2026-01-02T03:04:05.2803+00:00", "amount": 15, "discount_pct": 12.5,
        "applies_to_products": ["nora", "voce"], "starts_at": "2026-10-04",
    }]


def test_quote_state_is_the_latest_by_name_or_null(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/quotes/state", params={"name": "Q-18788"}).json() is None
    (_, sql, params), = log
    assert sql.startswith("SELECT public.exp_quotes.state \nFROM public.exp_quotes \n"
                          "WHERE public.exp_quotes.name = ")
    assert "ORDER BY public.exp_quotes.updated_at DESC NULLS LAST" in sql
    assert values(params) == {"name_1": "Q-18788", "param_1": 1}
    state["answer"] = lambda s, p: [{"state": {"quoteId": "Q-18788", "discount": 0}}]
    assert client().get(f"{P}/quotes/state", params={"name": "Q-18788"}).json() == \
        {"state": {"quoteId": "Q-18788", "discount": 0}}


def test_opportunity_quote_or_null(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/quotes/by-opportunity/{RID}").json() is None
    (_, sql, params), = log
    assert sql.startswith("SELECT public.exp_quotes.name \nFROM public.exp_quotes \n"
                          "WHERE public.exp_quotes.opportunity_id = %(opportunity_id_1)s::UUID")
    assert "ORDER BY public.exp_quotes.updated_at DESC NULLS LAST" in sql
    assert params == {"opportunity_id_1": RID, "param_1": 1}
    state["answer"] = lambda s, p: [{"name": "Q-1"}]
    assert client().get(f"{P}/quotes/by-opportunity/{RID}").json() == {"name": "Q-1"}


def test_contract_approval_maybe_single(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/contracts/{RID}/approval").json() is None
    (_, sql, params), = log
    assert sql.startswith("SELECT public.exp_contracts.approval_state, "
                          "public.exp_contracts.approval_note \nFROM public.exp_contracts \n"
                          "WHERE public.exp_contracts.id = %(id_1)s::UUID")
    assert params == {"id_1": RID, "param_1": 2}
    row = {"approval_state": "pending", "approval_note": "n"}
    state["answer"] = lambda s, p: [row]
    assert client().get(f"{P}/contracts/{RID}/approval").json() == row


def test_find_promo_ilike_active_limit_1(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/promos/find", params={"code": "smb*"}).json() is None
    (_, sql, params), = log
    assert ("WHERE public.exp_promo_codes.code ILIKE %(code_1)s::VARCHAR "
            "AND public.exp_promo_codes.active IS true") in sql
    assert params == {"code_1": "smb%", "param_1": 1}  # PostgREST: `*` is `%`
    state["answer"] = lambda s, p: [{"code": "SMB20C", "active": True,
                                     "starts_at": dt.date(2026, 10, 4), "amount": None}]
    assert client().get(f"{P}/promos/find", params={"code": "smb20c"}).json() == \
        {"code": "SMB20C", "active": True, "starts_at": "2026-10-04", "amount": None}


def test_read_errors_reach_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation(
        'invalid input syntax for type uuid: "x"')
    r = client().get(f"{P}/contracts/x/approval")
    assert r.status_code == 400 and "invalid input syntax" in r.json()["detail"]
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "permission denied for table exp_quotes")
    assert client().get(f"{P}/quotes").status_code == 403


# --- saveQuote -------------------------------------------------------------------------------

QUOTE = {"name": "Q-12345", "state": {"quoteId": "Q-12345", "discount": 0.1},
         "summary": {"estimatedArr": 1234.56}, "status": "draft", "account_id": RID,
         "opportunity_id": None}


def test_save_quote_updates_the_existing_quote_by_id(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID2)}] if s.startswith("SELECT") else []
    assert client().put(f"{P}/quotes", json=QUOTE).json() == {"id": RID2}
    assert leases == [True]
    (_, sel, sp), (w, upd, up) = log
    assert sel.startswith("SELECT public.exp_quotes.id \nFROM public.exp_quotes \n"
                          "WHERE public.exp_quotes.name = ")
    assert values(sp) == {"name_1": "Q-12345", "param_1": 1}
    assert w is True and upd.startswith("UPDATE public.exp_quotes SET ")
    assert upd.endswith("WHERE public.exp_quotes.id = %(id_1)s::UUID")
    v = values(up)
    assert isinstance(v.pop("updated_at"), dt.datetime)
    assert v == {**QUOTE, "id_1": RID2}
    assert "created_by" not in upd


def test_save_quote_inserts_with_the_caller_as_created_by(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}] if s.startswith("INSERT") else []
    assert client().put(f"{P}/quotes", json=QUOTE).json() == {"id": RID}
    (_, ins, ip), = writes(log)
    assert ins.startswith("INSERT INTO public.exp_quotes ")
    assert ins.endswith("RETURNING public.exp_quotes.id")
    v = values(ip)
    assert isinstance(v.pop("updated_at"), dt.datetime)
    assert v == {**QUOTE, "created_by": UID}
    assert isinstance(ip["state"], Jsonb) and isinstance(ip["summary"], Jsonb)


def test_save_quote_requires_every_key_and_refuses_others(dbfake):
    log, _, _ = dbfake
    partial = {k: v for k, v in QUOTE.items() if k != "status"}
    assert client().put(f"{P}/quotes", json=partial).status_code == 422
    assert client().put(f"{P}/quotes", json={**QUOTE, "created_by": RID}).status_code == 422
    assert log == []


# --- commitEntitlements steps ----------------------------------------------------------------

def test_create_contract_keeps_money_digits_and_stamps_created_by(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    body = {"name": "Acme · Q-1", "account_id": RID2, "org_id": None, "status": "draft",
            "mrr": 102.88, "net": 1234.5600000000002,
            "terms": {"quote_id": "Q-1", "summary": {"estimatedArr": 1234.5600000000002},
                      "pricing_model": "ppu"},
            "approval_state": "pending", "approval_note": "over limit"}
    assert client().post(f"{P}/contracts", json=body).json() == {"id": RID}
    assert leases == [True]
    (_, sql, params), = log
    assert sql.startswith("INSERT INTO public.exp_contracts ")
    assert sql.endswith("RETURNING public.exp_contracts.id")
    assert params["mrr"] == Decimal("102.88") and isinstance(params["mrr"], Decimal)
    assert params["net"] == Decimal("1234.5600000000002")
    assert values(params) == {**body, "mrr": Decimal("102.88"),
                              "net": Decimal("1234.5600000000002"), "created_by": UID}


def test_create_contract_writes_only_sent_keys(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    client().post(f"{P}/contracts", json={"name": "Q", "mrr": 0, "net": 0, "terms": {}})
    (_, sql, params), = log
    assert set(params) == {"name", "mrr", "net", "terms", "created_by"}
    assert "approval_state" not in sql


def test_create_contract_single_406_on_no_row(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: []
    assert client().post(f"{P}/contracts", json={"name": "Q"}).status_code == 406


def test_update_contract_patch_by_id(dbfake):
    log, _, _ = dbfake
    body = {"mrr": 10.01, "net": 120.12, "account_id": None}
    assert client().patch(f"{P}/contracts/{RID}", json=body).json() == {"ok": True}
    (w, sql, params), = log
    assert w is True and sql.startswith("UPDATE public.exp_contracts SET ")
    assert sql.endswith("WHERE public.exp_contracts.id = %(id_1)s::UUID")
    assert params == {"mrr": Decimal("10.01"), "net": Decimal("120.12"), "account_id": None,
                      "id_1": RID}
    assert client().patch(f"{P}/contracts/{RID}", json={"created_by": "x"}).status_code == 422
    assert client().patch(f"{P}/contracts/{RID}", json={"status": "active"}).status_code == 422


def test_delete_contract_lines_by_contract(dbfake):
    log, _, _ = dbfake
    assert client().delete(f"{P}/contracts/{RID}/line-items").json() == {"ok": True}
    (w, sql, params), = log
    assert w is True
    assert sql == ("DELETE FROM public.exp_contract_line_items "
                   "WHERE public.exp_contract_line_items.contract_id = %(contract_id_1)s::UUID")
    assert params == {"contract_id_1": RID}


def test_insert_contract_lines_one_multi_row_insert(dbfake):
    log, _, _ = dbfake
    rows = [
        {"product_key": "nora", "qty": 3, "unit_price": 1188, "net": 3564, "term": "annual",
         "discount_pct": 12.35, "notes": "NORA Engage · professionals"},
        {"product_key": "setup", "qty": 1, "unit_price": 499.99, "net": 499.99,
         "term": "one_time", "discount_pct": 0, "notes": "Setup"},
    ]
    assert client().post(f"{P}/contracts/{RID}/line-items", json={"rows": rows}).json() == \
        {"ok": True}
    (w, sql, params), = log
    assert w is True and sql.startswith("INSERT INTO public.exp_contract_line_items (")
    assert sql.count("), (") == 1 and "RETURNING" not in sql
    assert params["contract_id_m0"] == RID and params["contract_id_m1"] == RID
    assert params["discount_pct_m0"] == Decimal("12.35")
    assert params["unit_price_m1"] == Decimal("499.99") and params["qty_m0"] == 3
    assert all(not isinstance(v, float) for v in params.values())


def test_insert_contract_lines_refuses_unknown_columns_and_skips_empty(dbfake):
    log, _, _ = dbfake
    bad = {"rows": [{"product_key": "x", "qty": 1, "unit_price": 1, "net": 1, "term": "annual",
                     "discount_pct": 0, "notes": "", "cost": 0}]}
    assert client().post(f"{P}/contracts/{RID}/line-items", json=bad).status_code == 422
    assert client().post(f"{P}/contracts/{RID}/line-items", json={"rows": []}).json() == \
        {"ok": True}
    assert log == []


def test_contract_write_refused_is_403(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: rls_error("exp_contracts")
    r = client().patch(f"{P}/contracts/{RID}", json={"mrr": 1})
    assert r.status_code == 403 and "row-level security" in r.json()["detail"]


# --- exp_contract_provision (compiled only, never called) ------------------------------------

def test_provision_rpc_sql():
    assert q.rpc_sql("exp_contract_provision", {"p_contract": RID}) == (
        "select public.exp_contract_provision(p_contract => %(p_contract)s::uuid) as v",
        {"p_contract": RID})


def test_rpc_allow_list():
    with pytest.raises(q.UnknownRpc):
        q.rpc_sql("exp_contract_execute", {})
    with pytest.raises(q.UnknownRpc):
        q.rpc_sql("exp_contract_provision", {"p_contract": RID, "p_force": True})


def test_provision_endpoint_runs_as_the_user_and_returns_the_count(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": 4}]
    r = client().post(f"{P}/rpc/exp_contract_provision", json={"args": {"p_contract": RID}})
    assert r.json() == 4 and leases == [True]
    (_, sql, params), = log
    assert sql.startswith("select public.exp_contract_provision(")
    assert params == {"p_contract": RID}


def test_provision_error_message_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("contract not found")
    r = client().post(f"{P}/rpc/exp_contract_provision", json={"args": {"p_contract": RID}})
    assert r.status_code == 400 and r.json()["detail"] == "contract not found"


def test_unknown_rpc_refused_before_a_connection(dbfake):
    log, _, leases = dbfake
    r = client().post(f"{P}/rpc/exp_contract_delete", json={"args": {}})
    assert r.status_code == 400 and leases == [] and log == []


# --- price tiers -----------------------------------------------------------------------------

def test_update_tier_fields_sent_keys_only(dbfake):
    log, _, _ = dbfake
    body = {"unit_price": 9.99, "max_qty": None, "pooled_credits": 250000}
    assert client().patch(f"{P}/price-tiers/{RID}", json=body).json() == {"ok": True}
    (w, sql, params), = log
    assert w is True and sql.startswith("UPDATE public.exp_price_tiers SET ")
    assert sql.endswith("WHERE public.exp_price_tiers.id = %(id_1)s::UUID")
    assert params == {"unit_price": Decimal("9.99"), "max_qty": None, "pooled_credits": 250000,
                      "id_1": RID}


def test_tier_integer_columns_take_whole_numbers_only(dbfake):
    log, _, _ = dbfake
    assert client().patch(f"{P}/price-tiers/{RID}", json={"min_qty": 2.5}).status_code == 422
    assert client().patch(f"{P}/price-tiers/{RID}", json={"label": "x"}).status_code == 422
    assert log == []


def test_create_and_delete_tier(dbfake):
    log, _, _ = dbfake
    row = {"product_key": "nora", "entity_type": "professional", "min_qty": 1, "max_qty": 10,
           "unit_price": 79.5, "effective_from": "2026-10-01"}
    assert client().post(f"{P}/price-tiers", json=row).json() == {"ok": True}
    assert client().delete(f"{P}/price-tiers/{RID}").json() == {"ok": True}
    (_, ins, ip), (_, dele, dp) = log
    assert ins.startswith("INSERT INTO public.exp_price_tiers ") and "RETURNING" not in ins
    assert ip == {**row, "unit_price": Decimal("79.5")}
    assert dele == ("DELETE FROM public.exp_price_tiers "
                    "WHERE public.exp_price_tiers.id = %(id_1)s::UUID")
    assert dp == {"id_1": RID}


# --- promo codes -----------------------------------------------------------------------------

PROMO = {"code": "SPRING10", "applies_to_products": ["nora"], "discount_kind": "percent",
         "amount": 10, "discount_pct": 10, "pricing_type": "recurring", "duration_months": 12,
         "starts_at": "2026-10-01", "expires_at": None, "scope_type": "all",
         "applies_to_scope": None, "seller_id": None}


def test_create_promo_inserts_active(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/promos", json=PROMO).json() == {"ok": True}
    (w, sql, params), = log
    assert w is True and sql.startswith("INSERT INTO public.exp_promo_codes ")
    assert "RETURNING" not in sql
    assert params == {**PROMO, "amount": Decimal(10), "discount_pct": Decimal(10),
                      "active": True}
    assert client().post(f"{P}/promos", json={**PROMO, "active": False}).status_code == 422


def test_set_promo_active(dbfake):
    log, _, _ = dbfake
    assert client().patch(f"{P}/promos/{RID}", json={"active": False}).json() == {"ok": True}
    (_, sql, params), = log
    assert sql == ("UPDATE public.exp_promo_codes SET active=%(active)s "
                   "WHERE public.exp_promo_codes.id = %(id_1)s::UUID")
    assert params == {"active": False, "id_1": RID}
    assert client().patch(f"{P}/promos/{RID}", json={"code": "X"}).status_code == 422
