"""sales CSM endpoints (no live DB/auth): the SQL each one sends and what it answers;
`assigned_by` from the token. No write reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid

import psycopg
import pytest

from sales.tests.test_contracts import (
    AUTH_READ,
    AUTH_WRITE,
    CLAIMS,
    EMAIL,
    ORG,
    RID,
    UID,
    install_fake_db,
    make_client,
)
from surfaces.sales.csm import services as q
from surfaces.sales.csm.router import router

P = "/sales/csm"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client(claims=CLAIMS):
    return make_client(router, claims)


@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/assignments"), ("get", f"{P}/assignments/{ORG}"),
    ("put", f"{P}/assignments/{ORG}"), ("delete", f"{P}/assignments/{ORG}"),
    ("get", f"{P}/candidates"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method == "put" else {}
    assert getattr(client(None), method)(path, **kw).status_code == 403


def test_list_active_organization_assignments(dbfake):
    log, state, leases = dbfake
    row = {"id": uuid.UUID(RID), "subject_id": ORG, "csm_user_ref": UID,
           "assigned_at": dt.datetime(2026, 10, 1, 12, tzinfo=dt.UTC)}
    state["answer"] = lambda s, p: [row]
    assert client().get(f"{P}/assignments").json() == [
        {"id": RID, "subject_id": ORG, "csm_user_ref": UID,
         "assigned_at": "2026-10-01T12:00:00+00:00"}]
    assert leases == [AUTH_READ]
    (_, sql, params), = log
    assert sql.startswith("SELECT public.exp_csm_assignments.id, ")
    assert ("WHERE public.exp_csm_assignments.subject_type = %(subject_type_1)s::VARCHAR "
            "AND public.exp_csm_assignments.active IS true") in sql
    assert params == {"subject_type_1": "organization", "param_1": 1000}


def test_account_csm_maybe_single(dbfake):
    log, state, _ = dbfake
    assert client().get(f"{P}/assignments/{ORG}").json() is None
    (_, sql, params), = log
    assert ("WHERE public.exp_csm_assignments.subject_type = %(subject_type_1)s::VARCHAR "
            "AND public.exp_csm_assignments.subject_id = %(subject_id_1)s::VARCHAR "
            "AND public.exp_csm_assignments.active IS true") in sql
    assert params == {"subject_type_1": "organization", "subject_id_1": ORG, "param_1": 2}
    state["answer"] = lambda s, p: [{"id": RID}]
    assert client().get(f"{P}/assignments/{ORG}").json() == {"id": RID}
    state["answer"] = lambda s, p: [{"id": RID}, {"id": RID}]
    assert client().get(f"{P}/assignments/{ORG}").status_code == 406


CLEAR_SQL = ("UPDATE public.exp_csm_assignments SET active=%(active)s "
             "WHERE public.exp_csm_assignments.subject_type = %(subject_type_1)s::VARCHAR "
             "AND public.exp_csm_assignments.subject_id = %(subject_id_1)s::VARCHAR "
             "AND public.exp_csm_assignments.active IS true")


def test_clear(dbfake):
    log, _, _ = dbfake
    assert client().delete(f"{P}/assignments/{ORG}").json() == {"ok": True}
    (lease, sql, params), = log
    assert lease == AUTH_WRITE
    assert sql == CLEAR_SQL
    assert params == {"active": False, "subject_type_1": "organization", "subject_id_1": ORG}


USER = {"user_ref": "u-2", "name": "csm", "email": "csm@example.com"}


def test_assign_clears_then_inserts_in_one_transaction_with_assigned_by_email(dbfake):
    log, _, leases = dbfake
    assert client().put(f"{P}/assignments/{ORG}", json=USER).json() == {"ok": True}
    assert leases == [AUTH_WRITE]  # one lease: both statements in one transaction
    (_, clear_sql, _), (_, ins, ip) = log
    assert clear_sql == CLEAR_SQL
    assert ins.startswith("INSERT INTO public.exp_csm_assignments ") and "RETURNING" not in ins
    assert ip == {"subject_type": "organization", "subject_id": ORG, "csm_user_ref": "u-2",
                  "csm_name": "csm", "csm_email": "csm@example.com", "assigned_by": EMAIL,
                  "active": True}


def test_assign_falls_back_to_the_user_id_without_an_email(dbfake):
    log, state, _ = dbfake
    state["claims"] = {k: v for k, v in CLAIMS.items() if k != "email"}
    r = client(state["claims"]).put(f"{P}/assignments/{ORG}", json=USER)
    assert r.json() == {"ok": True}
    assert log[-1][2]["assigned_by"] == UID


def test_assign_refuses_assigned_by_and_other_columns(dbfake):
    log, _, _ = dbfake
    assert client().put(f"{P}/assignments/{ORG}",
                        json={**USER, "assigned_by": "someone"}).status_code == 422
    assert client().put(f"{P}/assignments/{ORG}",
                        json={"user_ref": "u", "name": None}).status_code == 422
    assert log == []


def test_candidates_two_columns_capped(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"user_id": uuid.UUID(UID), "email": EMAIL}]
    assert client().get(f"{P}/candidates").json() == [{"user_id": UID, "email": EMAIL}]
    assert leases == [AUTH_READ]
    (_, sql, _), = log
    assert sql == "select user_id, email from public.list_control_users() limit 1000"
    assert q.CONTROL_USERS_SQL == sql


def test_candidates_forbidden_reaches_the_page(dbfake):
    """RAISE EXCEPTION 'forbidden' (P0001): PostgREST answered 400 with the message."""
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("forbidden")
    r = client().get(f"{P}/candidates")
    assert r.status_code == 400 and r.json()["detail"] == "forbidden"
