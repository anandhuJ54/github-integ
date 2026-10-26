"""Public signing endpoints (no live DB): both run as `anon` with no sign-in, only the two
allow-listed functions are reachable, and the calls compile as the page sent them. Neither
function is ever called against a database here."""
from __future__ import annotations

import psycopg
import pytest
from surfaces.sales.queries import sign as q
from surfaces.sales.routers.sign_public import router

from sales.tests.test_contracts import install_fake_db, make_client

P = "/sales/sign"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


TOKEN = "tok_0123456789abcdef"
SIGNED = {"token": TOKEN, "type": "typed", "data": "Pat Signer", "identity": "email_link",
          "ip": None, "ua": "Mozilla/5.0"}


def client():
    return make_client(router, None)  # no current_user override: there is no sign-in


def test_fetch_sql():
    sql = "select public.m4_signer_fetch(p_token => %(p_token)s::text) as v"
    assert q.signer_fetch_sql(TOKEN) == (sql, {"p_token": TOKEN})


def test_record_sql_in_the_function_order():
    args = {"p_token": TOKEN, "p_type": "typed", "p_data": "Pat Signer",
            "p_identity": "email_link", "p_ip": None, "p_ua": "UA"}
    sql = ("select public.m4_record_signature(p_token => %(p_token)s::text, "
           "p_type => %(p_type)s::text, p_data => %(p_data)s::text, "
           "p_identity => %(p_identity)s::text, p_ip => %(p_ip)s::text, p_ua => %(p_ua)s::text) as v")
    assert q.record_signature_sql(args) == (sql, args)


def test_only_the_two_functions():
    assert set(q.SIGN_RPCS) == {"m4_signer_fetch", "m4_record_signature"}


def test_fetch_runs_as_anon_without_a_sign_in(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": {"error": "invalid"}}]
    r = client().post(f"{P}/fetch", json={"token": TOKEN})
    assert r.status_code == 200 and r.json() == {"error": "invalid"}
    assert leases == [("anon", False)]
    (_, sql, params), = log
    assert sql.startswith("select public.m4_signer_fetch(") and params == {"p_token": TOKEN}


def test_fetch_ignores_a_signed_in_token(dbfake):
    _, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": {"error": "invalid"}}]
    r = client().post(f"{P}/fetch", json={"token": TOKEN},
                      headers={"authorization": "Bearer not-even-checked"})
    assert r.status_code == 200 and leases == [("anon", False)]


def test_record_runs_as_anon_on_the_primary(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": {"ok": True, "remaining": 0}}]
    assert client().post(f"{P}/record", json=SIGNED).json() == {"ok": True, "remaining": 0}
    assert leases == [("anon", True)]
    (_, sql, params), = log
    assert sql.startswith("select public.m4_record_signature(")
    assert params == {"p_token": TOKEN, "p_type": "typed", "p_data": "Pat Signer",
                      "p_identity": "email_link", "p_ip": None, "p_ua": "Mozilla/5.0"}


@pytest.mark.parametrize("path,body", [
    ("fetch", {}), ("fetch", {"token": ""}), ("fetch", {"token": "x" * 513}),
    ("fetch", {"token": TOKEN, "p_token": "y"}),
    ("record", {k: v for k, v in SIGNED.items() if k != "ua"}),
    ("record", {**SIGNED, "status": "signed"}),
    ("record", {**SIGNED, "data": "x" * 10_001}),
])
def test_bad_bodies_are_refused_before_a_connection(dbfake, path, body):
    log, _, leases = dbfake
    assert client().post(f"{P}/{path}", json=body).status_code == 422
    assert log == [] and leases == []


def test_database_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("signature already recorded")
    r = client().post(f"{P}/record", json=SIGNED)
    assert r.status_code == 400 and r.json()["detail"] == "signature already recorded"
