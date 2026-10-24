"""sales SRE console endpoints (no live DB/auth): the SQL each one sends and what it answers;
occurred_at / redeemed_at from the server's clock. No write reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

import psycopg
import pytest
from psycopg.types.json import Jsonb

from sales.queries import sre as q
from sales.queries.contracts_test import (
    AUTH_READ,
    AUTH_WRITE,
    RID,
    install_fake_db,
    make_client,
    sqls,
    table_of,
)
from sales.routers.sre_data import router

P = "/sales/sre"
REP = "c1000000-0000-4000-8000-000000000001"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/reps/{REP}"), ("get", f"{P}/promo-code?seller_id={REP}"),
    ("get", f"{P}/queues?seller_id={REP}"), ("post", f"{P}/call-outcomes"),
    ("post", f"{P}/promo-redemptions"), ("post", f"{P}/trial-extensions"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method == "post" else {}
    assert getattr(make_client(router, None), method)(path, **kw).status_code == 403


# --- reads -----------------------------------------------------------------------------------

def test_rep_by_id_maybe_single(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(REP), "name": "SRE", "role": "srx"}]
    assert client().get(f"{P}/reps/{REP}").json() == {"id": REP, "name": "SRE", "role": "srx"}
    assert leases == [AUTH_READ]
    (_, sql, params), = log
    assert sql == ("SELECT public.exp_sales_reps.id, public.exp_sales_reps.name, "
                   "public.exp_sales_reps.role \nFROM public.exp_sales_reps \n"
                   "WHERE public.exp_sales_reps.id = %(id_1)s::UUID \n LIMIT %(param_1)s::INTEGER")
    assert params == {"id_1": REP, "param_1": 2}
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/reps/{REP}").json() is None
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get(f"{P}/reps/{REP}").status_code == 406


def test_promo_code_one_active_of_the_seller(dbfake):
    log, state, _ = dbfake
    row = {"code": "SRE10", "discount_pct": Decimal(10), "active": True,
           "seller_id": uuid.UUID(REP)}
    state["answer"] = lambda s, p: [row]
    assert client().get(f"{P}/promo-code", params={"seller_id": REP}).json() == {
        "code": "SRE10", "discount_pct": 10, "active": True, "seller_id": REP}
    (_, sql, params), = log
    assert "FROM public.exp_promo_codes" in sql
    assert "WHERE public.exp_promo_codes.seller_id = %(seller_id_1)s::UUID " \
           "AND public.exp_promo_codes.active IS true" in sql
    assert "ORDER BY" not in sql and params["param_1"] == 1
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/promo-code", params={"seller_id": REP}).json() is None


def test_queues_three_reads_250_each_oldest_first(dbfake):
    log, state, leases = dbfake
    t = dt.datetime(2026, 10, 1, 12, 0, 0, 250000, tzinfo=dt.UTC)
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "event_type": p["event_type_1"],
                                     "occurred_at": t}]
    out = client().get(f"{P}/queues", params={"seller_id": REP}).json()
    assert list(out) == ["attempted", "engaged", "lapsed_no_upgrade"]
    assert out["engaged"] == [{"id": RID, "event_type": "engaged",
                               "occurred_at": "2026-10-01T12:00:00.25+00:00"}]
    assert leases == [AUTH_READ]
    got = sqls(log)
    assert len(got) == 3 and all(table_of(s) == "exp_claim_events" for s in got)
    for s in got:
        assert "ORDER BY public.exp_claim_events.occurred_at ASC" in s
    assert "nora_engagement > %(nora_engagement_1)s" in got[1]
    assert "nora_engagement >" not in got[0] and "nora_engagement >" not in got[2]
    params = [p for _, s, p in log if "savepoint" not in s]
    assert [p["event_type_1"] for p in params] == list(q.QUEUES)
    assert all(p["seller_id_1"] == REP and p["param_1"] == 250 for p in params)
    assert params[1]["nora_engagement_1"] == 0


def test_queue_select_list_is_the_pages():
    sql = str(q.queue_stmt(REP, "attempted"))
    assert sql.startswith("SELECT public.exp_claim_events.id, public.exp_claim_events.entity_type")
    assert sql.count("public.exp_claim_events.") >= 13 + 3


def test_read_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"{P}/reps/{REP}").status_code == 403


# --- writes ----------------------------------------------------------------------------------

def test_log_call_outcome_stamps_occurred_at_and_wraps_value(dbfake):
    log, _, leases = dbfake
    before = dt.datetime.now(dt.UTC)
    r = client().post(f"{P}/call-outcomes", json={
        "event_type": "call_reached", "subject_type": "claim", "subject_id": "ent-1",
        "actor": "SRE", "source": "manual", "value": {"entity_label": "Acme", "queue": "attempted"}})
    assert r.json() == {"ok": True} and leases == [AUTH_WRITE]
    (_, sql, params), = log
    assert sql.startswith("INSERT INTO public.exp_activity_events (event_type, subject_type, "
                          "subject_id, actor, value, occurred_at, source) VALUES")
    assert "RETURNING" not in sql
    assert isinstance(params["value_m0"], Jsonb)
    assert params["value_m0"].obj == {"entity_label": "Acme", "queue": "attempted"}
    assert before <= params["occurred_at_m0"] <= dt.datetime.now(dt.UTC)


def test_log_call_outcome_refuses_other_columns_and_a_page_clock(dbfake):
    log, _, leases = dbfake
    for extra in ({"occurred_at": "2020-01-01"}, {"is_demo": True}):
        r = client().post(f"{P}/call-outcomes", json={"event_type": "call_reached", **extra})
        assert r.status_code == 422
    assert log == [] and leases == []


def test_send_promo_code_stamps_redeemed_at(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/promo-redemptions",
                         json={"code": "SRE10", "subject_id": "ent-1"}).json() == {"ok": True}
    (_, sql, params), = log
    assert sql.startswith("INSERT INTO public.exp_promo_redemptions (code, subject_id, "
                          "redeemed_at) VALUES")
    assert params["code_m0"] == "SRE10" and isinstance(params["redeemed_at_m0"], dt.datetime)
    assert client().post(f"{P}/promo-redemptions",
                         json={"code": "X", "redeemed_at": "2020-01-01"}).status_code == 422


def test_extend_trial_is_the_pages_insert(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/trial-extensions", json={
        "subject_id": "ent-1", "days": 7, "granted_by": REP,
        "reason": "SRE call console"}).json() == {"ok": True}
    (_, sql, params), = log
    assert sql.startswith("INSERT INTO public.exp_trial_extensions (subject_id, days, "
                          "granted_by, reason) VALUES")
    assert params == {"subject_id_m0": "ent-1", "days_m0": 7, "granted_by_m0": REP,
                      "reason_m0": "SRE call console"}
    assert client().post(f"{P}/trial-extensions",
                         json={"subject_id": "x", "days": 2.5}).status_code == 422


def test_write_refused_is_403(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "new row violates row-level security policy")
    assert client().post(f"{P}/call-outcomes",
                         json={"event_type": "call_reached"}).status_code == 403
