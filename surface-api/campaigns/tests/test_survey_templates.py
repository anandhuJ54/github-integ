"""Survey templates for a vertical (fake connection, no live DB or auth): the SQL sent, the "All"
vertical, 404 / 422, and the read running as the signed-in user (increment
surface-spec/campaigns/campaigns-xmp-tables)."""
from __future__ import annotations

from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.campaigns.survey_template import services as svc
from surfaces.campaigns.survey_template.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
TEMPLATES = [
    {"id": 12, "name": "Mortgage only", "description": None, "video_link": None},
    {"id": 11, "name": "All verticals", "description": "d11", "video_link": "v11"},
]


class Conn:
    """Answers each SELECT by the table it reads; logs (sql, params)."""

    def __init__(self, verticals: dict[int, str]):
        self.verticals, self.sent = verticals, []

    def cursor(self):
        conn = self

        class C:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def execute(self, s, p=None):
                s = " ".join(s.split())
                conn.sent.append((s, p or {}))
                self.rows = conn.answer(s, p or {})

            def fetchall(self):
                return self.rows

        return C()

    def answer(self, s: str, p: dict) -> list[dict]:
        if s.startswith("SELECT xmp.verticals.id"):
            rows = [{"id": i, "name": n, "status": 0} for i, n in sorted(self.verticals.items())]
            if "verticals.name = " in s:
                return [r for r in rows if r["name"] == "All"][:1]
            return [r for r in rows if r["id"] == p["id_1"]]
        if s.startswith("SELECT campaigns.survey_templates.id"):
            return TEMPLATES
        raise AssertionError(s)


def test_lists_active_templates_linked_to_the_vertical_or_all():
    conn = Conn({1: "Real Estate", 2: "Mortgage", 3: "All"})
    assert svc.list_survey_templates_for_vertical(conn, 2) == TEMPLATES
    s, p = conn.sent[-1]
    assert s == (
        "SELECT campaigns.survey_templates.id, campaigns.survey_templates.name, "
        "campaigns.survey_templates.description, campaigns.survey_templates.video_link "
        "FROM campaigns.survey_templates WHERE campaigns.survey_templates.status = %(status_1)s::INTEGER "
        "AND (EXISTS (SELECT campaigns.vertical_survey_templates.id FROM campaigns.vertical_survey_templates "
        "WHERE campaigns.vertical_survey_templates.survey_template_id = campaigns.survey_templates.id "
        "AND campaigns.vertical_survey_templates.vertical_id IN "
        "(%(vertical_id_1_1)s::BIGINT, %(vertical_id_1_2)s::BIGINT) "
        "AND campaigns.vertical_survey_templates.deleted_at IS NULL)) "
        "ORDER BY campaigns.survey_templates.updated_at DESC, campaigns.survey_templates.id DESC"
    )
    assert p == {"status_1": 1, "vertical_id_1_1": 2, "vertical_id_1_2": 3}


def test_without_an_all_vertical_only_the_vertical_itself():
    conn = Conn({1: "Real Estate", 2: "Mortgage"})
    svc.list_survey_templates_for_vertical(conn, 1)
    _, p = conn.sent[-1]
    assert sorted(v for k, v in p.items() if k.startswith("vertical_id_1")) == [1]


def test_asking_for_the_all_vertical_uses_it_once():
    conn = Conn({1: "Real Estate", 3: "All"})
    svc.list_survey_templates_for_vertical(conn, 3)
    _, p = conn.sent[-1]
    assert sorted(v for k, v in p.items() if k.startswith("vertical_id_1")) == [3]


def test_unknown_vertical_raises_before_reading_templates():
    conn = Conn({1: "Real Estate"})
    with pytest.raises(svc.VerticalNotFound, match="Vertical '9' not found"):
        svc.list_survey_templates_for_vertical(conn, 9)
    assert len(conn.sent) == 1


# --- endpoint ---------------------------------------------------------------------------------

@pytest.fixture
def leases(monkeypatch):
    leased: list = []

    @contextmanager
    def role_connection(role, claims=None, *, write=False, fresh=False):
        leased.append((role, claims, write))
        yield Conn({1: "Real Estate", 2: "Mortgage", 3: "All"})

    monkeypatch.setattr(core_db, "role_connection", role_connection)
    return leased


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def test_endpoint_returns_the_summaries_as_the_signed_in_user(leases):
    r = client().get("/campaigns/survey-templates", params={"vertical_id": 2})
    assert r.status_code == 200 and r.json() == TEMPLATES
    assert leases == [("authenticated", CLAIMS, False)]


def test_endpoint_unknown_vertical_is_404(leases):
    r = client().get("/campaigns/survey-templates", params={"vertical_id": 9})
    assert r.status_code == 404 and r.json() == {"detail": "Vertical '9' not found"}


@pytest.mark.parametrize("params", [{}, {"vertical_id": 0}, {"vertical_id": "x"}])
def test_endpoint_bad_vertical_id_is_422(leases, params):
    assert client().get("/campaigns/survey-templates", params=params).status_code == 422
    assert leases == []


def test_endpoint_needs_a_signed_in_user():
    app = FastAPI()
    app.include_router(router)
    r = TestClient(app).get("/campaigns/survey-templates", params={"vertical_id": 1})
    assert r.status_code == 403
