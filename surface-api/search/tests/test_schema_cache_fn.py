"""getCachedSchema / cacheSchema (DB faked). Moved from graph/routers/graph_fn_test.py with the
functions, surface audit 2026-10-25."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from surfaces.search.schema_cache import router as schema_cache_fn

CLAIMS = {"sub": "u-1", "role": "authenticated", "email": "a@x.com"}


class _Cursor:
    def __init__(self, db, role):
        self.db, self.role, self._rows = db, role, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql: str, params: Any = None) -> None:
        self.db.log.append((self.role, " ".join(sql.split()), params))
        self._rows = next((list(r) for n, r in self.db.responses if n in sql), [])

    def fetchall(self) -> list[dict]:
        return self._rows


class _Conn:
    def __init__(self, db, role):
        self.db, self.role = db, role

    def cursor(self):
        return _Cursor(self.db, self.role)

    @contextmanager
    def transaction(self):
        yield


class _FakeDB:
    def __init__(self):
        self.responses: list[tuple[str, Any]] = []
        self.log: list[tuple[str, str, Any]] = []

    def on(self, needle: str, result: Any):
        self.responses.append((needle, result))
        return self

    @contextmanager
    def role_connection(self, role, jwt_claims=None, *, write=False, fresh=False):
        yield _Conn(self, role)

    def sql(self, needle: str):
        return [e for e in self.log if needle in e[1]]


@pytest.fixture
def fakedb(monkeypatch):
    def make(*modules):
        db = _FakeDB()
        for m in modules:
            monkeypatch.setattr(m, "role_connection", db.role_connection)
        return db
    return make


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(schema_cache_fn.router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def test_schema_cache_roundtrip(client, fakedb):
    db = fakedb(schema_cache_fn)
    db.on("select schema_json", [{"schema_json": {"@type": "Thing", "n": 1},
                                  "generated_at": "2026-10-01T00:00:00+00:00", "is_valid": True}])
    key = {"entityType": "pro", "entityId": "1", "pageType": "profile"}
    res = client.post("/search/fn/getCachedSchema", json={"data": key})
    assert res.json() == {"schemaJson": '{"@type":"Thing","n":1}',
                          "generatedAt": "2026-10-01T00:00:00+00:00"}
    put = client.post("/search/fn/cacheSchema",
                      json={"data": {**key, "schemaJson": '{"a":1}', "nodeCount": 3}})
    assert put.json() == {"ok": True}
    ins = db.sql("insert into schema_cache")[0]
    assert ins[0] == "service_role" and ins[2][:3] == ("pro", "1", "profile")


def test_schema_cache_miss_is_null(client, fakedb):
    fakedb(schema_cache_fn)
    key = {"entityType": "pro", "entityId": "1", "pageType": "profile"}
    assert client.post("/search/fn/getCachedSchema", json={"data": key}).json() is None
