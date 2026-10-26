"""sales worklist RPC endpoints (no live DB/auth): each allow-listed function as compiled SQL,
typed as the live signature, run as the signed-in user. No function reaches a database here."""
from __future__ import annotations

import psycopg
import pytest

from sales.tests.test_contracts import (
    AUTH_WRITE,
    ORG,
    RID,
    RID2,
    install_fake_db,
    make_client,
)
from surfaces.sales.queries import worklist as q
from surfaces.sales.queries.contracts import UnknownRpc
from surfaces.sales.routers.worklist_data import router

P = "/sales/worklist"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


def test_needs_a_signed_in_user():
    assert make_client(router, None).post(f"{P}/rpc/exp_opp_create",
                                          json={"args": {}}).status_code == 403


def test_allow_list_matches_the_live_signatures():
    # pg_get_function_identity_arguments(oid), read-only at port time
    live = {
        "exp_claim_set_contact": "p_event uuid, p_phone text, p_email text, "
                                 "p_claimed_override boolean",
        "exp_claim_queue_verification": "p_events uuid[]",
        "exp_opp_create": "p_org_id uuid, p_account_id uuid, p_owner text, p_source text",
    }
    assert {n: ", ".join(f"{p} {t}" for p, t in ps) for n, ps in q.WORKLIST_RPCS.items()} == live


def test_set_contact_sql():
    sql, params = q.rpc_sql("exp_claim_set_contact", {
        "p_event": RID, "p_phone": "+15555550100", "p_email": "a@example.com",
        "p_claimed_override": True})
    assert sql == ("select public.exp_claim_set_contact(p_event => %(p_event)s::uuid, "
                   "p_phone => %(p_phone)s::text, p_email => %(p_email)s::text, "
                   "p_claimed_override => %(p_claimed_override)s::boolean) as v")
    assert params == {"p_event": RID, "p_phone": "+15555550100", "p_email": "a@example.com",
                      "p_claimed_override": True}


def test_queue_verification_sql_binds_a_list():
    sql, params = q.rpc_sql("exp_claim_queue_verification", {"p_events": [RID, RID2]})
    assert sql == ("select public.exp_claim_queue_verification("
                   "p_events => %(p_events)s::uuid[]) as v")
    assert params == {"p_events": [RID, RID2]}


def test_opp_create_sql_keeps_the_pages_owner_and_null_account():
    sql, params = q.rpc_sql("exp_opp_create", {"p_org_id": ORG, "p_account_id": None,
                                               "p_owner": None, "p_source": "seller"})
    assert sql == ("select public.exp_opp_create(p_org_id => %(p_org_id)s::uuid, "
                   "p_account_id => %(p_account_id)s::uuid, p_owner => %(p_owner)s::text, "
                   "p_source => %(p_source)s::text) as v")
    assert params == {"p_org_id": ORG, "p_account_id": None, "p_owner": None,
                      "p_source": "seller"}


@pytest.mark.parametrize("name,args,why", [
    ("exp_claim_events_purge", {}, "unknown function"),
    ("exp_alerts_generate", {}, "unknown function"),
    ("exp_opp_create", {"p_org_id": ORG, "p_stage": "won"}, "unknown parameter"),
    ("exp_claim_set_contact", {"p_event": RID, "p_claimed_override": "true"}, "true or false"),
    ("exp_claim_set_contact", {"p_event": RID, "p_claimed_override": 1}, "true or false"),
    ("exp_claim_queue_verification", {"p_events": RID}, "list of strings"),
    ("exp_claim_queue_verification", {"p_events": [RID, 5]}, "list of strings"),
    ("exp_opp_create", {"p_org_id": 7}, "must be a string"),
])
def test_refusals(name, args, why):
    with pytest.raises(UnknownRpc, match=why):
        q.rpc_sql(name, args)


def test_endpoint_runs_as_the_user_and_returns_the_value(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"v": {"id": RID, "created": False}}]
    r = client().post(f"{P}/rpc/exp_opp_create", json={"args": {
        "p_org_id": ORG, "p_account_id": None, "p_owner": "rep-1", "p_source": "seller"}})
    assert r.status_code == 200 and r.json() == {"id": RID, "created": False}
    assert leases == [AUTH_WRITE]
    (_, sql, params), = log
    assert sql.startswith("select public.exp_opp_create(") and params["p_owner"] == "rep-1"
    state["answer"] = lambda s, p: [{"v": 2}]
    assert client().post(f"{P}/rpc/exp_claim_queue_verification",
                         json={"args": {"p_events": [RID]}}).json() == 2


def test_refused_before_a_connection(dbfake):
    log, _, leases = dbfake
    assert client().post(f"{P}/rpc/exp_alert_accept",
                         json={"args": {"p_alert": RID}}).status_code == 400
    assert client().post(f"{P}/rpc/exp_opp_create", json={"args": {}, "x": 1}).status_code == 422
    assert leases == [] and log == []


def test_error_message_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.RaiseException("claim event not found")
    r = client().post(f"{P}/rpc/exp_claim_set_contact", json={"args": {
        "p_event": RID, "p_phone": "", "p_email": "", "p_claimed_override": False}})
    assert r.status_code == 400 and r.json()["detail"] == "claim event not found"
