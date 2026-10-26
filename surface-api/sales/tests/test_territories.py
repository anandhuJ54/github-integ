"""sales territories endpoints (no live DB/auth): every read as compiled SQL with its tolerance,
every write as compiled SQL (never run), the server clock / token for reviewed_at, period_start
and created_by, and the generate RPCs compiled only — neither exp_generate_territories nor
exp_generate_group_territories reaches a database here."""
from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal

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
from surfaces.sales.queries import territories as q
from surfaces.sales.queries.contracts import UnknownRpc
from surfaces.sales.routers.territories_data import router

P = "/sales/territories"
ORG = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


def params(log):
    """The bound parameters of each statement (savepoints left out)."""
    return [p for _, s, p in log if "savepoint" not in s]


def boom():
    return psycopg.errors.InsufficientPrivilege("permission denied for table x")


ENDPOINTS = [
    ("get", "/categories"), ("get", "/slots"), ("get", "/list?period_start=2026-10-01"),
    ("get", "/rules"), ("get", "/reps"), ("get", "/reps/nora"), ("patch", f"/reps/{RID}"),
    ("get", "/quotas?period_start=2026-10-01"), ("put", "/quotas"), ("get", "/routing-state"),
    ("post", "/brands/search"), ("post", "/ramps/search"), ("get", "/org-search?term=re"),
    ("get", "/next-seq?group_key=g&tier=ENT"), ("get", "/group-gcid?group_key=g"),
    ("get", "/groups"), ("get", "/logo-profiles"), ("get", "/group-profiles?group_key=g"),
    ("get", "/proposals"), ("post", "/proposals"), ("post", f"/proposals/{RID}/review"),
    ("get", "/seats?group_key=g"), ("post", "/seats"), ("patch", f"/seats/{RID}"),
    ("delete", f"/seats/{RID}"), ("post", "/rpc/exp_generate_territories"), ("post", "/slots"),
    ("get", f"/slots/{RID}/label"), ("patch", f"/slots/{RID}"), ("delete", f"/slots/{RID}"),
    ("post", f"/slots/{RID}/brands"), ("delete", f"/slots/{RID}/brands"),
    ("delete", f"/slots/{RID}/assignments?types=account"), ("post", f"/slots/{RID}/assignments"),
    ("delete", f"/slots/{RID}/ramps"), ("post", f"/slots/{RID}/ramps"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS)
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(make_client(router, None), method)(P + path, **kw).status_code == 403


# --- reads -----------------------------------------------------------------------------------

def test_categories_gcids_then_names_of_all_but_the_catchall(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: (
        [{"gcid": "*"}, {"gcid": "gcid:bakery"}, {"gcid": "gcid:bakery"}, {"gcid": None}]
        if "exp_territories" in s else [{"gcid": "gcid:bakery", "display_name": "Bakery"}])
    assert client().get(f"{P}/categories").json() == {
        "territories": [{"gcid": "*"}, {"gcid": "gcid:bakery"}, {"gcid": "gcid:bakery"},
                        {"gcid": None}],
        "cats": [{"gcid": "gcid:bakery", "display_name": "Bakery"}]}
    assert leases == [AUTH_READ]
    t, c = sqls(log)
    assert t == ("SELECT public.exp_territories.gcid \nFROM public.exp_territories "
                 "ORDER BY public.exp_territories.gcid ASC \n LIMIT %(param_1)s::INTEGER")
    assert c.startswith("SELECT public.gbp_categories.gcid, public.gbp_categories.display_name \n"
                        "FROM public.gbp_categories \nWHERE public.gbp_categories.gcid IN (")
    names = [v for k, v in log[-2][2].items() if k.startswith("gcid_")]
    assert names == ["gcid:bakery", None]  # null gcids are asked for, as the browser did


def test_categories_only_catchall_skips_the_names_and_names_error_is_ignored(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"gcid": "*"}]
    assert client().get(f"{P}/categories").json() == {"territories": [{"gcid": "*"}], "cats": []}
    assert len(sqls(log)) == 1
    state["answer"] = lambda s, p: boom() if "gbp_categories" in s else [{"gcid": "g"}]
    assert client().get(f"{P}/categories").json()["cats"] == []


def test_slots_filters_only_when_given(dbfake):
    log, _, _ = dbfake
    client().get(f"{P}/slots")
    client().get(f"{P}/slots?gcid=gcid:bakery")
    client().get(f"{P}/slots?group_key=bakeries")
    a, b, c = sqls(log)
    assert "WHERE" not in a
    assert a.endswith("ORDER BY public.exp_territories.tier ASC, public.exp_territories.seq ASC"
                      " \n LIMIT %(param_1)s::INTEGER")
    assert "WHERE public.exp_territories.gcid = %(gcid_1)s::VARCHAR" in b
    assert "WHERE public.exp_territories.group_key = %(group_key_1)s::VARCHAR" in c


def test_slots_error_reaches_the_page(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/slots").status_code == 403


def test_label_maybe_single_ignored_error(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "label": "L", "tier": "ENT",
                                     "seller_id": None}]
    assert client().get(f"{P}/slots/{RID}/label").json() == {
        "id": RID, "label": "L", "tier": "ENT", "seller_id": None}
    assert "LIMIT %(param_1)s::INTEGER" in sqls(log)[0]
    assert params(log)[0]["param_1"] == 2
    state["answer"] = lambda s, p: [{"id": RID}, {"id": RID2}]
    assert client().get(f"{P}/slots/{RID}/label").json() is None  # 406 → data null
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/slots/{RID}/label").json() is None


def test_rules_reps_routing(dbfake):
    log, _, _ = dbfake
    client().get(f"{P}/rules")
    client().get(f"{P}/reps")
    client().get(f"{P}/routing-state")
    r, reps, rs = sqls(log)
    assert r.startswith("SELECT public.exp_territory_rules.tier") and "ORDER BY" not in r
    assert reps.startswith("SELECT public.exp_sales_reps.id, public.exp_sales_reps.name, "
                           "public.exp_sales_reps.email, public.exp_sales_reps.role, "
                           "public.exp_sales_reps.group_key, public.exp_sales_reps.on_duty, "
                           "public.exp_sales_reps.backup_rep_id, public.exp_sales_reps.is_demo \n")
    assert "ORDER BY public.exp_sales_reps.name ASC" in reps
    assert "FROM public.exp_lead_routing_state" in rs


def test_nora_rep_ilike_limit_one_tolerant(dbfake):
    log, state, _ = dbfake
    client().get(f"{P}/reps/nora")
    s, = sqls(log)
    assert "WHERE public.exp_sales_reps.role ILIKE %(role_1)s::VARCHAR" in s
    assert params(log)[0] == {"role_1": "nora", "param_1": 1}
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/reps/nora").json() == []


def test_current_quotas_period_as_a_date(dbfake):
    log, _, _ = dbfake
    client().get(f"{P}/quotas?period_start=2026-10-01")
    s, = sqls(log)
    assert "WHERE public.exp_sales_quotas.period_start = %(param_1)s::DATE" in s
    assert log[0][2]["param_1"] == dt.date(2026, 10, 1)
    assert client().get(f"{P}/quotas?period_start=nope").status_code == 422


def test_all_territories_reads_and_brands_of_every_territory(dbfake):
    log, state, leases = dbfake

    def answer(s, p):
        if "FROM public.exp_territories" in s:
            return [{"id": uuid.UUID(RID)}, {"id": uuid.UUID(RID2)}]
        if "exp_category_groups" in s:
            return boom()  # ignored, as `groups.data ?? []`
        if "exp_territory_brand" in s:
            return [{"territory_id": RID, "org_id": ORG, "lane": "ENT"}]
        return [{"x": Decimal("1.50")}]
    state["answer"] = answer
    out = client().get(f"{P}/list?period_start=2026-10-01").json()
    assert out == {"territories": [{"id": RID}, {"id": RID2}], "groups": [],
                   "reps": [{"x": 1.5}], "assignments": [{"x": 1.5}], "quotas": [{"x": 1.5}],
                   "ramps": [{"x": 1.5}],
                   "brands": [{"territory_id": RID, "org_id": ORG, "lane": "ENT"}]}
    assert leases == [AUTH_READ]
    ss = sqls(log)
    assert "ORDER BY public.exp_territories.group_key ASC, public.exp_territories.tier ASC, " \
           "public.exp_territories.seq ASC" in ss[0]
    asg = next(s for s in ss if "exp_sales_assignments" in s)
    assert "assignment_type IN (" in asg
    br = next((s, p) for _, s, p in log if "exp_territory_brand" in s)
    assert "success_handoff_at IS NULL" in br[0]
    assert [v for k, v in br[1].items() if k.startswith("territory_id_")] == [RID, RID2]


def test_all_territories_territory_or_rep_error_throws(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: boom() if "exp_sales_reps" in s else []
    assert client().get(f"{P}/list?period_start=2026-10-01").status_code == 403


def test_brands_search_empty_ids_asks_nothing(dbfake):
    log, _, _ = dbfake
    assert client().post(f"{P}/brands/search", json={"territory_ids": []}).json() == []
    assert client().post(f"{P}/ramps/search", json={"territory_ids": []}).json() == []
    assert log == []
    client().post(f"{P}/ramps/search", json={"territory_ids": [RID]})
    s, = sqls(log)
    assert s.startswith("SELECT public.exp_territory_ramps.territory_id, "
                        "public.exp_territory_ramps.rep_id, public.exp_territory_ramps.month_offset,"
                        " public.exp_territory_ramps.ramp_pct \n")
    assert "ORDER BY public.exp_territory_ramps.month_offset ASC" in s


def test_org_search_root_orgs_limit_20_tolerant(dbfake):
    log, state, _ = dbfake
    client().get(f"{P}/org-search?term=re max")
    s, = sqls(log)
    assert "public.organizations.parent_org_id IS NULL" in s
    assert "public.organizations.name ILIKE %(name_1)s::VARCHAR" in s
    assert params(log)[0] == {"name_1": "%re max%", "param_1": 20}
    assert "ORDER BY" not in s
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/org-search?term=re").json() == []


def test_next_seq_and_group_gcid_limit_one_tolerant(dbfake):
    log, state, _ = dbfake
    client().get(f"{P}/next-seq?group_key=bakeries&tier=ENT")
    client().get(f"{P}/group-gcid?group_key=bakeries")
    a, b = sqls(log)
    assert "ORDER BY public.exp_territories.seq DESC" in a
    assert "ORDER BY public.exp_category_group_members.gcid ASC" in b
    assert params(log)[0]["param_1"] == 1 and params(log)[1]["param_1"] == 1
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/next-seq?group_key=g&tier=ENT").json() == []
    assert client().get(f"{P}/group-gcid?group_key=g").json() == []


def test_logo_profiles_rpc_capped_then_stored_counts_tolerant(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: (
        boom() if "exp_territories" in s else
        [{"group_key": "g", "logo_id": uuid.UUID(RID), "logo_name": "L", "logo_gcid": "x",
          "locations": 3, "professionals": 4}])
    assert client().get(f"{P}/logo-profiles").json() == {
        "profiles": [{"group_key": "g", "logo_id": RID, "logo_name": "L", "logo_gcid": "x",
                      "locations": 3, "professionals": 4}],
        "territories": []}
    rpc, terr = sqls(log)[:2]
    assert rpc == ("SELECT anon_1.group_key, anon_1.logo_id, anon_1.logo_name, anon_1.logo_gcid, "
                   "anon_1.locations, anon_1.professionals \n"
                   "FROM public.exp_territory_logo_profiles() AS anon_1 \n"
                   " LIMIT %(param_1)s::INTEGER")
    assert params(log)[0] == {"param_1": 1000}
    assert terr.startswith("SELECT public.exp_territories.group_key, "
                           "public.exp_territories.office_count, public.exp_territories.agent_count")
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/logo-profiles").status_code == 403


def test_group_profiles(dbfake):
    log, _, leases = dbfake
    client().get(f"{P}/group-profiles?group_key=real_estate")
    s, = sqls(log)
    assert "FROM public.exp_territory_group_profiles(%(param_1)s::VARCHAR) AS anon_1" in s
    assert log[0][2] == {"param_1": "real_estate", "param_2": 1000}
    assert leases == [AUTH_READ]


def test_proposals_and_groups_reads(dbfake):
    log, state, _ = dbfake
    client().get(f"{P}/proposals")
    client().get(f"{P}/proposals?state=pending")
    client().get(f"{P}/groups")
    a, b, c = sqls(log)
    assert "WHERE" not in a and "ORDER BY public.exp_territory_proposals.created_at DESC" in a
    assert "WHERE public.exp_territory_proposals.state = %(state_1)s::VARCHAR" in b
    assert c.startswith("SELECT public.exp_category_groups.group_key, "
                        "public.exp_category_groups.label, public.exp_category_groups.is_catchall")
    state["answer"] = lambda s, p: boom()
    assert client().get(f"{P}/groups").json() == []
    assert client().get(f"{P}/proposals").status_code == 403


def test_seats_read(dbfake):
    log, _, _ = dbfake
    client().get(f"{P}/seats?group_key=bakeries")
    s, = sqls(log)
    assert "WHERE public.exp_territory_seats.group_key = %(group_key_1)s::VARCHAR" in s
    assert "ORDER BY public.exp_territory_seats.created_at ASC" in s


# --- writes (compiled only) ------------------------------------------------------------------

def test_update_rep_and_empty_patch(dbfake):
    log, _, leases = dbfake
    assert client().patch(f"{P}/reps/{RID}", json={"on_duty": False}).json() == {"ok": True}
    client().patch(f"{P}/reps/{RID}", json={"backup_rep_id": None})
    (_, a, ap), (_, b, bp) = log
    assert a == ("UPDATE public.exp_sales_reps SET on_duty=%(on_duty)s "
                 "WHERE public.exp_sales_reps.id = %(id_1)s::UUID")
    assert ap == {"on_duty": False, "id_1": RID}
    assert b.startswith("UPDATE public.exp_sales_reps SET backup_rep_id=") and bp["backup_rep_id"] is None
    assert leases == [AUTH_WRITE, AUTH_WRITE]
    log.clear()
    assert client().patch(f"{P}/reps/{RID}", json={}).json() == {"ok": True}
    assert client().patch(f"{P}/slots/{RID}", json={}).json() == {"ok": True}
    assert client().patch(f"{P}/seats/{RID}", json={}).json() == {"ok": True}
    assert log == []
    assert client().patch(f"{P}/reps/{RID}", json={"name": "x"}).status_code == 422


def test_quota_found_updates_target(dbfake, monkeypatch):
    log, state, _ = dbfake
    monkeypatch.setattr(q, "period_start", lambda: dt.date(2026, 10, 1))
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID2)}] if s.startswith("SELECT") else []
    body = {"rep_id": RID, "group_key": "bakeries", "target": 12000.5}
    assert client().put(f"{P}/quotas", json=body).json() == {"ok": True}
    find, upd = sqls(log)
    assert find == ("SELECT public.exp_sales_quotas.id \nFROM public.exp_sales_quotas \n"
                    "WHERE public.exp_sales_quotas.rep_id = %(rep_id_1)s::UUID "
                    "AND public.exp_sales_quotas.group_key = %(group_key_1)s::VARCHAR "
                    "AND public.exp_sales_quotas.period_start = %(param_1)s::DATE \n"
                    " LIMIT %(param_2)s::INTEGER")
    fp = next(p for _, s, p in log if s == find)
    assert fp == {"rep_id_1": RID, "group_key_1": "bakeries", "param_1": dt.date(2026, 10, 1),
                  "param_2": 2}
    assert upd == ("UPDATE public.exp_sales_quotas SET target=%(target)s "
                   "WHERE public.exp_sales_quotas.id = %(id_1)s::UUID")
    up = next(p for _, s, p in log if s == upd)
    assert up == {"target": Decimal("12000.5"), "id_1": RID2}


