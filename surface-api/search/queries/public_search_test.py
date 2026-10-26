"""search.ts + voce.ts ports (no live DB/auth): the SQL each call sends, the allow-list, the
roles (anon when signed out), the error handling the TS had. The boost update moved to admin
(admin/queries/search_console_test.py, surface audit 2026-10-25)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from _base.db.sql import capped, compile_sql
from _base.server_fn import optional_user
from search.queries import public_search as q
from search.queries import voce as v
from search.routers.public_search import router as search_router
from search.routers.voce import router as voce_router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
AID = "11111111-1111-4111-8111-111111111111"


def sql(stmt) -> str:
    return " ".join(compile_sql(capped(stmt))[0].split())


# --- the RPC allow-list ------------------------------------------------------------------------

def test_search_docs_casts_given_args_omits_undefined_and_caps():
    s, p = q.rpc_sql("search_docs", {"p_q": "plumber", "p_gcid": None, "p_min_rating": 4.0,
                                     "p_claimed": True, "p_sort": "rank", "p_limit": 20,
                                     "p_offset": 40})
    assert s == ("select * from public.search_docs(p_q => %(p_q)s::text, "
                 "p_min_rating => %(p_min_rating)s::numeric, p_claimed => %(p_claimed)s::boolean, "
                 "p_sort => %(p_sort)s::text, p_limit => %(p_limit)s::integer, "
                 "p_offset => %(p_offset)s::integer) limit 1000")
    assert p == {"p_q": "plumber", "p_min_rating": 4.0, "p_claimed": True, "p_sort": "rank",
                 "p_limit": 20, "p_offset": 40}


def test_count_and_facets_are_scalar_suggest_is_rows():
    assert q.rpc_sql("search_docs_count", {"p_loc": "Austin"})[0] == \
        "select public.search_docs_count(p_loc => %(p_loc)s::text) as v"
    assert q.rpc_sql("search_docs_facets", {})[0] == "select public.search_docs_facets() as v"
    assert q.rpc_sql("search_docs_suggest", {"p_q": "ab", "p_limit": 8})[0].endswith("limit 1000")


@pytest.mark.parametrize("name,args", [
    ("exp_graph_upsert_nodes", {}),
    ("search_docs_count", {"p_sort": "rank"}),
    ("search_docs_suggest", {"p_gcid": "gcid:x"}),
])
def test_outside_the_allow_list_is_refused(name, args):
    with pytest.raises(q.UnknownRpc):
        q.rpc_sql(name, args)


# --- voce SQL ----------------------------------------------------------------------------------

def test_author_by_id_or_name_newest_24():
    s = sql(v.author_stmt(AID, "Jane Doe"))
    assert "WHERE public.exp_voce_article.author_entity_id = " in s
    assert "OR public.exp_voce_article.author_name = " in s
    assert "ORDER BY public.exp_voce_article.published_on DESC" in s
    assert compile_sql(v.author_stmt(AID, "Jane Doe"))[1]["param_2"] == 24
    assert "author_name" not in sql(v.author_stmt(AID, None)).split("WHERE")[1]


def test_hub_category_and_topic_newest_60():
    s = sql(v.hub_stmt("gcid:x", "roofing"))
    assert "exp_voce_article.gcid = " in s and "exp_voce_article.topic = " in s
    assert "published_on DESC" in s and compile_sql(v.hub_stmt("gcid:x", None))[1]["param_1"] == 60
    assert "topic =" not in sql(v.hub_stmt("gcid:x", None))


def test_featured_boosted_unordered_60():
    s = sql(v.featured_stmt("gcid:x"))
    assert "exp_voce_article.boosted IS true" in s and "gcid = " in s and "ORDER BY" not in s
    assert "gcid =" not in sql(v.featured_stmt(None))


def test_all_articles_nulls_last_capped():
    s = sql(v.all_stmt())
    assert "ORDER BY public.exp_voce_article.published_on DESC NULLS LAST LIMIT" in s
    assert compile_sql(capped(v.all_stmt()))[1]["param_1"] == 1000


# --- endpoints (fake connection) ---------------------------------------------------------------

class Cur:
    def __init__(self, conn):
        self.conn, self.rows, self.description = conn, [], [("x",)]

    def execute(self, s, p=None):
        self.conn.log.append((s, p or {}))
        out = self.conn.answer(s, p or {})
        if isinstance(out, Exception):
            raise out
        self.rows = out

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
    def transaction(self):
        yield

    def cursor(self):
        return Cur(self)


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
    app.include_router(search_router)
    app.include_router(voce_router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    app.dependency_overrides[optional_user] = lambda: user
    return TestClient(app)


def test_results_signed_out_runs_as_anon_and_shapes(fake):
    log, leases, state = fake

    def answer(s, p):
        if "search_docs(" in s:
            return [{"id": "d1", "name": "A &amp; B"}]
        if "search_docs_count(" in s:
            return [{"v": 41}]
        return [{"v": {"categories": []}}]

    state["answer"] = answer
    r = client(user=None).get("/search/public/results", params={
        "p_q": "plumber", "p_min_rating": 4, "p_claimed": "true", "p_sort": "rank",
        "p_limit": 20, "p_offset": 0})
    assert r.status_code == 200 and leases == [("anon", None, False)]
    assert r.json() == {"rows": [{"id": "d1", "name": "A &amp; B"}], "count": 41,
                        "facets": {"categories": []}, "error": None}
    docs_params = log[0][1]
    assert docs_params["p_claimed"] is True and docs_params["p_min_rating"] == 4.0
    assert "p_gcid" not in docs_params and "p_sort" not in log[1][1]


def test_results_signed_in_runs_as_the_user(fake):
    _, leases, _ = fake
    client().get("/search/public/results")
    assert leases == [("authenticated", CLAIMS, False)]


def test_results_one_failure_keeps_the_others_and_reports_its_message(fake):
    _, _, state = fake
    state["answer"] = lambda s, p: psycopg.errors.QueryCanceled("canceling statement") \
        if "search_docs_count(" in s else ([{"v": None}] if "facets" in s else [])
    body = client(user=None).get("/search/public/results").json()
    assert body["rows"] == [] and body["count"] is None and body["error"] == "canceling statement"


def test_results_limit_over_cap_is_422(fake):
    assert client().get("/search/public/results", params={"p_limit": 5000}).status_code == 422


def test_suggest_error_is_no_rows(fake):
    _, leases, state = fake
    state["answer"] = lambda s, p: psycopg.errors.UndefinedFunction("x")
    r = client(user=None).get("/search/public/suggest", params={"p_q": "pl"})
    assert r.json() == [] and leases == [("anon", None, False)]


def test_voce_public_reads_anon_and_errors_are_empty(fake):
    _, leases, state = fake
    state["answer"] = lambda s, p: [{"id": AID}]
    assert client(user=None).get("/search/voce/hub", params={"gcid": "gcid:x"}).json() == \
        [{"id": AID}]
    assert leases == [("anon", None, False)]
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation("bad uuid")
    assert client(user=None).get("/search/voce/author", params={"entity_id": "x"}).json() == []
    assert client(user=None).get("/search/voce/featured").json() == []


def test_voce_all_articles_anon_when_signed_out_and_surfaces_errors(fake):
    _, leases, state = fake
    assert client(user=None).get("/search/voce/articles").json() == []
    assert leases == [("anon", None, False)]
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege("permission denied")
    assert client().get("/search/voce/articles").status_code == 403
