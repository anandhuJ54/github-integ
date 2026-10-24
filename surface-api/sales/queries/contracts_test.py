"""sales contracts endpoints (no live DB/auth): the SQL each one sends, in the browser's order,
the PostgREST-shaped answers, and the m4_* calls as compiled SQL (actor from the token, money as
Decimal). No write and no m4_* function reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid
from contextlib import contextmanager
from decimal import Decimal

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from _base.core import db as core_db
from _base.core.auth import current_user
from sales.queries import contracts as q
from sales.routers.contracts_data import router

UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
EMAIL = "seller@example.com"
CLAIMS = {"sub": UID, "role": "authenticated", "email": EMAIL}
RID = "11111111-1111-4111-8111-111111111111"
RID2 = "22222222-2222-4222-8222-222222222222"
ORG = "33333333-3333-4333-8333-333333333333"
P = "/sales/contracts"


# --- a fake role-scoped database (shared with csm_test / sign_test) ---------------------------

class FakeConn:
    def __init__(self, log, answer, lease):
        self.log, self.answer, self.lease = log, answer, lease

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def _run(self, sql, params):
        self.log.append((self.lease, sql, params or {}))
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return rows

    def execute(self, sql, params=None):
        rows = self._run(sql, params)

        class R:
            def fetchall(self):
                return rows

        return R()

    def cursor(self):
        conn = self

        class C:
            rows: tuple = ()
            description = None

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def execute(self, sql, params=None):
                self.rows = conn._run(sql, params)
                # a write without RETURNING has no result set (psycopg: description None)
                self.description = None if sql.startswith(("UPDATE", "INSERT", "DELETE")) \
                    and "RETURNING" not in sql else True

            def fetchall(self):
                if self.description is None:
                    raise AssertionError("fetchall on a statement with no result set")
                return self.rows

            def fetchone(self):
                return self.rows[0] if self.rows else None

        return C()


def install_fake_db(monkeypatch):
    """Replace role_connection with a recorder. Returns (log, state, leases): log = [(lease, sql,
    params)], lease = (role, write); state["answer"](sql, params) gives the rows (or raises)."""
    log: list = []
    leases: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        if role == "authenticated":
            assert claims == state.get("claims", CLAIMS)
        else:
            assert claims is None
        lease = (role, write)
        leases.append(lease)
        yield FakeConn(log, lambda s, p: state["answer"](s, p), lease)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state, leases


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def make_client(r, claims=CLAIMS) -> TestClient:
    app = FastAPI()
    app.include_router(r)
    if claims is not None:
        app.dependency_overrides[current_user] = lambda: claims
    return TestClient(app)


def client() -> TestClient:
    return make_client(router)


def sqls(log):
    return [s for _, s, _ in log if "savepoint" not in s]


def table_of(sql: str) -> str:
    return sql.split("FROM public.", 1)[1].split()[0]


AUTH_READ = ("authenticated", False)
AUTH_WRITE = ("authenticated", True)


# --- auth ------------------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", P), ("get", f"{P}/renewals"), ("get", f"{P}/by-quote/{RID}"),
    ("get", f"{P}/notifications"), ("post", f"{P}/notifications/{RID}/read"),
    ("get", f"{P}/skus"), ("post", f"{P}/rpc/m4_finalize"), ("get", f"{P}/{RID}"),
    ("patch", f"{P}/{RID}"), ("get", f"{P}/{RID}/invoices"), ("get", f"{P}/{RID}/usage"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(make_client(router, None), method)(path, **kw).status_code == 403


# --- listContracts ---------------------------------------------------------------------------

def test_list_contracts_reads_in_order_and_returns_the_parts(dbfake):
    log, state, leases = dbfake
    c1 = {"id": uuid.UUID(RID), "org_id": ORG, "account_id": "acct", "acv": Decimal("1200.50"),
          "created_at": dt.datetime(2026, 10, 1, tzinfo=dt.UTC), "terms": {"quote_state": {}}}
    c2 = {"id": uuid.UUID(RID2), "org_id": None, "account_id": ORG, "acv": None}

    def answer(sql, params):
        t = table_of(sql)
        return {"exp_contracts": [c1, c2],
                "organizations": [{"id": uuid.UUID(ORG), "name": "Acme", "logo_url": None}],
                "exp_contract_activity": [{"id": RID, "contract_id": RID}],
                "exp_contract_renewals": []}[t]

    state["answer"] = answer
    out = client().get(P).json()
    assert leases == [AUTH_READ]
    assert out == {
        "contracts": [{"id": RID, "org_id": ORG, "account_id": "acct", "acv": 1200.5,
                       "created_at": "2026-10-01T00:00:00+00:00", "terms": {"quote_state": {}}},
                      {"id": RID2, "org_id": None, "account_id": ORG, "acv": None}],
        "orgs": [{"id": ORG, "name": "Acme", "logo_url": None}],
        "activity": [{"id": RID, "contract_id": RID}],
        "renewals": [],
    }
    first, orgs, acts, rens = [x for x in log if "savepoint" not in x[1]]
    assert first[1].startswith("SELECT public.exp_contracts.id, ")
    assert first[1].endswith("ORDER BY public.exp_contracts.created_at DESC \n LIMIT %(param_1)s::INTEGER")
    assert first[2] == {"param_1": 1000}
    # org_id ?? account_id, deduplicated: both contracts point at ORG
    assert orgs[1].startswith("SELECT public.organizations.id, public.organizations.name, "
                              "public.organizations.logo_url \nFROM public.organizations \n"
                              "WHERE public.organizations.id IN (%(id_1_1)s::UUID)")
    assert orgs[2] == {"id_1_1": ORG, "param_1": 1000}
    assert "WHERE public.exp_contract_activity.contract_id IN (" in acts[1]
    assert "ORDER BY public.exp_contract_activity.occurred_at DESC" in acts[1]
    assert acts[2]["param_1"] == 1000  # limit(2000) lowered to the PostgREST cap
    assert [v for k, v in acts[2].items() if k.startswith("contract_id")] == [RID, RID2]
    assert "WHERE public.exp_contract_renewals.contract_id IN (" in rens[1]
    assert "ORDER BY" not in rens[1]


def test_list_contracts_skips_the_follow_up_reads_when_empty(dbfake):
    log, _, _ = dbfake
    assert client().get(P).json() == {"contracts": [], "orgs": [], "activity": [],
                                      "renewals": []}
    assert len(log) == 1


def test_org_key_is_nullish_coalescing():
    assert q._org_key({"org_id": "", "account_id": "a"}) == ""  # "" is not null
    assert q._org_key({"org_id": None, "account_id": "a"}) == "a"
    assert q._org_key({"org_id": None, "account_id": None}) == ""
    assert q._uniq(["", "b", "a", "b", None]) == ["b", "a"]


def test_list_contracts_non_uuid_org_reaches_the_page_as_400(dbfake):
    _, state, _ = dbfake

    def answer(sql, params):
        if table_of(sql) == "organizations":
            return psycopg.errors.InvalidTextRepresentation(
                'invalid input syntax for type uuid: "acct"')
        return [{"id": uuid.UUID(RID), "org_id": "acct", "account_id": None}]

    state["answer"] = answer
    r = client().get(P)
    assert r.status_code == 400 and "invalid input syntax" in r.json()["detail"]


# --- getContract -----------------------------------------------------------------------------

def test_get_contract_reads_the_contract_then_its_children(dbfake):
    log, state, leases = dbfake
    contract = {"id": uuid.UUID(RID), "org_id": None, "account_id": ORG}

    def answer(sql, params):
        t = table_of(sql)
        if t == "exp_contracts":
            return [contract]
        if t == "exp_contract_line_items":
            return [{"id": RID2, "qty": Decimal(3), "unit_price": Decimal("99.95")}]
        return []

    state["answer"] = answer
    out = client().get(f"{P}/{RID}").json()
    assert leases == [AUTH_READ]
    assert out["contract"] == {"id": RID, "org_id": None, "account_id": ORG}
    assert out["lineItems"] == [{"id": RID2, "qty": 3, "unit_price": 99.95}]
    assert set(out) == {"contract", "orgs", "lineItems", "versions", "recipients", "approvals",
                        "signatures", "activity", "documents", "renewals"}
    first, *rest = [x for x in log if "savepoint" not in x[1]]
    assert first[1].endswith("WHERE public.exp_contracts.id = %(id_1)s::UUID \n"
                             " LIMIT %(param_1)s::INTEGER")
    assert first[2] == {"id_1": RID, "param_1": 2}
    assert [table_of(s) for _, s, _ in rest] == [
        "organizations", "exp_contract_line_items", "exp_contract_versions",
        "exp_contract_recipients", "exp_contract_approvals", "exp_contract_signatures",
        "exp_contract_activity", "exp_contract_documents", "exp_contract_renewals"]
    orders = {table_of(s): s.split("ORDER BY ", 1)[1].split(" \n")[0] if "ORDER BY" in s else None
              for _, s, _ in rest}
    assert orders == {
        "organizations": None,
        "exp_contract_line_items": None,
        "exp_contract_versions": "public.exp_contract_versions.version_no DESC",
        "exp_contract_recipients": "public.exp_contract_recipients.signing_order ASC",
        "exp_contract_approvals": "public.exp_contract_approvals.requested_at DESC",
        "exp_contract_signatures": "public.exp_contract_signatures.signing_order ASC",
        "exp_contract_activity": "public.exp_contract_activity.occurred_at DESC",
        "exp_contract_documents": None,
        "exp_contract_renewals": None,
    }
    for _, s, p in rest[1:]:
        assert ".contract_id = %(contract_id_1)s::UUID" in s and p["contract_id_1"] == RID


def test_get_contract_without_org_skips_the_org_read(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": RID, "org_id": None, "account_id": None}] \
        if table_of(s) == "exp_contracts" else []
    assert client().get(f"{P}/{RID}").json()["orgs"] == []
    assert "organizations" not in [table_of(s) for s in sqls(log)]


def test_get_contract_null_when_missing_and_406_on_two_rows(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/{RID}").json() is None
    assert len(log) == 1
    state["answer"] = lambda s, p: [{"id": RID}, {"id": RID}]
    assert client().get(f"{P}/{RID}").status_code == 406


# --- loadRenewals ----------------------------------------------------------------------------

def test_load_renewals_open_ones_then_their_contracts(dbfake):
    log, state, _ = dbfake
    rens = [{"id": "r1", "contract_id": RID, "renewal_date": dt.date(2026, 11, 1)},
            {"id": "r2", "contract_id": RID}]
    state["answer"] = lambda s, p: rens if table_of(s) == "exp_contract_renewals" \
        else [{"id": RID, "name": "C"}]
    out = client().get(f"{P}/renewals").json()
    assert out == {"renewals": [{"id": "r1", "contract_id": RID, "renewal_date": "2026-11-01"},
                                {"id": "r2", "contract_id": RID}],
                   "contracts": [{"id": RID, "name": "C"}]}
    (_, s1, p1), (_, s2, p2) = log
    assert ("WHERE public.exp_contract_renewals.status IN "
            "(%(status_1_1)s::VARCHAR, %(status_1_2)s::VARCHAR)") in s1
    assert "ORDER BY public.exp_contract_renewals.renewal_date ASC" in s1
    assert p1 == {"status_1_1": "upcoming", "status_1_2": "in_progress", "param_1": 1000}
    assert "WHERE public.exp_contracts.id IN (%(id_1_1)s::UUID)" in s2  # deduplicated
    assert p2 == {"id_1_1": RID, "param_1": 1000}


def test_load_renewals_none_open(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/renewals").json() == {"renewals": [], "contracts": []}
    assert len(log) == 1


# --- the quote page's contract ---------------------------------------------------------------

def test_quote_contract_latest_id(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/by-quote/{RID2}").json() == [{"id": RID}]
    (_, sql, params), = log
    assert sql == ("SELECT public.exp_contracts.id \nFROM public.exp_contracts \n"
                   "WHERE public.exp_contracts.quote_id = %(quote_id_1)s::UUID "
                   "ORDER BY public.exp_contracts.created_at DESC \n LIMIT %(param_1)s::INTEGER")
    assert params == {"quote_id_1": RID2, "param_1": 1}


def test_quote_contract_with_a_quote_name_is_the_database_error(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation(
        'invalid input syntax for type uuid: "Q-18788"')
    assert client().get(f"{P}/by-quote/Q-18788").status_code == 400


# --- small reads -----------------------------------------------------------------------------

def test_notifications_newest_first_with_the_limit(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "read_at": None}]
    assert client().get(f"{P}/notifications").json() == [{"id": RID, "read_at": None}]
    assert client().get(f"{P}/notifications", params={"limit": 5}).status_code == 200
    assert client().get(f"{P}/notifications", params={"limit": 5000}).status_code == 200
    (_, sql, p20), (_, _, p5), (_, _, pbig) = log
    assert sql.endswith("FROM public.exp_notifications "
                        "ORDER BY public.exp_notifications.created_at DESC \n LIMIT %(param_1)s::INTEGER")
    assert p20 == {"param_1": 20} and p5 == {"param_1": 5} and pbig == {"param_1": 1000}
    assert client().get(f"{P}/notifications", params={"limit": -1}).status_code == 422


def test_skus_active_in_family_then_name_order(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"code": "NORA", "annual_unit_price": Decimal("1188.00"),
                                     "monthly_unit_price": Decimal("99.5")}]
    assert client().get(f"{P}/skus").json() == [
        {"code": "NORA", "annual_unit_price": 1188, "monthly_unit_price": 99.5}]
    (_, sql, params), = log
    assert ("WHERE public.exp_order_sku.active IS true ORDER BY public.exp_order_sku.family ASC, "
            "public.exp_order_sku.name ASC") in sql
    assert params == {"param_1": 1000}


def test_invoices_then_their_lines(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID2), "total": Decimal("10.10")}] \
        if table_of(s) == "exp_invoice" else [{"invoice_id": RID2, "amount": Decimal("10.10")}]
    assert client().get(f"{P}/{RID}/invoices").json() == {
        "invoices": [{"id": RID2, "total": 10.1}], "lines": [{"invoice_id": RID2, "amount": 10.1}]}
    (_, s1, p1), (_, s2, p2) = log
    assert ("WHERE public.exp_invoice.contract_id = %(contract_id_1)s::UUID "
            "ORDER BY public.exp_invoice.issued_at DESC NULLS FIRST") in s1
    assert p1 == {"contract_id_1": RID, "param_1": 1000}
    assert "WHERE public.exp_invoice_line.invoice_id IN (%(invoice_id_1_1)s::UUID)" in s2
    assert p2 == {"invoice_id_1_1": RID2, "param_1": 1000}


def test_invoices_none_skips_the_lines(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/{RID}/invoices").json() == {"invoices": [], "lines": []}
    assert len(log) == 1


def test_usage_newest_period_first(dbfake):
    log, _, _ = dbfake
    assert client().get(f"{P}/{RID}/usage").json() == []
    (_, sql, params), = log
    assert ("WHERE public.exp_usage_meter.contract_id = %(contract_id_1)s::UUID "
            "ORDER BY public.exp_usage_meter.period_start DESC") in sql
    assert params == {"contract_id_1": RID, "param_1": 1000}


def test_read_refused_is_403(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "permission denied for table exp_contracts")
    assert client().get(P).status_code == 403


# --- direct writes ---------------------------------------------------------------------------

def test_update_special_terms(dbfake):
    log, _, leases = dbfake
    assert client().patch(f"{P}/{RID}", json={"special_terms": "Net 45"}).json() == {"ok": True}
    assert client().patch(f"{P}/{RID}", json={"special_terms": None}).json() == {"ok": True}
    (lease, sql, params), (_, _, p2) = log
    assert lease == AUTH_WRITE and leases == [AUTH_WRITE, AUTH_WRITE]
    assert sql == ("UPDATE public.exp_contracts SET special_terms=%(special_terms)s::VARCHAR "
                   "WHERE public.exp_contracts.id = %(id_1)s::UUID")
    assert params == {"special_terms": "Net 45", "id_1": RID}
    assert p2 == {"special_terms": None, "id_1": RID}


def test_update_special_terms_refuses_other_columns(dbfake):
    log, _, _ = dbfake
    assert client().patch(f"{P}/{RID}", json={"special_terms": "x", "acv": 1}).status_code == 422
    assert client().patch(f"{P}/{RID}", json={}).status_code == 422
    assert log == []


def test_mark_notification_read_uses_the_server_clock(dbfake):
    log, _, _ = dbfake
    before = dt.datetime.now(dt.UTC)
    assert client().post(f"{P}/notifications/{RID}/read").json() == {"ok": True}
    (lease, sql, params), = log
    assert lease == AUTH_WRITE
    assert sql == ("UPDATE public.exp_notifications SET read_at=%(read_at)s::TIMESTAMP WITH TIME ZONE "
                   "WHERE public.exp_notifications.id = %(id_1)s::UUID")
    assert params["id_1"] == RID
    assert before <= params["read_at"] <= dt.datetime.now(dt.UTC)


def test_write_refused_is_403(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "exp_notifications"')
    assert client().post(f"{P}/notifications/{RID}/read").status_code == 403


# --- m4_* RPCs (compiled only, never called against a database) ------------------------------

def test_allow_list_matches_the_live_signatures():
    # pg_get_function_identity_arguments(oid) for each, read-only at port time
    live = {
        "m4_add_line": "p_contract uuid, p_code text, p_qty numeric, p_unit_price numeric, "
                       "p_discount_pct numeric, p_term_months integer, p_billing_mode text, "
                       "p_actor text",
        "m4_add_recipient": "p_contract uuid, p_party text, p_name text, p_email text, "
                            "p_role text, p_order integer, p_actor text",
        "m4_add_version": "p_contract uuid, p_kind text, p_label text, p_uploaded_by text, "
                          "p_changes jsonb, p_source text",
        "m4_assemble_document": "p_contract uuid, p_actor text",
        "m4_create_addendum": "p_parent uuid, p_kind text, p_title text, p_actor text",
        "m4_create_contract_from_quote": "p_quote_id uuid, p_created_by text",
        "m4_decide_approval": "p_approval uuid, p_status text, p_reason text, p_actor text",
        "m4_finalize": "p_contract uuid, p_actor text",
        "m4_generate_invoice": "p_contract uuid, p_type text, p_ps date, p_pe date, p_actor text",
        "m4_generate_renewal_notice": "p_contract uuid, p_actor text",
        "m4_record_usage": "p_contract uuid, p_code text, p_metric text, p_period_start date, "
                           "p_period_end date, p_measured numeric, p_high_water numeric, "
                           "p_actor text",
        "m4_remove_line": "p_line uuid, p_actor text",
        "m4_remove_recipient": "p_recipient uuid, p_actor text",
        "m4_request_approval": "p_contract uuid, p_role text, p_name text, p_email text, "
                               "p_actor text",
        "m4_send_for_signature": "p_contract uuid, p_actor text",
        "m4_start_renewal": "p_contract uuid, p_actor text",
    }
    assert {n: ", ".join(f"{p} {t}" for p, t in ps) for n, ps in q.CONTRACT_RPCS.items()} == live


def test_actor_params_are_server_filled_except_created_by():
    assert q.ACTOR_PARAMS == {n: "p_actor" for n in q.CONTRACT_RPCS
                              if n not in ("m4_create_contract_from_quote", "m4_add_version")} \
        | {"m4_add_version": "p_uploaded_by"}


def test_add_line_sql_money_as_decimal_and_actor_from_the_token():
    sql, params = q.rpc_sql("m4_add_line", {
        "p_contract": RID, "p_code": "NORA-PRO", "p_qty": 3, "p_unit_price": 1234.5600000000002,
        "p_discount_pct": 12.35, "p_term_months": 12, "p_billing_mode": "annual"}, EMAIL)
    assert sql == ("select public.m4_add_line(p_contract => %(p_contract)s::uuid, "
                   "p_code => %(p_code)s::text, p_qty => %(p_qty)s::numeric, "
                   "p_unit_price => %(p_unit_price)s::numeric, "
                   "p_discount_pct => %(p_discount_pct)s::numeric, "
                   "p_term_months => %(p_term_months)s::integer, "
                   "p_billing_mode => %(p_billing_mode)s::text, "
                   "p_actor => %(p_actor)s::text) as v")
    assert params == {"p_contract": RID, "p_code": "NORA-PRO", "p_qty": Decimal(3),
                      "p_unit_price": Decimal("1234.5600000000002"),
                      "p_discount_pct": Decimal("12.35"), "p_term_months": 12,
                      "p_billing_mode": "annual", "p_actor": EMAIL}
    assert all(not isinstance(v, float) for v in params.values())


def test_add_version_fills_uploaded_by_and_wraps_jsonb():
    sql, params = q.rpc_sql("m4_add_version", {
        "p_contract": RID, "p_kind": "customer_redline", "p_label": "v2",
        "p_changes": {"summary": "x"}, "p_source": "upload"}, EMAIL)
    assert "p_uploaded_by => %(p_uploaded_by)s::text" in sql
    assert "p_changes => %(p_changes)s::jsonb" in sql
    assert params["p_uploaded_by"] == EMAIL
    assert isinstance(params["p_changes"], Jsonb) and params["p_changes"].obj == {"summary": "x"}
    assert "p_actor" not in params


def test_create_contract_from_quote_keeps_created_by_from_the_request():
    sql, params = q.rpc_sql("m4_create_contract_from_quote",
                            {"p_quote_id": RID, "p_created_by": "Display Name"}, EMAIL)
    assert sql == ("select public.m4_create_contract_from_quote("
                   "p_quote_id => %(p_quote_id)s::uuid, "
                   "p_created_by => %(p_created_by)s::text) as v")
    assert params == {"p_quote_id": RID, "p_created_by": "Display Name"}


def test_null_actor_when_the_token_has_no_email():
    _, params = q.rpc_sql("m4_finalize", {"p_contract": RID}, None)
    assert params == {"p_contract": RID, "p_actor": None}


def test_record_usage_dates_and_nullable_high_water():
    sql, params = q.rpc_sql("m4_record_usage", {
        "p_contract": RID, "p_code": "VOCE", "p_metric": "credits",
        "p_period_start": "2026-10-01", "p_period_end": "2026-10-31", "p_measured": 1500,
        "p_high_water": None}, EMAIL)
    assert "p_period_start => %(p_period_start)s::date" in sql
    assert params["p_measured"] == Decimal(1500) and params["p_high_water"] is None


@pytest.mark.parametrize("name,args,why", [
    ("m4_outbox_drain", {}, "unknown function"),
    ("m4_record_signature", {"p_token": "t"}, "unknown function"),
    ("m4_finalize", {"p_contract": RID, "p_actor": "someone@else"}, "set by the server"),
    ("m4_add_version", {"p_contract": RID, "p_uploaded_by": "x"}, "set by the server"),
    ("m4_finalize", {"p_contract": RID, "p_force": True}, "unknown parameter"),
    ("m4_add_line", {"p_contract": RID, "p_qty": True}, "must be a number"),
    ("m4_add_line", {"p_contract": RID, "p_qty": "NaN"}, "must be a number"),
    ("m4_add_line", {"p_contract": RID, "p_qty": "abc"}, "must be a number"),
    ("m4_add_line", {"p_contract": RID, "p_term_months": 12.5}, "whole number"),
    ("m4_add_recipient", {"p_contract": RID, "p_order": "1"}, "whole number"),
    ("m4_finalize", {"p_contract": 5}, "must be a string"),
])
def test_rpc_refusals(name, args, why):
    with pytest.raises(q.UnknownRpc, match=why):
        q.rpc_sql(name, args, EMAIL)


def test_rpc_endpoint_runs_as_the_user_with_their_email(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": {"ok": False, "checklist": {"recipients": False}}}]
    r = client().post(f"{P}/rpc/m4_finalize", json={"args": {"p_contract": RID}})
    assert r.json() == {"ok": False, "checklist": {"recipients": False}}
    assert leases == [AUTH_WRITE]
    (_, sql, params), = log
    assert sql == ("select public.m4_finalize(p_contract => %(p_contract)s::uuid, "
                   "p_actor => %(p_actor)s::text) as v")
    assert params == {"p_contract": RID, "p_actor": EMAIL}


def test_rpc_endpoint_void_and_scalar_results(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: [{"v": None}]
    assert client().post(f"{P}/rpc/m4_remove_line", json={"args": {"p_line": RID}}).json() is None
    state["answer"] = lambda s, p: [{"v": uuid.UUID(RID2)}]
    assert client().post(f"{P}/rpc/m4_start_renewal",
                         json={"args": {"p_contract": RID}}).json() == RID2
    state["answer"] = lambda s, p: [{"v": 2}]
    assert client().post(f"{P}/rpc/m4_send_for_signature",
                         json={"args": {"p_contract": RID}}).json() == 2


def test_rpc_refused_before_a_connection(dbfake):
    log, _, leases = dbfake
    for name, args in [("m4_outbox_drain", {}), ("m4_finalize", {"p_contract": RID,
                                                                  "p_actor": "x@y"})]:
        assert client().post(f"{P}/rpc/{name}", json={"args": args}).status_code == 400
    assert client().post(f"{P}/rpc/m4_finalize", json={"args": {}, "x": 1}).status_code == 422
    assert leases == [] and log == []


def test_rpc_error_message_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("contract is locked")
    r = client().post(f"{P}/rpc/m4_remove_line", json={"args": {"p_line": RID}})
    assert r.status_code == 400 and r.json()["detail"] == "contract is locked"