def test_quota_missing_or_two_rows_inserts_and_no_group_filter_when_not_sent(dbfake, monkeypatch):
    log, state, _ = dbfake
    monkeypatch.setattr(q, "period_start", lambda: dt.date(2026, 10, 1))
    state["answer"] = lambda s, p: [{"id": RID}, {"id": RID2}] if s.startswith("SELECT") else []
    assert client().put(f"{P}/quotas", json={"rep_id": RID, "target": 5}).json() == {"ok": True}
    find, ins = sqls(log)
    assert "group_key" not in find
    assert ins == ("INSERT INTO public.exp_sales_quotas (rep_id, period_type, period_start, target,"
                   " actual) VALUES (%(rep_id)s::UUID, %(period_type)s::VARCHAR, "
                   "%(period_start)s::DATE, %(target)s, %(actual)s)")
    ip = next(p for _, s, p in log if s == ins)
    assert ip == {"rep_id": RID, "period_type": "month", "period_start": dt.date(2026, 10, 1),
                  "target": Decimal(5), "actual": 0}
    log.clear()
    state["answer"] = lambda s, p: []
    client().put(f"{P}/quotas", json={"rep_id": RID, "group_key": "g", "target": 5})
    ins = sqls(log)[-1]
    assert ins.startswith("INSERT INTO public.exp_sales_quotas (rep_id, group_key, period_type, ")


