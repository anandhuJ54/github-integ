"""xmp /enterprise/ops endpoints (no live DB/auth): the SQL each sends and the tolerated errors."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from xmp.routers.enterprise_data import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
ORG = "11111111-1111-4111-8111-111111111111"
CRM = "22222222-2222-4222-8222-222222222222"


# the website tests' fake connection (copied when those moved to marketing, surface audit
# 2026-10-25)

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


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS and not write
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def selects(log, table):
    return [x for x in log if f"FROM public.{table}" in x[1]]


def test_need_a_signed_in_user():
    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    assert c.get("/xmp/enterprise/ops/ingestion", params={"org_id": ORG}).status_code == 403
    assert c.get("/xmp/enterprise/ops/settings", params={"org_id": ORG}).status_code == 403


def test_ingestion_without_crm_feeds_skips_sync_jobs(dbfake):
    log, _ = dbfake
    r = client().get("/xmp/enterprise/ops/ingestion", params={"org_id": ORG})
    assert r.json() == {"crm": [], "oauth": [], "jobs": []}
    (crm,) = selects(log, "crm_integrations")
    assert "public.crm_integrations.config" in crm[1] and "ORDER BY public.crm_integrations.created_at DESC" in crm[1]
    (oauth,) = selects(log, "oauth_connections")
    assert "access_token" not in oauth[1]  # the page's column list
    assert oauth[2]["entity_type_1"] == "organization" and oauth[2]["entity_id_1"] == ORG
    assert not selects(log, "sync_jobs")


def test_ingestion_reads_jobs_of_the_crm_feeds(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if "FROM public.crm_integrations" in sql:
            return [{"id": CRM, "records_synced": 4, "config": {"crm_record_count": 5}}]
        if "FROM public.sync_jobs" in sql:
            return [{"id": "j1", "records_processed": 3}]
        return []

    state["answer"] = answer
    r = client().get("/xmp/enterprise/ops/ingestion", params={"org_id": ORG}).json()
    assert r["crm"][0]["config"] == {"crm_record_count": 5} and r["jobs"] == [{"id": "j1", "records_processed": 3}]
    (jobs,) = selects(log, "sync_jobs")
    assert "integration_id IN" in jobs[1] and CRM in jobs[2].values()
    assert "ORDER BY public.sync_jobs.started_at DESC NULLS LAST" in jobs[1]
    assert 200 in jobs[2].values()


def test_settings_reads_and_shapes(dbfake):
    log, state = dbfake

    def answer(sql, params):
        if "FROM public.enterprise_settings" in sql:
            return [{"id": "s", "org_id": ORG}]
        if "count(*)" in sql:
            return [{"n": 3}]
        if "FROM public.invitations" in sql:
            return [{"id": "i"}]
        return []

    state["answer"] = answer
    r = client().get("/xmp/enterprise/ops/settings", params={"org_id": ORG}).json()
    assert r == {"settings": {"id": "s", "org_id": ORG}, "users": [], "invites": [{"id": "i"}],
                 "sso": [], "integrations": 3}
    (inv,) = selects(log, "invitations")
    assert "ORDER BY public.invitations.invited_at DESC" in inv[1] and 50 in inv[2].values()
    (sso,) = selects(log, "sso_config")
    assert "client_secret" not in sso[1]
    (ur,) = selects(log, "user_roles")
    assert 200 in ur[2].values()


def test_settings_maybe_single_ignored_on_two_rows(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"id": "a"}, {"id": "b"}] if "enterprise_settings" in s else []
    assert client().get("/xmp/enterprise/ops/settings", params={"org_id": ORG}).json()["settings"] is None


def test_errors_are_ignored_as_the_page_did(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation(
        'invalid input syntax for type uuid: "x"')
    r = client().get("/xmp/enterprise/ops/settings", params={"org_id": "x"})
    assert r.status_code == 200
    assert r.json() == {"settings": None, "users": [], "invites": [], "sso": [], "integrations": 0}
    r = client().get("/xmp/enterprise/ops/ingestion", params={"org_id": "x"})
    assert r.json() == {"crm": [], "oauth": [], "jobs": []}
