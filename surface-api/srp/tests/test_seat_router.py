"""srp seat / interview / dashboard endpoints (fake connection, no live DB or auth): roles,
shapes, the PostgREST null / empty paths and refusals. Moved from xmp/routers/seat_router_test.py
with the endpoints, surface audit 2026-10-25."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from surfaces.srp.routers.seat_data import router

from _base.auth import current_user
from _base.db import session as core_db

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
    ("post", "/srp/rpc/exp_office_mode"), ("get", "/srp/seat/location/x"),
    ("get", "/srp/dashboard/home"), ("get", "/srp/interview/claim/x"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    r = getattr(TestClient(app), method)(path, **({"json": {}} if method == "post" else {}))
    assert r.status_code == 403


def test_office_mode_rpc_returns_the_value_as_the_user(fake):
    _, leases, state = fake
    state["answer"] = lambda s, p: [{"v": {"mode": "single_pro"}}]
    r = client().post("/srp/rpc/exp_office_mode",
                      json={"args": {"p_entity_type": "professional", "p_entity_id": PID}})
    assert r.json() == {"mode": "single_pro"} and leases == [("authenticated", CLAIMS, False)]


def test_unknown_rpc_is_400_without_a_connection(fake):
    _, leases, _ = fake
    assert client().post("/srp/rpc/exp_xmp_top_depth", json={"args": {}}).status_code == 400
    assert leases == []


def test_refusal_is_403(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"/srp/interview/subject/office/{OID}").status_code == 403


def test_location_seat_reads_roster_ratings_from_its_ids(fake):
    log, _, state = fake

    def answer(s, p):
        if "FROM public.organizations" in s and "organizations.gbp_connected" in s:
            return [{"id": OID, "parent_org_id": None, "is_demo": False}]
        if "FROM public.professionals" in s:
            return [{"id": "p1"}, {"id": "p2"}]
        return []

    state["answer"] = answer
    r = client().get(f"/srp/seat/location/{OID}").json()
    assert r["brand"] is None and len(r["pros"]) == 2
    pro_ratings = next(p for s, p in log if "aggregate_ratings" in s and "p1" in p.values())
    assert {"p1", "p2"} <= set(pro_ratings.values())


def test_location_seat_empty_roster_skips_professional_reads(fake):
    log, _, state = fake
    state["answer"] = lambda s, p: [{"id": OID, "parent_org_id": None}] \
        if "FROM public.organizations" in s else []
    client().get(f"/srp/seat/location/{OID}")
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
    r = client().get(f"/srp/seat/professional/{PID}").json()
    assert r["office"] == {"id": OID, "parent_org_id": None} and r["brand"] is None
    assert sum("FROM public.organizations" in s for s in sent(log)) == 1


def test_interview_subject_several_rows_is_406(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get(f"/srp/interview/subject/office/{OID}").status_code == 406
    assert client().get(f"/srp/interview/subject/brand/{OID}").status_code == 422


def test_dashboard_keys_off_the_caller_unless_an_id_is_given(fake):
    log, _, _ = fake
    assert client().get("/srp/dashboard/home").json() == {"pro": None}
    s, p = [x for x in log if "savepoint" not in x[0]][-1]
    assert "professionals.user_id = " in s and UID in p.values()
    client().get(f"/srp/dashboard/reviews?professional_id={PID}")
    s, p = [x for x in log if "savepoint" not in x[0]][-1]
    assert "professionals.id = " in s and PID in p.values()


def test_dashboard_listings_registry_only_with_gcid(fake):
    log, _, _ = fake
    r = client().get(f"/srp/dashboard/listings?entity_type=organization&entity_id={OID}").json()
    assert r == {"listings": [], "registry": []}
    assert not any("exp_vertical_node_registry" in s for s in sent(log))