def test_period_start_is_the_first_of_the_utc_month():
    assert q.period_start(dt.date(2026, 2, 28)) == dt.date(2026, 2, 1)
    assert q.period_start().day == 1


def test_insert_slot_returns_the_id(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    body = {"group_key": "bakeries", "gcid": "gcid:bakery", "tier": "SMB", "seq": 2,
            "label": "bakeries_SMB_2", "geo_scope": "national", "region": None,
            "status": "unassigned", "is_catchall": False, "brand_count": 0, "office_count": 0,
            "agent_count": 0}
    assert client().post(f"{P}/slots", json=body).json() == {"id": RID}
    (_, s, p), = log
    assert s.startswith("INSERT INTO public.exp_territories (label, gcid, tier, seq, status, ")
    assert s.endswith("RETURNING public.exp_territories.id")
    assert p["seq"] == 2 and p["region"] is None
    state["answer"] = lambda s, p: []
    assert client().post(f"{P}/slots", json=body).status_code == 406
    assert client().post(f"{P}/slots", json={**body, "id": RID}).status_code == 422


def test_update_slot_sent_keys_only(dbfake):
    log, _, _ = dbfake
    client().patch(f"{P}/slots/{RID}", json={"seller_id": None, "status": "unassigned"})
    (_, s, p), = log
    assert s == ("UPDATE public.exp_territories SET seller_id=%(seller_id)s::UUID, "
                 "status=%(status)s::VARCHAR WHERE public.exp_territories.id = %(id_1)s::UUID")
    assert p == {"seller_id": None, "status": "unassigned", "id_1": RID}


def test_link_brand_inserts_only_when_missing(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": RID2}] if s.startswith("SELECT") else []
    client().post(f"{P}/slots/{RID}/brands", json={"org_id": ORG, "lane": "ENT"})
    assert [s.split()[0] for s in sqls(log)] == ["SELECT"]
    log.clear()
    state["answer"] = lambda s, p: []
    client().post(f"{P}/slots/{RID}/brands", json={"org_id": ORG, "lane": "ENT"})
    find, ins = sqls(log)
    assert "territory_id = %(territory_id_1)s::UUID AND" in find
    assert ins == ("INSERT INTO public.exp_territory_brand (territory_id, org_id, lane) VALUES "
                   "(%(territory_id)s::UUID, %(org_id)s::UUID, %(lane)s::VARCHAR)")


def test_delete_flow_statements(dbfake):
    log, state, _ = dbfake
    client().delete(f"{P}/slots/{RID}/assignments?types=account&types=claims_queue")
    client().delete(f"{P}/slots/{RID}/assignments?types=account")
    client().delete(f"{P}/slots/{RID}/ramps")
    client().delete(f"{P}/slots/{RID}/ramps?rep_id={RID2}")
    client().delete(f"{P}/slots/{RID}/brands")
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID)}]
    assert client().delete(f"{P}/slots/{RID}").json() == [{"id": RID}]
    both, one, r_all, r_rep, br, slot = sqls(log)
    assert both.startswith("DELETE FROM public.exp_sales_assignments WHERE "
                           "public.exp_sales_assignments.target_ref = %(target_ref_1)s::VARCHAR "
                           "AND public.exp_sales_assignments.assignment_type IN (")
    assert one.endswith("assignment_type = %(assignment_type_1)s::VARCHAR")
    assert r_all == ("DELETE FROM public.exp_territory_ramps WHERE "
                     "public.exp_territory_ramps.territory_id = %(territory_id_1)s::UUID")
    assert r_rep.endswith("AND public.exp_territory_ramps.rep_id = %(rep_id_1)s::UUID")
    assert br.startswith("DELETE FROM public.exp_territory_brand WHERE ")
    assert slot.endswith("RETURNING public.exp_territories.id")
    assert client().delete(f"{P}/slots/{RID}/assignments?types=other").status_code == 422
    assert client().delete(f"{P}/slots/{RID}/assignments").status_code == 422


