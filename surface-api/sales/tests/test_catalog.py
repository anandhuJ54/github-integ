"""sales catalog & pricing (S1) endpoints (no live DB/auth): the SQL each one sends, the
PostgREST-shaped answers, and the writes as the page sent them. No write reaches a database
here — every statement goes to a fake connection."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.sales.catalog.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
PID = "11111111-1111-4111-8111-111111111111"
P = "/sales/catalog"


class Cur:
    def __init__(self, rows, description=True):
        self.rows = rows or []
        self.description = description

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write
        self.pipelines = 0

    @contextmanager
    def pipeline(self):
        self.pipelines += 1
        self.log.append((self.write, "<pipeline>", {}))
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
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def stmts(log):
    return [x for x in log if x[1] != "<pipeline>" and "savepoint" not in x[1]]


def writes(log):
    return [x for x in log if x[1].startswith(("UPDATE", "INSERT", "DELETE"))]


def unwrap(v):
    return v.obj if isinstance(v, Jsonb) else v


def values(params):
    return {k: unwrap(v) for k, v in params.items()}


def rls_error(table: str) -> psycopg.Error:
    return psycopg.errors.InsufficientPrivilege(
        f'new row violates row-level security policy for table "{table}"')


# --- reads -----------------------------------------------------------------------------------

def test_admin_products_select_list_order_and_numeric_rendering(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [
        {"product_key": "nora", "price_monthly": Decimal("49.00"),
         "price_monthly_location": Decimal("79.5"), "min_charge": None,
         "package_includes": ["listings"], "sort": 1}]
    r = client().get(f"{P}/admin/products")
    assert r.status_code == 200
    # numeric → int when integral, else float: what the page's JSON.parse made of PostgREST's text
    assert r.json() == [{"product_key": "nora", "price_monthly": 49,
                         "price_monthly_location": 79.5, "min_charge": None,
                         "package_includes": ["listings"], "sort": 1}]
    (write, sql, params), = stmts(log)
    assert write is False
    assert sql.startswith(
        "SELECT public.exp_products.product_key, public.exp_products.name, "
        "public.exp_products.description, public.exp_products.lane, "
        "public.exp_products.price_monthly, public.exp_products.price_monthly_location, "
        "public.exp_products.price_unit, public.exp_products.billing_type, "
        "public.exp_products.creditable, public.exp_products.discountable, "
        "public.exp_products.passthrough, public.exp_products.min_charge, "
        "public.exp_products.package_includes, public.exp_products.active, "
        "public.exp_products.sort \nFROM public.exp_products "
        "ORDER BY public.exp_products.sort ASC")
    assert params["param_1"] == 1000  # the PostgREST max-rows cap


def test_pricing_config_ordered_by_key(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"key": "credit_price", "value": Decimal("0.0125"),
                                     "value_json": None, "label": "Credit price", "unit": "$",
                                     "updated_at": datetime.fromisoformat("2026-10-01T10:00:00.250+00:00")}]
    r = client().get(f"{P}/admin/pricing-config")
    assert r.json() == [{"key": "credit_price", "value": 0.0125, "value_json": None,
                         "label": "Credit price", "unit": "$",
                         "updated_at": "2026-10-01T10:00:00.25+00:00"}]
    sql = stmts(log)[0][1]
    assert "exp_pricing_config.key, public.exp_pricing_config.value, " \
        "public.exp_pricing_config.value_json, public.exp_pricing_config.label, " \
        "public.exp_pricing_config.unit, public.exp_pricing_config.updated_at" in sql
    assert "ORDER BY public.exp_pricing_config.key ASC" in sql


def test_cpq_catalog_is_one_round_trip_without_order(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: (
        [{"product_key": "nora"}] if "FROM public.exp_products" in s
        else [{"product_key": "nora", "list_price": Decimal(59)}] if "exp_price_book" in s
        else [{"key": "volume_tiers", "value": None, "value_json": [{"min": 50, "pct": 10}]}])
    r = client().get(f"{P}/cpq")
    assert r.json() == {
        "products": [{"product_key": "nora"}],
        "book": [{"product_key": "nora", "list_price": 59}],
        "config": [{"key": "volume_tiers", "value": None, "value_json": [{"min": 50, "pct": 10}]}],
    }
    assert sum(1 for x in log if x[1] == "<pipeline>") == 1
    sel = stmts(log)
    assert len(sel) == 3 and not any("ORDER BY" in x[1] for x in sel)
    assert "exp_products.package_includes" in sel[0][1] and "exp_products.sort" not in sel[0][1]
    assert sel[1][1].startswith(
        "SELECT public.exp_price_book.product_key, public.exp_price_book.scope, "
        "public.exp_price_book.unit, public.exp_price_book.list_price, "
        "public.exp_price_book.billing_type \nFROM")
    assert sel[2][1].startswith(
        "SELECT public.exp_pricing_config.key, public.exp_pricing_config.value, "
        "public.exp_pricing_config.value_json \nFROM")


def test_pricing_context_reads(dbfake):
    log, _ = dbfake
    assert client().get(f"{P}/pricing-context").json() == {"book": [], "products": []}
    book, prods = stmts(log)
    assert "exp_price_book.credit_cost_per_unit" in book[1] and "ORDER BY" not in book[1]
    assert "exp_products.est_credits_per_location" in prods[1]
    assert "ORDER BY public.exp_products.sort ASC" in prods[1]


def test_comp_plans_ordered_by_role(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": PID, "rate_pct": Decimal("0.0800"), "role": "ae"}]
    assert client().get(f"{P}/comp-plans").json() == [{"id": PID, "rate_pct": 0.08, "role": "ae"}]
    sql = stmts(log)[0][1]
    assert sql.startswith(
        "SELECT public.exp_comp_plans.id, public.exp_comp_plans.name, public.exp_comp_plans.role, "
        "public.exp_comp_plans.rate_pct, public.exp_comp_plans.basis, "
        "public.exp_comp_plans.active, public.exp_comp_plans.is_demo, "
        "public.exp_comp_plans.notes \nFROM")
    assert "ORDER BY public.exp_comp_plans.role ASC" in sql


def test_product_catalog_and_billing_batches(dbfake):
    log, _ = dbfake
    c = client()
    assert c.get(f"{P}/product-catalog").json() == {"products": [], "price_book": []}
    prods, pb = stmts(log)
    assert "exp_products.entity_scope" in prods[1] and "exp_products.is_addon" in prods[1]
    assert "ORDER BY public.exp_products.sort ASC" in prods[1]
    assert "exp_price_book.contract_price" in pb[1]
    assert "ORDER BY public.exp_price_book.product_key ASC" in pb[1]
    log.clear()
    assert c.get(f"{P}/billing").json() == {"contracts": [], "entitlements": [], "products": []}
    con, ent, names = stmts(log)
    assert "exp_contracts.margin_pct" in con[1] and "exp_contracts.token_package" in con[1]
    assert "ORDER BY public.exp_contracts.created_at DESC" in con[1]
    assert "ORDER BY public.exp_entitlements.granted_at DESC" in ent[1]
    assert names[1].startswith(
        "SELECT public.exp_products.product_key, public.exp_products.name \nFROM "
        "public.exp_products")
    assert sum(1 for x in log if x[1] == "<pipeline>") == 1


def test_read_errors_refused_or_thrown(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "permission denied for table exp_products")
    r = client().get(f"{P}/admin/products")
    assert r.status_code == 403 and "permission denied" in r.json()["detail"]
    state["answer"] = lambda s, p: psycopg.errors.UndefinedColumn("column x does not exist")
    assert client().get(f"{P}/billing").status_code == 400


# --- writes (fake connection only) -----------------------------------------------------------

PATCH = {
    "name": "NORA", "price_monthly": 0.30000000000000004, "price_monthly_location": 79.99,
    "price_unit": "month", "billing_type": "subscription", "creditable": False,
    "discountable": True, "passthrough": False, "min_charge": None,
    "package_includes": ["listings", "voce"], "active": True, "lane": "base",
}


def test_update_product_writes_sent_keys_with_exact_decimals(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"product_key": "nora"}] if s.startswith("UPDATE") else []
    r = client().patch(f"{P}/admin/products/nora", json=PATCH)
    assert r.status_code == 200 and r.json() == [{"product_key": "nora"}]
    (write, sql, params), = writes(log)
    assert write is True
    assert sql.startswith("UPDATE public.exp_products SET ")
    assert sql.endswith("WHERE public.exp_products.product_key = %(product_key_1)s::VARCHAR "
                        "RETURNING public.exp_products.product_key")
    # numeric binds carry the Decimal as is (psycopg sends it as numeric, no float on the way)
    assert "price_monthly=%(price_monthly)s, " in sql and "min_charge=%(min_charge)s, " in sql
    v = values(params)
    assert v.pop("product_key_1") == "nora"
    # description was null in the page (`?? undefined`): not sent, not written
    assert "description" not in sql
    assert v == {**PATCH, "price_monthly": Decimal("0.30000000000000004"),
                 "price_monthly_location": Decimal("79.99")}
    assert isinstance(params["package_includes"], Jsonb)  # jsonb array, not a Postgres array
    assert params["min_charge"] is None  # sent as null → written null


def test_update_product_no_row_and_empty_patch(dbfake):
    log, _ = dbfake
    c = client()
    assert c.patch(f"{P}/admin/products/nope", json={"name": "x"}).json() == []
    log.clear()
    assert c.patch(f"{P}/admin/products/nora", json={}).json() == []
    assert writes(log) == []


def test_product_patch_refuses_other_columns(dbfake):
    log, _ = dbfake
    for extra in ({"sort": 3}, {"product_key": "other"}, {"is_addon": True}):
        r = client().patch(f"{P}/admin/products/nora", json={"name": "x", **extra})
        assert r.status_code == 422
    assert writes(log) == []


def test_add_product_inserts_sent_keys_without_returning(dbfake):
    log, _ = dbfake
    body = {"product_key": "review_insights", **PATCH, "description": "Reviews"}
    r = client().post(f"{P}/admin/products", json=body)
    assert r.status_code == 200 and r.json() == {"ok": True}
    (write, sql, params), = writes(log)
    assert write is True and sql.startswith("INSERT INTO public.exp_products (")
    assert "RETURNING" not in sql
    assert values(params) == {**body, "price_monthly": Decimal("0.30000000000000004"),
                              "price_monthly_location": Decimal("79.99")}


def test_add_product_conflict_and_rls_refusal(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.UniqueViolation(
        'duplicate key value violates unique constraint "exp_products_pkey"')
    r = client().post(f"{P}/admin/products", json={"product_key": "nora", "name": "x"})
    assert r.status_code == 400 and "exp_products_pkey" in r.json()["detail"]
    state["answer"] = lambda s, p: rls_error("exp_products")
    r = client().post(f"{P}/admin/products", json={"product_key": "nora", "name": "x"})
    assert r.status_code == 403


def test_save_pricing_config_value(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"key": "credit_price", "value": Decimal("0.0125")}]
    r = client().patch(f"{P}/admin/pricing-config/credit_price", json={"value": 0.0125})
    assert r.json() == [{"key": "credit_price", "value": 0.0125}]
    (write, sql, params), = writes(log)
    assert write is True
    assert sql == ("UPDATE public.exp_pricing_config SET value=%(value)s, "
                   "updated_at=%(updated_at)s::TIMESTAMP WITH TIME ZONE "
                   "WHERE public.exp_pricing_config.key = %(key_1)s::VARCHAR "
                   "RETURNING public.exp_pricing_config.key, public.exp_pricing_config.value")
    assert params["value"] == Decimal("0.0125") and isinstance(params["value"], Decimal)
    assert params["key_1"] == "credit_price" and isinstance(params["updated_at"], datetime)
    assert client().patch(f"{P}/admin/pricing-config/x", json={"value": 1, "label": "y"}) \
        .status_code == 422


def test_save_volume_tiers(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"key": "volume_tiers"}]
    tiers = [{"min": 100, "pct": 15}, {"min": 50, "pct": 7.5}]
    r = client().put(f"{P}/admin/pricing-config/volume-tiers", json={"tiers": tiers})
    assert r.json() == [{"key": "volume_tiers"}]
    (write, sql, params), = writes(log)
    assert write is True
    assert sql == ("UPDATE public.exp_pricing_config SET value_json=%(value_json)s::JSONB, "
                   "updated_at=%(updated_at)s::TIMESTAMP WITH TIME ZONE "
                   "WHERE public.exp_pricing_config.key = %(key_1)s::VARCHAR "
                   "RETURNING public.exp_pricing_config.key")
    assert isinstance(params["value_json"], Jsonb) and params["value_json"].obj == tiers
    assert params["key_1"] == "volume_tiers"
    bad = {"tiers": [{"min": 1, "pct": 2, "note": "x"}]}
    assert client().put(f"{P}/admin/pricing-config/volume-tiers", json=bad).status_code == 422


def test_save_comp_rate(dbfake):
    log, _ = dbfake
    r = client().patch(f"{P}/comp-plans/{PID}", json={"rate_pct": 0.075})
    assert r.json() == {"ok": True}
    (write, sql, params), = writes(log)
    assert write is True
    assert sql == ("UPDATE public.exp_comp_plans SET rate_pct=%(rate_pct)s "
                   "WHERE public.exp_comp_plans.id = %(id_1)s::UUID")
    assert params == {"rate_pct": Decimal("0.075"), "id_1": PID}


def test_save_comp_rate_null_reaches_the_database(dbfake):
    """NaN in the page became JSON null; PostgREST passed it on and the NOT NULL column refused."""
    log, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.NotNullViolation(
        'null value in column "rate_pct" of relation "exp_comp_plans" violates not-null constraint')
    r = client().patch(f"{P}/comp-plans/{PID}", json={"rate_pct": None})
    assert r.status_code == 400 and "not-null" in r.json()["detail"]
    assert writes(log)[0][2]["rate_pct"] is None
