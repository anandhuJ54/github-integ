"""Ops endpoints that replaced the browser's direct Supabase calls (no live DB/auth)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.ops.console.wiki import slugify
from surfaces.ops.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "email": "me@example.com",
          "role": "authenticated"}


class Cur:
    def __init__(self, rows):
        self.rows = rows or []
        self.description = [("x",)]

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
                super().__init__([])

            def execute(self, sql, params=None):
                self.rows = conn.execute(sql, params).rows

        return C()


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


def sqls(log, needle):
    return [(w, s, p) for w, s, p in log if needle in s]


@pytest.mark.parametrize("method,path", [
    ("get", "/ops/dev/overview"), ("get", "/ops/wiki/spaces"), ("delete", "/ops/dev/members/m1"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path).status_code == 403


def test_overview_is_one_round_trip(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": "x"}]
    body = client().get("/ops/dev/overview").json()
    assert body["launch"] == {"id": "x"} and len(body["teams"]) == 1
    assert sum(s == "savepoint fetch_many" for _, s, _ in log) == 1


def test_team_votes_are_the_signed_in_users(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"idea_id": "i1"}] if "exp_dev_idea_votes" in s else []
    body = client().get("/ops/dev/teams/t1").json()
    assert body["myVotes"] == ["i1"] and body["team"] is None
    (_, _, params), = sqls(log, "exp_dev_idea_votes")
    assert "me@example.com" in params.values()


# --- allow-listed dev writes -----------------------------------------------------------------

def test_insert_sets_who_and_returns_the_id(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": "new"}]
    r = client().post("/ops/dev/ideas", json={"team_id": "t1", "title": "x", "votes": 0,
                                              "submitted_by": "someone-else"})
    assert r.status_code == 400  # who-columns can't be sent
    r = client().post("/ops/dev/ideas", json={"team_id": "t1", "title": "x", "votes": 0})
    assert r.json() == {"id": "new"}
    (write, _, params), = sqls(log, "INSERT INTO public.exp_dev_ideas")
    assert write and params["submitted_by"] == "me@example.com"


def test_patch_ignores_id_and_created_at_but_refuses_unknown_columns(dbfake):
    log, _ = dbfake
    ok = client().patch("/ops/dev/members/m1", json={"id": "m1", "created_at": "x", "role": "lead"})
    assert ok.json() == {"ok": True}
    (_, sql, _), = sqls(log, "UPDATE public.exp_dev_members")
    assert "role" in sql and "created_at" not in sql.split("WHERE")[0]
    assert client().patch("/ops/dev/members/m1", json={"nope": 1}).status_code == 400


@pytest.mark.parametrize("method,path", [
    ("delete", "/ops/dev/teams/t1"),        # teams: update only
    ("patch", "/ops/dev/sprints/s1"),       # sprints: insert/delete only
    ("post", "/ops/dev/exp_contracts"),     # not a tracker entity
])
def test_operations_outside_the_allow_list_are_refused(dbfake, method, path):
    kw = {} if method == "delete" else {"json": {"name": "x"}}
    assert getattr(client(), method)(path, **kw).status_code == 400


def test_db_errors_reach_the_page(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.CheckViolation("value violates check")
    r = client().post("/ops/dev/members", json={"team_id": "t", "name": "n", "role": "bad"})
    assert r.status_code == 400 and r.json()["detail"]


def test_weekly_submit_is_an_upsert_on_member_and_week(dbfake):
    log, _ = dbfake
    client().put("/ops/dev/weekly-updates", json={"team_id": "t", "member_id": "m",
                                                  "week_start": "2026-10-19", "status": "submitted"})
    (_, sql, _), = sqls(log, "INSERT INTO public.exp_dev_weekly_updates")
    assert "ON CONFLICT (member_id, week_start) DO UPDATE" in sql


def test_weekly_week_start_is_bound_as_a_date(dbfake):
    log, _ = dbfake
    client().get("/ops/dev/weekly", params={"week_start": "2026-10-19"})
    (_, sql, _), = sqls(log, "FROM public.exp_dev_weekly_updates")
    assert "::DATE" in sql


def test_vote_once_then_already(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if sql.startswith("INSERT INTO public.exp_dev_idea_votes"):
            return psycopg.errors.UniqueViolation("duplicate key")
        return [{"n": 3}]

    state["answer"] = answer
    assert client().post("/ops/dev/ideas/i1/vote").json() == {"result": "already"}
    (_, _, params), = sqls(log, "UPDATE public.exp_dev_ideas")
    assert 3 in params.values()
    state["answer"] = lambda s, p: [{"n": 1}]
    assert client().post("/ops/dev/ideas/i1/vote").json() == {"result": "voted"}


# --- wiki ------------------------------------------------------------------------------------

# Expected values are what build-wiki.ts slugify() returns (checked with bun, 2026-10-23): the
# NFKD accents split words, exactly as in the browser.
@pytest.mark.parametrize("title,slug", [
    ("Hello, World!", "hello-world"), ("  Café  déjà vu ", "cafe-de-ja-vu"), ("!!!", "page"),
    ("a" * 100, "a" * 80), ("Ünïcödé ﬁle №5", "u-ni-co-de-file-o5"),
])
def test_slugify_matches_the_ts(title, slug):
    assert slugify(title) == slug


def test_create_doc_picks_a_free_slug_and_sets_the_author(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if "LIKE" in sql:
            return [{"slug": "plan"}, {"slug": "plan-2"}]
        return [{"id": "d1", "slug": params.get("slug")}]

    state["answer"] = answer
    r = client().post("/ops/wiki/docs", json={"space_id": "s1", "title": "Plan"})
    assert r.json()["slug"] == "plan-3"
    (_, _, params), = sqls(log, "INSERT INTO public.exp_wiki_docs")
    assert params["author"] == "me@example.com" and params["status"] == "draft"


def test_space_by_key_null_and_ambiguous(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: []
    assert client().get("/ops/wiki/spaces/nope").json() is None
    state["answer"] = lambda s, p: [{"id": 1}, {"id": 2}]
    assert client().get("/ops/wiki/spaces/dup").status_code == 409


def test_search_embeds_the_space(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [
        {"id": "d1", "slug": "a", "title": "A", "summary": None, "body_md": "",
         "space_key": "canon", "space_name": "Canon", "space_row": "s1"},
        {"id": "d2", "slug": "b", "title": "B", "summary": None, "body_md": "",
         "space_key": None, "space_name": None, "space_row": None},
    ]
    hits = client().get("/ops/wiki/search", params={"q": "canon"}).json()
    assert hits[0]["exp_wiki_spaces"] == {"key": "canon", "name": "Canon"}
    assert hits[1]["exp_wiki_spaces"] is None
    (_, sql, _), = sqls(log, "websearch_to_tsquery")
    assert "@@" in sql
    assert client().get("/ops/wiki/search", params={"q": "  "}).json() == []


def test_toggle_watch_removes_or_adds_for_the_signed_in_user(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": "w1"}] if s.startswith("SELECT") else []
    assert client().post("/ops/wiki/watch", json={"space_id": "s1"}).json() is False
    assert sqls(log, "DELETE FROM public.exp_wiki_watchers")
    state["answer"] = lambda s, p: []
    assert client().post("/ops/wiki/watch", json={"doc_id": "d1"}).json() is True
    (_, _, params), = sqls(log, "INSERT INTO public.exp_wiki_watchers")
    assert params["user_ref"] == "me@example.com"


def test_doc_patch_allow_list(dbfake):
    assert client().patch("/ops/wiki/docs/d1", json={"title": "x"}).json() == {"ok": True}
    assert client().patch("/ops/wiki/docs/d1", json={"author": "x"}).status_code == 400