def test_insert_assignment_and_ramps(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/slots/{RID}/assignments",
                  json={"rep_id": RID2, "group_key": "g", "assignment_type": "claims_queue"})
    client().post(f"{P}/slots/{RID}/ramps", json={"rows": [
        {"rep_id": None, "month_offset": 0, "ramp_pct": 25},
        {"rep_id": None, "month_offset": 1, "ramp_pct": 62.5}]})
    client().post(f"{P}/slots/{RID}/ramps", json={"rows": []})
    (_, a, ap), (_, r, rp) = log
    assert a == ("INSERT INTO public.exp_sales_assignments (rep_id, group_key, assignment_type, "
                 "target_ref) VALUES (%(rep_id)s::UUID, %(group_key)s::VARCHAR, "
                 "%(assignment_type)s::VARCHAR, %(target_ref)s::VARCHAR)")
    assert ap["target_ref"] == RID
    assert r.startswith("INSERT INTO public.exp_territory_ramps (territory_id, rep_id, "
                        "month_offset, ramp_pct) VALUES ") and r.count("), (") == 1
    assert rp["ramp_pct_m1"] == Decimal("62.5") and rp["territory_id_m0"] == RID
    assert client().post(f"{P}/slots/{RID}/assignments",
                         json={"assignment_type": "owner"}).status_code == 422
    assert client().post(f"{P}/slots/{RID}/ramps", json={"rows": [
        {"month_offset": 0.5, "ramp_pct": 1}]}).status_code == 422


