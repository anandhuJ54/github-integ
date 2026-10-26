"""sales alerts endpoints (no live DB/auth): the read, the dismiss (update then a tolerated audit
insert, user_id from the token) and the allow-listed RPCs as compiled SQL. No write and no RPC —
in particular neither tick function — reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid

import psycopg
import pytest
from psycopg.types.json import Jsonb

from sales.tests.test_contracts import (
    AUTH_READ,
    AUTH_WRITE,
    RID,
    RID2,
    UID,
    install_fake_db,
    make_client,
    sqls,
)
from surfaces.sales.alert import services as q
from surfaces.sales.alert.router import router
from surfaces.sales.internal import UnknownRpc

P = "/sales/alerts"
OPP = "44444444-4444-4444-8444-444444444444"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


@pytest.mark.parametrize("path", [f"{P}/search", f"{P}/{RID}/dismiss",
                                  f"{P}/rpc/exp_alert_accept"])
def test_every_endpoint_needs_a_signed_in_user(path):
    assert make_client(router, None).post(path, json={}).status_code == 403


# --- loadAlerts ------------------------------------------------------------------------------

BASE = ("SELECT public.exp_sales_alerts.id, public.exp_sales_alerts.opportunity_id, "
        "public.exp_sales_alerts.logo, public.exp_sales_alerts.alert_type, "
        "public.exp_sales_alerts.rule, public.exp_sales_alerts.body, "
        "public.exp_sales_alerts.severity, public.exp_sales_alerts.owner_id, "
        "public.exp_sales_alerts.is_nora_suggested, public.exp_sales_alerts.suggested_task, "
        "public.exp_sales_alerts.accepted_task_id, public.exp_sales_alerts.created_at \n"
        "FROM public.exp_sales_alerts \n"
        "WHERE public.exp_sales_alerts.dismissed_at IS NULL "
        "AND public.exp_sales_alerts.accepted_task_id IS NULL")
TAIL = " ORDER BY public.exp_sales_alerts.created_at DESC \n LIMIT %(param_1)s::INTEGER"


def test_no_filter(dbfake):
    log, state, leases = dbfake
    row = {"id": uuid.UUID(RID), "opportunity_id": None, "is_nora_suggested": True,
           "suggested_task": {"title": "Call", "due_in_days": 2},
           "created_at": dt.datetime(2026, 10, 2, tzinfo=dt.UTC)}
    state["answer"] = lambda s, p: [row]
    assert client().post(f"{P}/search", json={}).json() == [{
        "id": RID, "opportunity_id": None, "is_nora_suggested": True,
        "suggested_task": {"title": "Call", "due_in_days": 2},
        "created_at": "2026-10-02T00:00:00+00:00"}]
    assert leases == [AUTH_READ]
    (_, sql, params), = log
    assert sql == BASE + TAIL
    assert params == {"param_1": 100}


def test_each_filter_in_the_pages_order(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/search", json={"opportunity_id": OPP, "owner_id": RID2,
                                       "opportunity_ids": [OPP, RID]})
    (_, sql, params), = log
    assert sql == (BASE + " AND public.exp_sales_alerts.opportunity_id = "
                   "%(opportunity_id_1)s::UUID AND public.exp_sales_alerts.owner_id = "
                   "%(owner_id_1)s::UUID AND public.exp_sales_alerts.opportunity_id IN "
                   "(%(opportunity_id_2_1)s::UUID, %(opportunity_id_2_2)s::UUID)" + TAIL)
    assert params == {"opportunity_id_1": OPP, "owner_id_1": RID2, "opportunity_id_2_1": OPP,
                      "opportunity_id_2_2": RID, "param_1": 100}


def test_empty_id_list_matches_the_zero_uuid_and_falsy_ids_are_ignored(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/search", json={"opportunity_id": "", "owner_id": None,
                                       "opportunity_ids": []})
    (_, sql, params), = log
    assert "opportunity_id = %(opportunity_id_1)s::UUID" in sql and "owner_id" not in \
        sql.split("FROM", 1)[1]
    assert params["opportunity_id_1"] == q.NO_OPPORTUNITY


def test_search_refuses_other_fields(dbfake):
    log, _, leases = dbfake
    assert client().post(f"{P}/search", json={"dismissed": True}).status_code == 422
    assert log == [] and leases == []


# --- dismissAlert ----------------------------------------------------------------------------

def test_dismiss_updates_then_audits_as_the_caller(dbfake):
    log, _, leases = dbfake
    before = dt.datetime.now(dt.UTC)
    r = client().post(f"{P}/{RID}/dismiss", json={"opportunity_id": OPP, "rule": "new_claim"})
    assert r.json() == {"ok": True} and leases == [AUTH_WRITE]
    (_, upd, up), (_, ins, ip) = [e for e in log if "savepoint" not in e[1]]
    assert upd == ("UPDATE public.exp_sales_alerts SET acknowledged=%(acknowledged)s, "
                   "dismissed_at=%(dismissed_at)s::TIMESTAMP WITH TIME ZONE "
                   "WHERE public.exp_sales_alerts.id = "
                   "%(id_1)s::UUID")
    assert up["acknowledged"] is True and up["id_1"] == RID
    assert before <= up["dismissed_at"] <= dt.datetime.now(dt.UTC)
    assert ins.startswith("INSERT INTO public.audit_log (user_id, action, entity_type, "
                          "entity_id, field_changes) VALUES")
    assert "RETURNING" not in ins
    assert ip["user_id_m0"] == UID and ip["action_m0"] == "sales_alert_dismissed"
    assert ip["entity_type_m0"] == "opportunity" and ip["entity_id_m0"] == OPP
    assert isinstance(ip["field_changes_m0"], Jsonb)
    assert ip["field_changes_m0"].obj == {"alert_id": RID, "rule": "new_claim"}


def test_dismiss_ignores_a_failed_audit_insert(dbfake):
    log, state, _ = dbfake

    def answer(sql, params):
        if sql.startswith("INSERT INTO public.audit_log"):
            return psycopg.errors.InsufficientPrivilege("permission denied for table audit_log")
        return []

    state["answer"] = answer
    assert client().post(f"{P}/{RID}/dismiss", json={"opportunity_id": None,
                                                     "rule": None}).json() == {"ok": True}
    assert [s.split()[0] for s in sqls(log)] == ["UPDATE", "INSERT"]


def test_dismiss_update_error_reaches_the_page_and_skips_the_audit(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "permission denied for table exp_sales_alerts")
    assert client().post(f"{P}/{RID}/dismiss", json={}).status_code == 403
    assert [s.split()[0] for s in sqls(log)] == ["UPDATE"]


def test_dismiss_refuses_a_user_id_from_the_page(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/{RID}/dismiss", json={"user_id": RID2}).status_code == 422
    assert log == []


# --- RPCs (compiled only; the ticks are never run) -------------------------------------------

def test_allow_list_is_what_the_browser_sends():
    # live (pg_proc at port time): exp_alert_accept(p_alert uuid);
    # exp_alerts_generate / exp_task_reminders_tick(p_now timestamptz DEFAULT now()). The
    # browser never sends p_now, so it is not accepted.
    assert q.ALERT_RPCS == {"exp_alert_accept": [("p_alert", "uuid")],
                            "exp_alerts_generate": [], "exp_task_reminders_tick": []}


def test_rpc_sql():
    assert q.rpc_sql("exp_alert_accept", {"p_alert": RID}) == (
        "select public.exp_alert_accept(p_alert => %(p_alert)s::uuid) as v", {"p_alert": RID})
    assert q.rpc_sql("exp_alerts_generate", {}) == (
        "select public.exp_alerts_generate() as v", {})
    assert q.rpc_sql("exp_task_reminders_tick", {}) == (
        "select public.exp_task_reminders_tick() as v", {})


@pytest.mark.parametrize("name,args,why", [
    ("exp_alerts_generate", {"p_now": "2030-01-01T00:00:00Z"}, "unknown parameter"),
    ("exp_task_reminders_tick", {"p_now": "2030-01-01T00:00:00Z"}, "unknown parameter"),
    ("exp_email_outbox_drain", {}, "unknown function"),
    ("exp_opp_create", {}, "unknown function"),
    ("exp_alert_accept", {"p_alert": 1}, "must be a string"),
])
def test_rpc_refusals(name, args, why):
    with pytest.raises(UnknownRpc, match=why):
        q.rpc_sql(name, args)


def test_rpc_endpoint_runs_as_the_user(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": uuid.UUID(RID2)}]
    assert client().post(f"{P}/rpc/exp_alert_accept",
                         json={"args": {"p_alert": RID}}).json() == RID2
    assert leases == [AUTH_WRITE]
    state["answer"] = lambda s, p: [{"v": 3}]
    assert client().post(f"{P}/rpc/exp_alerts_generate", json={"args": {}}).json() == 3
    assert [s for _, s, _ in log] == [
        "select public.exp_alert_accept(p_alert => %(p_alert)s::uuid) as v",
        "select public.exp_alerts_generate() as v"]


def test_rpc_refused_before_a_connection(dbfake):
    log, _, leases = dbfake
    assert client().post(f"{P}/rpc/exp_task_reminders_tick",
                         json={"args": {"p_now": "2030-01-01"}}).status_code == 400
    assert client().post(f"{P}/rpc/exp_alert_accept", json={"x": 1}).status_code == 422
    assert leases == [] and log == []


def test_rpc_error_message_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("alert already accepted")
    r = client().post(f"{P}/rpc/exp_alert_accept", json={"args": {"p_alert": RID}})
    assert r.status_code == 400 and r.json()["detail"] == "alert already accepted"
