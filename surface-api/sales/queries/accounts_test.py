"""sales accounts endpoints (no live DB/auth): the SQL each one sends, the PostgREST-shaped
answers, and the writes as the page sent them. No write reaches a database here."""
from __future__ import annotations

import uuid

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from _base.core.auth import current_user
from sales.queries import accounts as q
from sales.queries import core_test as ct
from sales.queries.cpq_test import RID, RID2
from sales.routers.accounts_data import router

P = "/sales/accounts"
CLAIMS, select_list, selects = ct.CLAIMS, ct.select_list, ct.selects
dbfake = ct.dbfake  # the same fake connection fixture (claims with an email)


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/list-rows"), ("get", f"{P}/tree-rows"), ("post", f"{P}/discovered-counts"),
    ("get", f"{P}/{RID}/entitlements"), ("put", f"{P}/{RID}/entitlements/nora"),
    ("post", f"{P}/login-as"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "put") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


# --- reads -----------------------------------------------------------------------------------

@pytest.mark.parametrize("path,contract_cols", [
    ("list-rows", q.LIST_CONTRACT_COLS), ("tree-rows", q.TREE_CONTRACT_COLS)])
def test_rows_three_reads_orgs_and_pros_cut_to_1000(dbfake, path, contract_cols):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().get(f"{P}/{path}").json() == \
        {"orgs": [{"id": RID}], "pros": [{"id": RID}], "contracts": [{"id": RID}]}
    assert leases == [False]
    (_, o, op), (_, pr, pp), (_, c, cp) = selects(log)
    assert o.startswith(f"SELECT {select_list('organizations', q.ORG_COLS)} \n"
                        "FROM public.organizations")
    assert pr.startswith(f"SELECT {select_list('professionals', q.PRO_COLS)} \n"
                         "FROM public.professionals")
    assert c.startswith(f"SELECT {select_list('exp_contracts', contract_cols)} \n"
                        "FROM public.exp_contracts")
    assert "ORDER BY" not in o + pr + c and "WHERE" not in o + pr + c
    # limit(5000) lowered to the 1000 cap (follow-up 1j); the contracts had no limit: the cap
    assert list(op.values()) == [1000] and list(pp.values()) == [1000]
    assert list(cp.values()) == [1000]


def test_rows_contracts_error_ignored_orgs_error_thrown(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied") \
        if "exp_contracts" in s else []
    assert client().get(f"{P}/list-rows").json() == {"orgs": [], "pros": [], "contracts": []}
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied") \
        if "public.professionals" in s else []
    assert client().get(f"{P}/tree-rows").status_code == 403


def test_discovered_counts_ilike_each_name_in_order(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"n": 7 if p["display_name_1"] == "%Acme%" else 0}]
    r = client().post(f"{P}/discovered-counts", json={"names": ["Acme", "Zed*Co"]})
    assert r.json() == [7, 0]
    (_, a, ap), (_, _, zp) = selects(log)
    assert a.startswith("SELECT count(*) AS n \nFROM public.exp_entity \n"
                        "WHERE public.exp_entity.display_name ILIKE %(display_name_1)s::VARCHAR")
    assert ap == {"display_name_1": "%Acme%", "param_1": 1000}  # the cap, on a count
    assert zp["display_name_1"] == "%Zed%Co%"  # PostgREST: `*` is `%`