def test_insert_proposals_created_by_from_the_token(dbfake):
    log, _, leases = dbfake
    rows = [{"group_key": "g", "gcid": "gcid:x", "lane": "seller", "proposed_label": "G 1",
             "proposed_tier": "MM", "proposed_geo": "national", "rationale": "r",
             "payload": {"action": "create", "logos": [{"logo_id": None}]}, "state": "pending"},
            {"group_key": "g", "gcid": None, "lane": "seller", "proposed_label": "G 2",
             "proposed_tier": "SMB", "proposed_geo": "national", "rationale": "r",
             "payload": {"action": "create"}, "state": "pending"}]
    assert client().post(f"{P}/proposals", json={"rows": rows}).json() == {"ok": True}
    (_, s, p), = log
    assert s.startswith("INSERT INTO public.exp_territory_proposals (group_key, gcid, lane, ")
    assert "created_by" in s and s.count("), (") == 1
    assert p["created_by_m0"] == UID and p["created_by_m1"] == UID
    assert isinstance(p["payload_m0"], Jsonb) and p["payload_m0"].obj["action"] == "create"
    assert leases == [AUTH_WRITE]
    bad = [{**rows[0], "created_by": "someone"}]
    assert client().post(f"{P}/proposals", json={"rows": bad}).status_code == 422


