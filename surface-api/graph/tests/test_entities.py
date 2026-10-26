"""graph entity pages (no live DB/auth): the SQL each read compiles to, the caps, the roles, and
the RPC allow-list. The governed writes are only checked for the SQL they would send."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from surfaces.graph.queries import entities as q
from surfaces.graph.routers.entities_data import router

from _base.auth import current_user
from _base.db import session as core_db
from _base.db.sql import capped, compile_sql
from _base.server_fn import optional_user

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
PID = "11111111-1111-4111-8111-111111111111"
OID = "22222222-2222-4222-8222-222222222222"


def sql(stmt) -> str:
    return " ".join(compile_sql(capped(stmt))[0].split())


def params(stmt) -> dict:
    return compile_sql(capped(stmt))[1]


# --- compiled SQL ------------------------------------------------------------------------------

def test_brands_exclude_merged_and_deactivated_by_name_500():
    s = sql(q.brands_stmt())
    assert "exp_entity.entity_type = " in s and "status NOT IN (" in s
    assert "ORDER BY public.exp_entity.display_name LIMIT" in s
    p = params(q.brands_stmt())
    assert p["param_1"] == 500 and {"merged", "deactivated"} <= set(p.values())


def test_entities_newest_first():
    # the claims and entities-lite reads moved to admin (surface audit 2026-10-25):
    # admin/queries/control_claims_test.py
    assert "ORDER BY public.exp_entity.created_at DESC" in sql(q.entities_stmt())
    assert params(q.entities_stmt())["param_1"] == 1000


def test_relationships_of_one_subject_newest_200():
    s = sql(q.relationships_stmt(PID))
    assert "exp_rel.subject_entity_id = " in s and "ORDER BY public.exp_rel.created_at DESC" in s
    assert params(q.relationships_stmt(PID))["param_1"] == 200


def test_control_nodes_by_name_capped():
    assert "ORDER BY public.exp_control_nodes.name LIMIT" in sql(q.control_nodes_stmt())
    assert params(q.control_nodes_stmt())["param_1"] == 1000


def test_expertise_edges_and_external_nodes_use_an_aliased_own_node_subquery():
    e = sql(q.edges_stmt("professional", PID))
    assert "graph_edges.from_node_id IN (SELECT own.id FROM public.graph_nodes AS own" in e
    assert "OR public.graph_edges.to_node_id IN (SELECT own.id" in e
    x = sql(q.external_nodes_stmt("professional", PID))
    assert "graph_nodes.id NOT IN (SELECT own.id FROM public.graph_nodes AS own" in x
    assert "UNION" in x


def test_expertise_brand_is_the_offices_parent():
    s = sql(q.expertise_side_stmts("professional", PID, OID)["brand"])
    assert "organizations.id = (SELECT office.parent_org_id FROM public.organizations AS office" in s
    assert "org" not in q.expertise_side_stmts("professional", PID, None)


# --- the RPC allow-list ------------------------------------------------------------------------

def test_rpc_casts_given_arguments_and_omits_the_rest():
    s, p = q.rpc_sql("exp_ctrl_update_node", {"p_id": PID, "p_move": True, "p_parent": OID})
    assert s == ("select public.exp_ctrl_update_node(p_id => %(p_id)s::uuid, "
                 "p_parent => %(p_parent)s::uuid, p_move => %(p_move)s::boolean) as v")
    assert p == {"p_id": PID, "p_move": True, "p_parent": OID}


def test_rpc_create():
    s, _ = q.rpc_sql("exp_ctrl_create_node", {"p_name": "x", "p_node_type": "brand",
                                              "p_billing": True})
    assert "p_billing => %(p_billing)s::boolean" in s and "p_parent" not in s


def test_rpc_set_expected_volume():
    s, p = q.rpc_sql("exp_set_expected_volume", {"p_gcid": "gcid:bakery", "p_lane": "reviews",
                                                  "p_scope": "location", "p_value": 12.5})
    assert s == ("select public.exp_set_expected_volume(p_gcid => %(p_gcid)s::text, "
                 "p_lane => %(p_lane)s::text, p_scope => %(p_scope)s::text, "
                 "p_value => %(p_value)s::numeric) as v")
    assert p["p_gcid"] == "gcid:bakery"


@pytest.mark.parametrize("name,args", [
    ("exp_graph_upsert_nodes", {}),
    ("exp_claim_adjudicate", {}),  # moved to admin (surface audit 2026-10-25)
    ("exp_ctrl_create_node", {"p_name": "x", "p_evil": 1}),
])
def test_rpc_outside_the_allow_list_is_refused(name, args):
    with pytest.raises(q.UnknownRpc):
        q.rpc_sql(name, args)


# --- endpoints (fake connection) ---------------------------------------------------------------

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
        self.log.append((s, p or {}))
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


def client(user=CLAIMS) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    app.dependency_overrides[optional_user] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("get", "/graph/control/entities"), ("post", "/graph/control/rpc/exp_ctrl_create_node"),
    ("get", "/graph/control/validate"),
])
def test_control_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path, **({"json": {}} if method == "post" else {})) \
        .status_code == 403


def test_rpc_runs_as_the_user_on_the_primary(fake):
    log, leases, state = fake
    state["answer"] = lambda s, p: [{"v": None}]
    r = client().post("/graph/control/rpc/exp_ctrl_update_node",
                      json={"args": {"p_id": PID, "p_name": "x"}})
    assert r.status_code == 200 and leases == [("authenticated", CLAIMS, True)]
    assert "exp_ctrl_update_node(" in log[0][0]


def test_unknown_rpc_is_400_without_a_connection(fake):
    _, leases, _ = fake
    assert client().post("/graph/control/rpc/exp_etl_run_source", json={"args": {}}) \
        .status_code == 400
    assert leases == []


def test_refusal_is_403(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("forbidden")
    assert client().get("/graph/control/validate").status_code == 403


def test_expertise_runs_as_anon_when_signed_out(fake):
    _, leases, _ = fake
    r = client(user=None).get("/graph/expertise/professional/nobody")
    assert r.status_code == 200 and r.json() is None
    assert leases == [("anon", None, False)]


def test_expertise_signed_in_runs_as_the_user(fake):
    _, leases, _ = fake
    client().get("/graph/expertise/company/nobody")
    assert leases == [("authenticated", CLAIMS, False)]


def test_expertise_bad_kind_is_422(fake):
    assert client().get("/graph/expertise/brand/x").status_code == 422


def test_expertise_reads_are_uncapped_and_shaped(fake):
    log, _, state = fake

    def answer(s, p):
        if "FROM public.professionals" in s and "slug" in s:
            return [{"id": PID, "slug": "a", "primary_org_id": OID}]
        if "count(*)" in s:
            return [{"count": 7}]
        if "parent_org_id" in s and "AS office" not in s and "FROM public.organizations" in s:
            return [{"id": OID, "name": "Office", "slug": "o", "parent_org_id": "b"}]
        if "AS office" in s:
            return [{"id": "b", "name": "Brand", "slug": "c"}]
        if "FROM public.graph_edges" in s and "UNION" not in s:
            return [{"id": "e1", "from_node_id": "n1", "to_node_id": "x1"}]
        if "UNION" in s:
            return [{"id": "x1"}]
        if "FROM public.graph_nodes" in s:
            return [{"id": "n1"}]
        return []

    state["answer"] = answer
    r = client(user=None).get("/graph/expertise/professional/a").json()
    assert r["reviewCount"] == 7 and r["org"]["name"] == "Office" and r["brand"]["name"] == "Brand"
    assert r["ownRows"] == [{"id": "n1"}] and r["external"] == [{"id": "x1"}]
    uncapped = [s for s, _ in log if "graph_nodes" in s or "graph_edges" in s]
    assert len(uncapped) == 3 and not any("LIMIT" in s for s in uncapped)
