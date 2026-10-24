"""xmp enterprise / seat / dashboard endpoints (fake connection, no live DB or auth): roles,
shapes, the PostgREST null / empty paths, refusals, and the write models' allow-lists."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from xmp.routers.seat_data import router

UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
CLAIMS = {"sub": UID, "role": "authenticated"}
PID = "11111111-1111-4111-8111-111111111111"
OID = "22222222-2222-4222-8222-222222222222"


class Cur:
    def __init__(self, rows):
        self.rows, self.description = rows, [("x",)]

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer):
        self.log, self.answer = log, answer

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def execute(self, s, p=None):
        self.log.append((" ".join(s.split()), p or {}))
        rows = [] if "savepoint" in s else self.answer(s, p or {})
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)

    def cursor(self):
        conn = self

        class C(Cur):
            def __init__(self):
                super().__init__([])

            def execute(self, s, p=None):
                self.rows = conn.execute(s, p).rows

        return C()


@pytest.fixture
def fake(monkeypatch):
    log: list = []
    leases: list = []
    state = {"answer": lambda s, p: []}

    @contextmanager
    def role_connection(role, claims=None, *, write=False, fresh=False):
        leases.append((role, claims, write))
        yield FakeConn(log, lambda s, p: state["answer"](s, p))

    monkeypatch.setattr(core_db, "role_connection", role_connection)
    return log, leases, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def sent(log) -> list[str]:
    return [s for s, _ in log if "savepoint" not in s]


@pytest.mark.parametrize("method,path", [
    ("get", "/xmp/enterprise/brands/state-farm"), ("post", "/xmp/rpc/exp_xmp_top_depth"),
    ("get", "/xmp/seat/location/x"), ("get", "/xmp/dashboard/home"),
    ("post", "/xmp/enterprise/campaigns"), ("post", "/xmp/enterprise/professionals/x/deactivate"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    r = getattr(TestClient(app), method)(path, **({"json": {}} if method == "post" else {}))
    assert r.status_code == 403


# --- reads -------------------------------------------------------------------------------------

def test_reads_run_as_the_user_on_a_read_connection(fake):
    _, leases, _ = fake
    client().get("/xmp/enterprise/brands/state-farm")
    client().post("/xmp/rpc/exp_xmp_top_depth", json={"args": {"p_brand": OID, "p_limit": 20}})
    assert leases == [("authenticated", CLAIMS, False)] * 2


def test_rpc_set_returns_rows_scalar_returns_value(fake):
    _log, _, state = fake
    state["answer"] = lambda s, p: [{"state": "TX", "offices": 3}] if "select *" in s else \
        [{"v": {"mode": "single_pro"}}]
    r = client().post("/xmp/rpc/exp_xmp_state_rollup", json={"args": {"p_brand": OID, "p_limit": 60}})
    assert r.json() == [{"state": "TX", "offices": 3}]
    r = client().post("/xmp/rpc/exp_office_mode",
                      json={"args": {"p_entity_type": "professional", "p_entity_id": PID}})
    assert r.json() == {"mode": "single_pro"}


def test_unknown_rpc_is_400_without_a_connection(fake):
    _, leases, _ = fake
    assert client().post("/xmp/rpc/exp_score_v5_persist", json={"args": {}}).status_code == 400
    assert leases == []


def test_refusal_is_403(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"/xmp/enterprise/offices/{OID}/pros").status_code == 403


def test_brand_null_when_unknown_or_ambiguous(fake):
    _, _, state = fake
    assert client().get("/xmp/enterprise/brands/nope").json() is None
    state["answer"] = lambda s, p: [{"id": "a"}, {"id": "b"}]
    assert client().get("/xmp/enterprise/brands/dup").json() is None


def test_office_pros_default_limit_50(fake):
    log, _, _ = fake
    client().get(f"/xmp/enterprise/offices/{OID}/pros")
    assert log[0][1]["param_1"] == 50


def test_moderation_runs_the_rpc_and_returns_no_reviews(fake):
    # the page's reviews read selected a column reviews doesn't have (review_text): always empty
    log, _, state = fake
    state["answer"] = lambda s, p: [{"id": PID}]
    assert client().get(f"/xmp/enterprise/brands/{OID}/moderation").json() == []
    assert any("exp_xmp_top_reviews" in s for s in sent(log))
    assert not any("FROM public.reviews" in s for s in sent(log))


def test_view_as_professional_shape(fake):
    _, _, state = fake

    def answer(s, p):
        if "FROM public.professionals" in s and "organizations" not in s:
            return [{"id": PID, "primary_org_id": OID}]
        if "FROM public.organizations" in s:
            return [{"id": OID, "name": "Office"}]
        if "FROM public.graph_nodes" in s:
            return [{"id": "n1", "ring": 1}]
        return []

    state["answer"] = answer
    r = client().get(f"/xmp/enterprise/view-as/professional/{PID}").json()
    assert r == {"pro": {"id": PID, "primary_org_id": OID}, "office": {"id": OID, "name": "Office"},
                 "nodes": [{"id": "n1", "ring": 1}], "reviews": []}


def test_view_as_unknown_is_null(fake):
    assert client().get(f"/xmp/enterprise/view-as/location/{OID}").json() is None


def test_campaigns_page_unknown_slug(fake):
    log, _, _ = fake
    assert client().get("/xmp/enterprise/orgs/nope/campaigns").json() == {"root": None}
    assert len(sent(log)) == 1


def test_users_page_keys_off_the_tree_and_the_caller(fake):
    log, _, state = fake

    def answer(s, p):
        if "hierarchy_path LIKE" in s:
            return [{"id": OID}, {"id": PID}]  # the root is filtered out of the descendants
        if "organizations.slug = " in s:
            return [{"id": OID, "name": "Root"}]
        if "FROM public.professionals" in s:
            return [{"id": "p1", "user_id": UID}, {"id": "p2", "user_id": None}]
        if "FROM public.user_accounts" in s:
            return [{"supabase_user_id": UID, "email": "a@b.c"}]
        return []

    state["answer"] = answer
    r = client().get("/xmp/enterprise/orgs/root/users").json()
    assert r["root"]["id"] == OID and len(r["pros"]) == 2 and r["accounts"][0]["email"] == "a@b.c"
    pros = next((s, p) for s, p in log if "FROM public.professionals" in s)
    assert "LIMIT" in pros[0] and 1000 in pros[1].values()  # .limit(2000) → the cap
    assert {v for k, v in pros[1].items() if k.startswith("primary_org_id")} == {OID, PID}
    admin = next(p for s, p in log if "user_roles.user_id = " in s)
    assert UID in admin.values()
    acct = next(p for s, p in log if "user_accounts" in s)
    assert [v for k, v in acct.items() if k.startswith("supabase_user_id")] == [UID]


def test_location_seat_reads_roster_ratings_from_its_ids(fake):
    log, _, state = fake

    def answer(s, p):
        if "FROM public.organizations" in s and "organizations.gbp_connected" in s:
            return [{"id": OID, "parent_org_id": None, "is_demo": False}]
        if "FROM public.professionals" in s:
            return [{"id": "p1"}, {"id": "p2"}]
        return []

    state["answer"] = answer
    r = client().get(f"/xmp/seat/location/{OID}").json()
    assert r["brand"] is None and len(r["pros"]) == 2
    pro_ratings = next(p for s, p in log if "aggregate_ratings" in s and "p1" in p.values())
    assert {"p1", "p2"} <= set(pro_ratings.values())


def test_location_seat_empty_roster_skips_professional_reads(fake):
    log, _, state = fake
    state["answer"] = lambda s, p: [{"id": OID, "parent_org_id": None}] \
        if "FROM public.organizations" in s else []
    client().get(f"/xmp/seat/location/{OID}")
    assert not any("professional" in str(p.values()) and "aggregate_ratings" in s for s, p in log)


def test_professional_seat_brand_only_when_the_office_has_a_parent(fake):
    log, _, state = fake

    def answer(s, p):
        if "FROM public.professionals" in s:
            return [{"id": PID, "primary_org_id": OID}]
        if "parent_org_id" in s and OID in p.values():
            return [{"id": OID, "parent_org_id": None}]
        return []

    state["answer"] = answer
    r = client().get(f"/xmp/seat/professional/{PID}").json()
    assert r["office"] == {"id": OID, "parent_org_id": None} and r["brand"] is None
    assert sum("FROM public.organizations" in s for s in sent(log)) == 1


def test_interview_subject_several_rows_is_406(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get(f"/xmp/interview/subject/office/{OID}").status_code == 406
    assert client().get(f"/xmp/interview/subject/brand/{OID}").status_code == 422


def test_team_family_skips_reads_without_territories_or_family(fake):
    log, _, _ = fake
    r = client().post("/xmp/team/family", json={"family_key": None, "territory_ids": [], "year": 2026})
    assert r.json() == {k: [] for k in ("links", "orgs", "sellers", "expansion", "months")}
    assert sent(log) == []


def test_dashboard_keys_off_the_caller_unless_an_id_is_given(fake):
    log, _, _ = fake
    assert client().get("/xmp/dashboard/home").json() == {"pro": None}
    s, p = [x for x in log if "savepoint" not in x[0]][-1]
    assert "professionals.user_id = " in s and UID in p.values()
    client().get(f"/xmp/dashboard/reviews?professional_id={PID}")
    s, p = [x for x in log if "savepoint" not in x[0]][-1]
    assert "professionals.id = " in s and PID in p.values()


def test_dashboard_listings_registry_only_with_gcid(fake):
    log, _, _ = fake
    r = client().get(f"/xmp/dashboard/listings?entity_type=organization&entity_id={OID}").json()
    assert r == {"listings": [], "registry": []}
    assert not any("exp_vertical_node_registry" in s for s in sent(log))


# --- writes ------------------------------------------------------------------------------------

def test_writes_run_as_the_user_on_the_primary(fake):
    _, leases, _ = fake
    assert client().patch(f"/xmp/enterprise/campaigns/{PID}", json={"status": "paused"}).json() \
        == {"ok": True}
    assert leases == [("authenticated", CLAIMS, True)]


def test_campaign_insert_forbids_other_columns(fake):
    _, leases, _ = fake
    r = client().post("/xmp/enterprise/campaigns", json={"name": "x", "redirect_url": "http://e"})
    assert r.status_code == 422 and leases == []


def test_campaign_insert_rls_error_is_403_with_the_message(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "review_campaigns"')
    r = client().post("/xmp/enterprise/campaigns", json={"name": "x", "status": "draft"})
    assert r.status_code == 403 and "row-level security" in r.json()["detail"]


def test_invitations_invited_by_is_the_caller(fake):
    log, _, _ = fake
    r = client().post("/xmp/enterprise/invitations",
                      json={"records": [{"email": "a@b.c", "role": "member",
                                         "entity_type": "organization", "entity_id": OID,
                                         "status": "pending"}]})
    assert r.status_code == 200
    s, p = log[0]
    assert s.startswith("INSERT INTO public.invitations") and p["invited_by_m0"] == UID
    bad = client().post("/xmp/enterprise/invitations",
                        json={"records": [{"email": "a", "invited_by": OID}]})
    assert bad.status_code == 422


def test_impersonate_and_deactivate(fake):
    log, _, _ = fake
    client().post(f"/xmp/enterprise/professionals/{PID}/impersonate",
                  json={"impersonating": OID, "org_slug": "state-farm"})
    s, p = log[0]
    assert "INSERT INTO public.audit_log" in s and p["user_id"] == UID and p["entity_id"] == PID
    log.clear()
    client().post(f"/xmp/enterprise/professionals/{PID}/deactivate")
    assert sent(log)[0].startswith("UPDATE public.professionals SET is_active")
    assert "INSERT INTO public.audit_log" in sent(log)[1]