def test_review_proposal_server_clock(dbfake):
    log, _, _ = dbfake
    client().post(f"{P}/proposals/{RID}/review",
                  json={"state": "approved", "payload": {"applied_territory_id": RID2}})
    client().post(f"{P}/proposals/{RID}/review", json={"state": "rejected"})
    (_, a, ap), (_, _, bp) = log
    assert a.startswith("UPDATE public.exp_territory_proposals SET payload=%(payload)s::JSONB, "
                        "state=%(state)s::VARCHAR, reviewed_at=%(reviewed_at)s::TIMESTAMP WITH TIME ZONE")
    assert isinstance(ap["reviewed_at"], dt.datetime) and ap["reviewed_at"].tzinfo is not None
    assert "payload" not in bp and bp["state"] == "rejected"
    assert client().post(f"{P}/proposals/{RID}/review",
                         json={"state": "approved", "reviewed_at": "2020-01-01"}).status_code == 422


def test_seats_upsert_merge_or_ignore(dbfake):
    log, _, _ = dbfake
    add = [{"territory_id": RID, "rep_id": RID2, "group_key": "g", "lane_role": "SMB",
            "monthly_quota": 1500.25}]
    client().post(f"{P}/seats", json={"rows": add})
    nora = [{"territory_id": RID, "rep_id": RID2, "group_key": None, "lane_role": "MM",
             "is_nora_default": True}]
    client().post(f"{P}/seats", json={"rows": nora, "ignore_duplicates": True})
    (_, a, ap), (_, b, _) = log
    assert a.endswith("ON CONFLICT (territory_id, rep_id, lane_role) DO UPDATE SET "
                      "group_key = excluded.group_key, monthly_quota = excluded.monthly_quota")
    assert ap["monthly_quota_m0"] == Decimal("1500.25")
    assert b.endswith("ON CONFLICT (territory_id, rep_id, lane_role) DO NOTHING")


