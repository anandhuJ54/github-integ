"""A local sign-in token reaches exactly ten SRP routes and nothing else (srp/local-login-srp-home, srp/home-page-data, srp/srs-page-schema, srp/profile-page-schema, srp/insights-page-schema, srp/web-analytics-page-schema, srp/connections-page-schema).

Walks the real route table of the composed app, so a route that reuses the SRP check by accident, or a
router that reaches the database as the `authenticated` role with local claims, fails here. A second-model
review found the first version of this test too narrow: it only looked outside SRP, and skipped routes
that check the token through `optional_user`.
"""
from __future__ import annotations

import re

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from _base import auth
from _base.config import get_settings
from _base.server_fn import optional_user
from app.main import app

SECRET = "L" * 32

# The only routes that know what to do with a local session: each one either answers from `srp_cleanup`
# for the user's own seat or returns a fixed value. Everything else must refuse a local token.
LOCAL_AWARE = {
    ("GET", "/srp/auth/me"),
    ("GET", "/srp/seat/professional/{pro_id}"),
    ("POST", "/srp/rpc/{name}"),
    ("GET", "/srp/seat/listings"),
    ("GET", "/srp/seat/professional/{pro_id}/home"),  # srp/home-page-data
    ("GET", "/srp/seat/professional/{pro_id}/srs"),  # srp/srs-page-schema
    ("GET", "/srp/seat/professional/{pro_id}/profile"),  # srp/profile-page-schema
    ("GET", "/srp/seat/professional/{pro_id}/insights"),  # srp/insights-page-schema
    ("GET", "/srp/seat/professional/{pro_id}/website"),  # srp/web-analytics-page-schema
    ("GET", "/srp/seat/professional/{pro_id}/connections"),  # srp/connections-page-schema
}


def _calls(dependant) -> list:
    out = []
    for dep in dependant.dependencies:
        out.append(dep.call)
        out.extend(_calls(dep))
    return out


def _routes() -> list[APIRoute]:
    return [r for r in app.routes if isinstance(r, APIRoute)]


def _methods(route: APIRoute) -> list[str]:
    return sorted(route.methods - {"HEAD", "OPTIONS"})


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", "1")
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", SECRET)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_exactly_the_local_aware_routes_use_the_dependency_that_accepts_local_tokens():
    found = {
        (m, r.path) for r in _routes() if auth.verify_srp_jwt in _calls(r.dependant) for m in _methods(r)
    }
    assert found == LOCAL_AWARE


def test_the_srp_auth_routes_are_mounted():
    paths = {r.path for r in _routes()}
    assert {"/srp/auth/login", "/srp/auth/me"} <= paths


def test_every_other_route_that_checks_a_token_refuses_a_local_token():
    """Including the /srp/fn/* review routes (they reach the database as `authenticated` and one calls a
    paid model API), the dashboard and directory reads, and the routes that check through optional_user."""
    token, _ = auth.issue_local_token(7, "mock.users.7@example.test", hours=1)
    headers = {"authorization": f"Bearer {token}"}
    client = TestClient(app)
    checked = 0
    wrong: list[str] = []
    for route in _routes():
        calls = _calls(route.dependant)
        if auth.verify_srp_jwt in calls:
            continue
        if auth.verify_jwt not in calls and optional_user not in calls:
            continue
        path = re.sub(r"\{[^}]+\}", "x", route.path)
        for method in _methods(route):
            checked += 1
            got = client.request(method, path, headers=headers)
            if got.status_code != 401:
                wrong.append(f"{method} {route.path} -> {got.status_code}")
    assert checked > 100, "the route table walk found too few routes to mean anything"
    assert wrong == [], "\n".join(wrong)


def test_the_srp_review_routes_are_among_those_that_refuse_a_local_token():
    token, _ = auth.issue_local_token(7, "mock.users.7@example.test", hours=1)
    client = TestClient(app)
    for name in ("draftReviewReply", "checkReplyCompliance", "saveReviewReply", "flagReview"):
        got = client.post(f"/srp/fn/{name}", json={"data": {}}, headers={"authorization": f"Bearer {token}"})
        assert got.status_code == 401, name
