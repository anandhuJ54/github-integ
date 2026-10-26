"""geo-coords.ts port (no live DB): the exp_us_cities read, the cap, the roles."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from surfaces.search.queries import geo as q
from surfaces.search.routers.geo import router

from _base.db import session as core_db
from _base.db.sql import capped, compile_sql
from _base.server_fn import optional_user

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}


def test_centroids_every_state_of_the_named_cities_capped():
    s, p = compile_sql(capped(q.centroids_stmt(["Springfield", "Austin"])))
    s = " ".join(s.split())
    assert s.startswith("SELECT public.exp_us_cities.city, public.exp_us_cities.state_abbr, "
                        "public.exp_us_cities.lat, public.exp_us_cities.lng FROM public.exp_us_cities "
                        "WHERE public.exp_us_cities.city IN (")
    assert "state_abbr =" not in s and {"Springfield", "Austin", 1000} <= set(p.values())


class Cur:
    def __init__(self, answer):
        self.answer, self.rows = answer, []

    def execute(self, s, p=None):
        out = self.answer(s, p)
        if isinstance(out, Exception):
            raise out
        self.rows = out

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def fake(monkeypatch):
    leases: list = []
    state = {"answer": lambda s, p: []}

    class Conn:
        def cursor(self):
            return Cur(lambda s, p: state["answer"](s, p))

    @contextmanager
    def role_connection(role, claims=None, *, write=False, fresh=False):
        leases.append((role, claims, write))
        yield Conn()

    monkeypatch.setattr(core_db, "role_connection", role_connection)
    return leases, state


def client(user=CLAIMS) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[optional_user] = lambda: user
    return TestClient(app)


def test_signed_out_runs_as_anon(fake):
    leases, state = fake
    row = {"city": "Springfield", "state_abbr": "IL", "lat": 39.8, "lng": -89.6}
    state["answer"] = lambda s, p: [row]
    r = client(user=None).post("/search/geo/city-centroids", json={"cities": ["Springfield"]})
    assert r.json() == [row] and leases == [("anon", None, False)]


def test_signed_in_runs_as_the_user(fake):
    leases, _ = fake
    client().post("/search/geo/city-centroids", json={"cities": ["Austin"]})
    assert leases == [("authenticated", CLAIMS, False)]


def test_empty_list_needs_no_connection_and_errors_are_no_rows(fake):
    leases, state = fake
    assert client().post("/search/geo/city-centroids", json={"cities": []}).json() == []
    assert leases == []
    state["answer"] = lambda s, p: psycopg.errors.QueryCanceled("x")
    assert client().post("/search/geo/city-centroids", json={"cities": ["A"]}).json() == []


def test_more_than_200_cities_or_extra_keys_is_422(fake):
    assert client().post("/search/geo/city-centroids",
                         json={"cities": ["c"] * 201}).status_code == 422
    assert client().post("/search/geo/city-centroids",
                         json={"cities": [], "state": "IL"}).status_code == 422
