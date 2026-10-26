"""/srp/claim-profile: the claim page's profile read (replaced its direct Supabase calls; no live DB/auth)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.srp.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}


class Diag:
    def __init__(self, msg):
        self.message_primary = msg


class DbErr(psycopg.Error):
    def __init__(self, msg):
        super().__init__(msg)
        self._msg = msg

    @property
    def diag(self):  # psycopg.Error.diag is read-only; fake it
        return Diag(self._msg)


class FakeConn:
    def __init__(self, log, answer, role, write):
        self.log, self.answer, self.role, self.write = log, answer, role, write

    @contextmanager
    def transaction(self):
        yield

    def cursor(self):
        conn = self

        class Cur:
            description = None

            def execute(self, sql, params=None):
                conn.log.append((conn.role, conn.write, sql, params))
                rows = conn.answer(sql, params or {})
                if isinstance(rows, Exception):
                    raise rows
                self._rows = rows or []
                self.description = [("x",)] if rows is not None else None

            def fetchall(self):
                return self._rows

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return Cur()


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS  # always as the signed-in user
        yield FakeConn(log, lambda s, p: state["answer"](s, p), role, write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("get", "/srp/claim-profile/x"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path).status_code == 403


# --- /claim/{slug} ---------------------------------------------------------------------------

def test_claim_profile_with_category_label(dbfake):
    _, state = dbfake
    prof = {"id": "p1", "slug": "s", "gcid": "gcid:insurance_agent"}

    def answer(sql, params):
        if "FROM public.professionals" in sql:
            return [prof]
        return [{"license_label": "Producer License"}]

    state["answer"] = answer
    r = client().get("/srp/claim-profile/s")
    assert r.json() == {"prof": prof, "licenseLabel": "Producer License"}


def test_claim_profile_default_label_and_404(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"id": "p1", "gcid": None}] if "professionals" in s else []
    assert client().get("/srp/claim-profile/s").json()["licenseLabel"] == "License Number"
    state["answer"] = lambda s, p: []
    assert client().get("/srp/claim-profile/s").status_code == 404