def test_discovered_counts_failed_count_is_null(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.QueryCanceled("canceling statement due to "
                                                               "statement timeout") \
        if p.get("display_name_1") == "%Slow%" else [{"n": 3}]
    assert client().post(f"{P}/discovered-counts",
                         json={"names": ["Slow", "Fast"]}).json() == [None, 3]


def test_discovered_counts_no_names_no_statement(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/discovered-counts", json={"names": []}).json() == []
    assert log == []


def test_entitlements_two_reads(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"product_key": "nora"}]
    assert client().get(f"{P}/{RID}/entitlements").json() == \
        {"products": [{"product_key": "nora"}], "entitlements": [{"product_key": "nora"}]}
    (_, pr, pp), (_, e, ep) = selects(log)
    assert pp == {"param_1": 1000}
    assert pr.startswith("SELECT public.exp_products.product_key, public.exp_products.name, ")
    assert "public.exp_products.package_includes \nFROM public.exp_products \n" in pr  # `*`
    assert "WHERE public.exp_products.active IS true ORDER BY public.exp_products.sort ASC" in pr
    assert e.startswith(f"SELECT {select_list('exp_entitlements', q.ENTITLEMENT_COLS)} \n")
    assert ("WHERE public.exp_entitlements.subject_type = %(subject_type_1)s::VARCHAR AND "
            "public.exp_entitlements.subject_id = %(subject_id_1)s::VARCHAR") in e
    assert ep == {"subject_type_1": "organization", "subject_id_1": RID, "param_1": 1000}


# --- writes ----------------------------------------------------------------------------------

def test_set_entitlement_upsert(dbfake):
    log, _, leases = dbfake
    assert client().put(f"{P}/{RID}/entitlements/nora", json={"state": "active"}).json() == \
        {"ok": True}
    assert leases == [True]
    (w, sql, params), = log
    assert w is True
    assert sql == ("INSERT INTO public.exp_entitlements (subject_type, subject_id, product_key, "
                   "state, source) VALUES (%(subject_type)s::VARCHAR, %(subject_id)s::VARCHAR, "
                   "%(product_key)s::VARCHAR, %(state)s::VARCHAR, %(source)s::VARCHAR) "
                   "ON CONFLICT (subject_type, subject_id, product_key) DO UPDATE SET "
                   "state = excluded.state, source = excluded.source")
    assert params == {"subject_type": "organization", "subject_id": RID, "product_key": "nora",
                      "state": "active", "source": "console"}


def test_set_entitlement_with_tokens(dbfake):
    log, _, _ = dbfake
    client().put(f"{P}/{RID}/entitlements/nora",
                 json={"state": "entitled_unconfigured", "tokens_included": 500})
    (_, sql, params), = log
    assert sql.endswith("DO UPDATE SET state = excluded.state, source = excluded.source, "
                        "tokens_included = excluded.tokens_included")
    assert params["tokens_included"] == 500
    for bad in ({"state": "active", "tokens_included": 1.5}, {"state": "active", "source": "x"},
                {"tokens_included": 1}):
        assert client().put(f"{P}/{RID}/entitlements/nora", json=bad).status_code == 422
    assert len(log) == 1


def test_login_as_audit_row_with_actor_from_token(dbfake):
    log, _, leases = dbfake
    body = {"node_type": "professional", "node_id": RID2, "node_name": "Pat", "account_id": RID}
    assert client().post(f"{P}/login-as", json=body).json() == {"ok": True}
    assert leases == [True]
    (_, sql, params), = log
    assert sql.startswith("INSERT INTO public.audit_log (action, entity_type, entity_id, "
                          "field_changes) VALUES (")
    assert "RETURNING" not in sql
    assert isinstance(params["field_changes"], Jsonb)
    assert params["field_changes"].obj == {"actor_email": "seller@example.com",
                                           "target_name": "Pat", "account_id": RID}
    assert {k: v for k, v in params.items() if k != "field_changes"} == \
        {"action": "login_as", "entity_type": "professional", "entity_id": RID2}
    assert client().post(f"{P}/login-as", json={**body, "actor_email": "x@y"}).status_code == 422
    assert client().post(f"{P}/login-as", json={**body, "node_type": "brand"}).status_code == 422


def test_login_as_insert_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "audit_log"')
    body = {"node_type": "organization", "node_id": RID, "node_name": "A", "account_id": RID}
    assert client().post(f"{P}/login-as", json=body).status_code == 403