def test_seat_update_and_delete(dbfake):
    log, _, _ = dbfake
    client().patch(f"{P}/seats/{RID}", json={"monthly_quota": None})
    client().delete(f"{P}/seats/{RID}")
    a, b = sqls(log)
    assert a == ("UPDATE public.exp_territory_seats SET monthly_quota=%(monthly_quota)s "
                 "WHERE public.exp_territory_seats.id = %(id_1)s::UUID")
    assert b == "DELETE FROM public.exp_territory_seats WHERE public.exp_territory_seats.id = %(id_1)s::UUID"


def test_write_refused_is_403(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "new row violates row-level security policy")
    assert client().patch(f"{P}/slots/{RID}", json={"status": "assigned"}).status_code == 403


# --- generate RPCs (compiled only, never called against a database) --------------------------

def test_allow_list_matches_the_live_signatures():
    # pg_get_function_identity_arguments(oid), read-only at port time (both SECURITY INVOKER)
    live = {"exp_generate_territories": "p_gcid text",
            "exp_generate_group_territories": "p_group_key text"}
    assert {n: ", ".join(f"{p} {t}" for p, t in ps) for n, ps in q.TERRITORY_RPCS.items()} == live


def test_generate_sql_and_unknown_refused_before_a_connection(dbfake):
    log, state, leases = dbfake
    assert q.rpc_sql("exp_generate_group_territories", {"p_group_key": "bakeries"}) == (
        "select public.exp_generate_group_territories(p_group_key => %(p_group_key)s::text) as v",
        {"p_group_key": "bakeries"})
    # the browser's fallback call ({ group_key }) is refused, so it throws its first error
    r = client().post(f"{P}/rpc/exp_generate_group_territories", json={"args": {"group_key": "g"}})
    assert r.status_code == 400
    assert client().post(f"{P}/rpc/exp_territory_logo_profiles", json={}).status_code == 400
    assert leases == [] and log == []
    state["answer"] = lambda s, p: [{"v": {"created": 3}}]
    assert client().post(f"{P}/rpc/exp_generate_territories",
                         json={"args": {"p_gcid": "gcid:bakery"}}).json() == {"created": 3}
    (lease, s, _), = log
    assert lease == AUTH_WRITE
    assert s == "select public.exp_generate_territories(p_gcid => %(p_gcid)s::text) as v"
    with pytest.raises(UnknownRpc):
        q.rpc_sql("exp_generate_territories", {"p_gcid": 1})
