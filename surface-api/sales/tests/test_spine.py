"""sales spine endpoints (no live DB/auth): the SQL each one sends, the raw answers, the
1000-row cap kept per read (and per 200-id chunk), which reads throw and which are tolerant.
graph_nodes is only ever SELECTed. Read-only."""
from __future__ import annotations

import uuid
from decimal import Decimal

import psycopg
import pytest

from sales.tests.test_contracts import (
    AUTH_READ,
    RID,
    RID2,
    install_fake_db,
    make_client,
    sqls,
    table_of,
)
from surfaces.sales.queries import spine as q
from surfaces.sales.routers.spine_data import router

P = "/sales/spine"


@pytest.fixture
def dbfake(monkeypatch):
    return install_fake_db(monkeypatch)


def client():
    return make_client(router)


def params_of(log, sql):
    return next(p for _, x, p in log if x == sql)


@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/scope"), ("post", f"{P}/scope-logos"), ("get", f"{P}/worklist"),
    ("get", f"{P}/reps/{RID}/territory-brands"), ("post", f"{P}/worklist-logos"),
    ("post", f"{P}/location-counts"), ("post", f"{P}/profile-meta"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    kw = {"json": {}} if method == "post" else {}
    assert getattr(make_client(router, None), method)(path, **kw).status_code == 403


def test_scope_reads_oldest_1000_claims(dbfake):
    log, state, leases = dbfake
    state["answer"] = lambda s, p: [{"mrr": Decimal("99.50")}] if table_of(s) == "exp_contracts" else []
    out = client().get(f"{P}/scope").json()
    assert leases == [AUTH_READ]
    assert out == {"claims": [], "territories": [], "metrics": [], "contracts": [{"mrr": 99.5}],
                   "pipeline": []}
    s = sqls(log)
    assert [table_of(x) for x in s] == ["exp_claim_events", "exp_territories", "exp_sales_rep_metrics",
                                        "exp_contracts", "exp_sales_pipeline"]
    assert "ORDER BY public.exp_claim_events.occurred_at ASC" in s[0]
    assert params_of(log, s[0])["param_1"] == 1000  # .limit(10000) cut to the cap (follow-up 1j)
    assert "WHERE" not in s[1] and "WHERE" not in s[2]
    assert "public.exp_sales_pipeline.stage NOT IN" in s[4]
    assert {"won", "lost"} <= set(params_of(log, s[4]).values())


def test_scope_group_filters_territories_and_metrics(dbfake):
    log, _, _ = dbfake
    client().get(f"{P}/scope", params={"group_key": "insurance"})
    s = sqls(log)
    assert "exp_territories.group_key = " in s[1] and "exp_sales_rep_metrics.group_key = " in s[2]
    assert "WHERE" not in s[0]  # the claims are filtered by the browser


def test_scope_errors_thrown_but_pipeline_tolerant(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied") \
        if table_of(s) == "exp_sales_pipeline" else []
    assert client().get(f"{P}/scope").json()["pipeline"] == []
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied") \
        if table_of(s) == "exp_territories" else []
    assert client().get(f"{P}/scope").status_code == 403


def test_logos(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": uuid.UUID(RID), "name": "A", "logo_url": None}]
    assert client().post(f"{P}/scope-logos", json={"ids": [RID]}).json() == \
        [{"id": RID, "name": "A", "logo_url": None}]
    assert "parent_org_id" not in sqls(log)[0]
    log.clear()
    client().post(f"{P}/worklist-logos", json={"ids": [RID]})
    assert "public.organizations.parent_org_id" in sqls(log)[0]
    state["answer"] = lambda s, p: psycopg.errors.QueryCanceled("canceling statement")
    assert client().post(f"{P}/worklist-logos", json={"ids": [RID]}).status_code == 400
    assert client().post(f"{P}/scope-logos", json={"ids": []}).status_code == 422


def test_worklist_newest_1000_claims_then_open_opportunities(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("x") \
        if table_of(s) == "exp_sales_pipeline" else []
    assert client().get(f"{P}/worklist").json() == {"claims": [], "opportunities": []}
    s = sqls(log)
    assert "ORDER BY public.exp_claim_events.occurred_at DESC" in s[0]
    assert params_of(log, s[0])["param_1"] == 1000
    opp = next(x for x in s if table_of(x) == "exp_sales_pipeline")
    assert "ORDER BY public.exp_sales_pipeline.updated_at DESC" in opp and "NOT IN" in opp
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get(f"{P}/worklist").status_code == 403  # the claims threw


def test_territory_brands_chain(dbfake):
    log, state, _ = dbfake

    def answer(sql, params):
        t = table_of(sql)
        if t == "exp_territory_seats":
            return [{"territory_id": uuid.UUID(RID)}]
        if t == "exp_territories":
            return [{"id": uuid.UUID(RID)}, {"id": uuid.UUID(RID2)}]
        return [{"org_id": uuid.UUID(RID2)}]

    state["answer"] = answer
    out = client().get(f"{P}/reps/{RID}/territory-brands").json()
    assert out["brands"] == [{"org_id": RID2}]
    brand_sql = sqls(log)[-1]
    assert table_of(brand_sql) == "exp_territory_brand"
    assert sorted(v for k, v in params_of(log, brand_sql).items() if k.startswith("territory_id")) == \
        sorted([RID, RID2])  # de-duplicated
    log.clear()
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/reps/{RID}/territory-brands").json()["brands"] == []
    assert "exp_territory_brand" not in [table_of(x) for x in sqls(log)]


def test_location_counts_one_per_logo_null_on_failure(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation("bad uuid") \
        if "x" in p.values() else [{"n": 12}]
    out = client().post(f"{P}/location-counts", json={"ids": [RID, "x"]}).json()
    assert out == {RID: 12, "x": None}
    counts = {x for x in sqls(log) if "count(*)" in x}
    assert counts and all("organizations.parent_org_id = " in x for x in counts)


def test_profile_meta_chunks_of_200_each_capped(dbfake):
    log, state, _ = dbfake
    ids = [str(uuid.UUID(int=i)) for i in range(450)]

    def answer(sql, params):
        if table_of(sql) == "graph_nodes":
            return [{"entity_id": uuid.UUID(ids[0])}]
        return [{"entity_id": uuid.UUID(ids[1]), "total_score": Decimal(10)}]

    state["answer"] = answer
    out = client().post(f"{P}/profile-meta", json={"ids": ids}).json()
    assert len(out["scores"]) == 3 and len(out["nodes"]) == 3  # one read per chunk and table
    s = sqls(log)
    nodes = [x for x in s if table_of(x) == "graph_nodes"]
    assert len(nodes) == 3 and all(x.startswith("SELECT") for x in s)  # graph_nodes: read only
    for x in nodes:
        p = params_of(log, x)
        assert "is_active IS true" in x and p["param_1"] == 1000  # .limit(10000) cut per chunk
    sizes = [sum(1 for k in params_of(log, x) if k.startswith("entity_id_")) for x in nodes]
    assert sizes == [200, 200, 50]


def test_profile_meta_a_failed_chunk_adds_nothing(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.QueryCanceled("timeout") \
        if table_of(s) == "graph_nodes" else []
    assert client().post(f"{P}/profile-meta", json={"ids": [RID]}).json() == {"scores": [], "nodes": []}


def test_chunks_constant():
    assert q.CHUNK == 200
