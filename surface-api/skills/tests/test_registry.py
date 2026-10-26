"""/skills/registry and /skills/sandbox endpoints (no live DB/auth): the SQL each one sends,
the PostgREST-shaped answers, and the writes as the page sent them. No write reaches a database
here."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.skills.registry.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
RID = "11111111-1111-4111-8111-111111111111"
ENT = "22222222-2222-4222-8222-222222222222"
R = "/skills/registry"
S = "/skills/sandbox"


# the website tests' fake connection and helpers (copied when those moved from xmp to marketing,
# surface audit 2026-10-25; no cross-Surface import)

class Cur:
    def __init__(self, rows, description=True):
        self.rows = rows or []
        self.description = description

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def execute(self, sql, params=None):
        self.log.append((self.write, sql, params or {}))
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)

    def cursor(self):
        conn = self

        class C(Cur):
            def __init__(self):
                super().__init__([], None)

            def execute(self, sql, params=None):
                self.rows = conn.execute(sql, params).rows
                # a write without RETURNING has no result set (psycopg: description None)
                self.description = None if sql.startswith(("UPDATE", "INSERT", "DELETE")) \
                    and "RETURNING" not in sql else True

            def fetchall(self):
                if self.description is None:
                    raise AssertionError("fetchall on a statement with no result set")
                return self.rows

        return C()


def writes(log):
    return [x for x in log if x[1].startswith(("UPDATE", "INSERT", "DELETE"))]


def unwrap(v):
    return v.obj if isinstance(v, Jsonb) else v


def values(params):
    return {k: unwrap(v) for k, v in params.items()}


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def last_select(log):
    return [x for x in log if x[1].startswith("SELECT")][-1]


@pytest.mark.parametrize("method,path", [
    ("get", f"{R}/skills"), ("post", f"{R}/skills"), ("patch", f"{R}/skills/{RID}"),
    ("post", f"{R}/skills/release"), ("get", f"{R}/capabilities"), ("get", f"{R}/build-map"),
    ("post", f"{R}/evals"), ("get", f"{R}/skill-runs"), ("get", f"{S}/entities"),
    ("put", f"{S}/weights/impact"), ("post", f"{S}/feedback"), ("get", f"{S}/scored"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


# --- reads ---------------------------------------------------------------------------------------

@pytest.mark.parametrize("path,table,order", [
    (f"{R}/skills", "exp_skill_registry", "ORDER BY public.exp_skill_registry.key"),
    (f"{R}/capabilities", "exp_capability_registry", "ORDER BY public.exp_capability_registry.key"),
    (f"{R}/build-map", "exp_build_map",
     "ORDER BY public.exp_build_map.track, public.exp_build_map.sort_order, public.exp_build_map.step_no"),
    (f"{R}/evals", "exp_skill_eval",
     "ORDER BY public.exp_skill_eval.skill_key, public.exp_skill_eval.name"),
    (f"{R}/skill-runs", "exp_skill_run", "ORDER BY public.exp_skill_run.created_at DESC"),
    (f"{S}/entities", "exp_nora_state", "ORDER BY public.exp_nora_state.name"),
])
def test_list_sql(dbfake, path, table, order):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": RID}]
    assert client().get(path).json() == [{"id": RID}]
    sql, params = last_select(log)[1:]
    assert f"FROM public.{table}" in sql and order in sql
    assert params["param_1"] == (100 if "skill-run" in path else 1000)


def test_skill_runs_limit_and_cap(dbfake):
    log, _ = dbfake
    client().get(f"{R}/skill-runs", params={"limit": 5})
    assert last_select(log)[2]["param_1"] == 5
    client().get(f"{R}/skill-runs", params={"limit": 5000})
    assert last_select(log)[2]["param_1"] == 1000  # PostgREST max-rows


def test_evals_filter_and_versions(dbfake):
    log, _ = dbfake
    client().get(f"{R}/evals", params={"skill_key": "publish_bio"})
    assert last_select(log)[2]["skill_key_1"] == "publish_bio"
    client().get(f"{R}/versions", params={"skill_key": "publish_bio"})
    sql, params = last_select(log)[1:]
    assert "ORDER BY public.exp_skill_version.published_at DESC" in sql
    assert params["skill_key_1"] == "publish_bio"


def test_get_by_key_is_maybe_single(dbfake):
    _, state = dbfake
    assert client().get(f"{R}/skills/publish_bio").json() is None
    state["answer"] = lambda s, p: [{"key": "a"}]
    assert client().get(f"{R}/capabilities/a").json() == {"key": "a"}
    state["answer"] = lambda s, p: [{"key": "a"}, {"key": "a"}]
    assert client().get(f"{R}/skills/a").status_code == 406


def test_weights_and_feedback_reads(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"key": "impact", "weight": 1.5}]
    assert client().get(f"{S}/weights").json() == [{"key": "impact", "weight": 1.5}]
    assert "SELECT public.exp_nora_weights.key, public.exp_nora_weights.weight" in last_select(log)[1]
    client().get(f"{S}/feedback", params={"entity_id": ENT})
    assert last_select(log)[2]["entity_id_1"] == ENT


def test_sandbox_state_maybe_single(dbfake):
    _, state = dbfake
    assert client().get(f"{S}/entities/x").json() is None
    state["answer"] = lambda s, p: [{"entity_ref": "x"}, {"entity_ref": "x"}]
    assert client().get(f"{S}/entities/x").status_code == 406


def test_scored_joins_names_and_ignores_name_errors(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if "FROM public.search_rank_scores" in sql:
            return [{"entity_id": ENT, "entity_type": "professional", "gcid": "gcid:x",
                     "total_score": 9}, {"entity_id": RID, "entity_type": "location",
                                         "gcid": None, "total_score": 1}]
        if "FROM public.exp_entity" in sql:
            return [{"entity_id": ENT, "display_name": "Pat"}, {"entity_id": RID, "display_name": None}]
        return []

    state["answer"] = answer
    rows = client().get(f"{S}/scored").json()
    assert [r["display_name"] for r in rows] == ["Pat", None]
    score_sql = next(x for x in log if "FROM public.search_rank_scores" in x[1])[1]
    assert "ORDER BY public.search_rank_scores.total_score DESC" in score_sql
    names = next(x for x in log if "FROM public.exp_entity" in x[1])
    assert ENT in names[2].values() and RID in names[2].values()

    def broken_names(sql, params):
        if "exp_entity" in sql:
            return psycopg.errors.InvalidTextRepresentation("bad uuid")
        return answer(sql, params)

    state["answer"] = broken_names
    assert [r["display_name"] for r in client().get(f"{S}/scored").json()] == [None, None]


def test_score_latest_row_or_null_and_strict_error(dbfake):
    log, state = dbfake
    assert client().get(f"{S}/scores/{ENT}").json() is None
    assert not [x for x in log if "exp_entity" in x[1]]  # no names read without a row

    def answer(sql, params):
        if "FROM public.search_rank_scores" in sql:
            return [{"entity_id": ENT, "total_score": 5}]
        if "FROM public.exp_entity" in sql:
            return [{"entity_id": ENT, "display_name": "Pat"}]
        return []

    state["answer"] = answer
    assert client().get(f"{S}/scores/{ENT}").json() == {"entity_id": ENT, "total_score": 5,
                                                         "display_name": "Pat"}
    sql, params = [x for x in log if "FROM public.search_rank_scores" in x[1]][-1][1:]
    assert "ORDER BY public.search_rank_scores.calculated_at DESC" in sql and params["param_1"] == 1
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation(
        'invalid input syntax for type uuid: "x"')
    assert client().get(f"{S}/scores/x").status_code == 400  # getScore threw (`must`)


# --- writes --------------------------------------------------------------------------------------

def test_create_skill_inserts_sent_keys_returning_row(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": RID, "key": "k"}] if s.startswith("INSERT") else []
    r = client().post(f"{R}/skills", json={"key": "k", "triggers": ["a"], "status": "draft"})
    assert r.json() == {"id": RID, "key": "k"}
    (w,) = writes(log)
    assert w[0] is True and "RETURNING public.exp_skill_registry.id" in w[1]
    assert values(w[2]) == {"key": "k", "triggers": ["a"], "status": "draft"}


def test_update_skill_by_id_single(dbfake):
    log, state = dbfake
    assert client().patch(f"{R}/skills/{RID}", json={"key": "k"}).status_code == 406  # no row
    state["answer"] = lambda s, p: [{"id": RID, "key": "k"}] if s.startswith("UPDATE") else []
    assert client().patch(f"{R}/skills/{RID}", json={"key": "k", "title": "T"}).json()["id"] == RID
    w = writes(log)[-1]
    assert values(w[2]) == {"key": "k", "title": "T", "id_1": RID}


def test_skill_refuses_unknown_columns(dbfake):
    assert client().post(f"{R}/skills", json={"key": "k", "created_at": "x"}).status_code == 422
    assert client().post(f"{R}/skills", json={"key": "k", "bogus": 1}).status_code == 422


def test_capability_jsonb_columns_wrapped(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": RID}] if s.startswith("INSERT") else []
    client().post(f"{R}/capabilities", json={"key": "c", "inputs": {"a": 1}, "outputs": None,
                                             "side_effects": ["x"]})
    (w,) = writes(log)
    assert isinstance(w[2]["inputs"], Jsonb) and w[2]["outputs"] is None
    assert w[2]["side_effects"] == ["x"]  # text[] stays an array


@pytest.mark.parametrize("release,note_sent", [("published", False), ("yanked", True)])
def test_release_saves_then_snapshots_version(dbfake, release, note_sent):
    log, state = dbfake
    saved = {"id": RID, "key": "k", "version": "1.0", "status": release, "created_at": "t",
             "updated_at": "t", "title": "T"}
    state["answer"] = lambda s, p: [saved] if "exp_skill_registry" in s else [{"id": "v"}]
    body = {"id": RID, "skill": {"key": "k", "version": "1.0", "status": release},
            "release": release}
    if note_sent:
        body["note"] = "bad"
    assert client().post(f"{R}/skills/release", json=body).json() == saved
    skill_w, version_w = writes(log)
    assert skill_w[1].startswith("UPDATE public.exp_skill_registry")
    assert version_w[1].startswith("INSERT INTO public.exp_skill_version")
    v = values(version_w[2])
    expect = {"skill_key": "k", "version": "1.0", "status": release,
              "published_by": CLAIMS["sub"],
              "manifest": {"key": "k", "version": "1.0", "status": release, "title": "T"}}
    if note_sent:
        expect["note"] = "bad"
    assert v == expect


def test_release_without_id_inserts(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": RID, "key": "k", "version": None}]
    client().post(f"{R}/skills/release", json={"skill": {"key": "k"}, "release": "published"})
    assert writes(log)[0][1].startswith("INSERT INTO public.exp_skill_registry")


def test_build_map_writes(dbfake):
    log, state = dbfake
    client().patch(f"{R}/build-map/{RID}", json={"state": "built"})
    (w,) = writes(log)
    assert values(w[2]) == {"state": "built", "id_1": RID} and "RETURNING" not in w[1]
    state["answer"] = lambda s, p: [{"id": RID}] if s.startswith("INSERT") else []
    step = {"track": "customer", "step_no": 3, "title": "T", "description": None,
            "emits_event": None, "consumes_event": None, "state": "not_built", "notes": None,
            "sort_order": 3}
    assert client().post(f"{R}/build-map", json=step).json() == {"id": RID}
    assert values(writes(log)[-1][2]) == step


def test_eval_writes(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": RID}] if s.startswith(("INSERT", "UPDATE")) else []
    client().post(f"{R}/evals", json={"skill_key": "k", "name": "n", "fixture": {"a": 1},
                                      "expected": [1], "status": "untested"})
    v = values(writes(log)[-1][2])
    assert v == {"skill_key": "k", "name": "n", "fixture": {"a": 1}, "expected": [1],
                 "status": "untested"}
    client().post(f"{R}/evals/{RID}/result", json={"status": "pass"})
    v = values(writes(log)[-1][2])
    assert v["status"] == "pass" and v["last_result"] == {"manual": True, "status": "pass"}
    assert v["last_run_at"] is not None
    assert client().post(f"{R}/evals/{RID}/result", json={"status": "maybe"}).status_code == 422


def test_sandbox_writes(dbfake):
    log, _ = dbfake
    client().put(f"{S}/weights/impact", json={"weight": 1.25})
    client().post(f"{S}/feedback", json={"entity_id": ENT, "entity_type": None,
                                         "opportunity_key": "lane:Reviews", "signal": "declined",
                                         "snooze_until": None})
    weight, fb = writes(log)
    assert values(weight[2]) == {"weight": 1.25, "key_1": "impact"}
    assert values(fb[2]) == {"entity_id": ENT, "entity_type": None,
                             "opportunity_key": "lane:Reviews", "signal": "declined",
                             "snooze_until": None}


def test_rls_refusal_is_403(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "exp_nora_weights"')
    assert client().put(f"{S}/weights/impact", json={"weight": 1}).status_code == 403
