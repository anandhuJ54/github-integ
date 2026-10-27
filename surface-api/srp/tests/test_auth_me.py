"""GET /srp/auth/me (srp/local-login-srp-home, task 5): the signed-in local user and landing path."""
from __future__ import annotations

import jwt
import pytest

from _base import auth
from _base.config import get_settings


def _bearer(token: str) -> dict:
    return {"authorization": f"Bearer {token}"}


def _local_token(user_id: int = 7) -> str:
    return auth.issue_local_token(user_id, "mock.users.7@example.test", hours=1)[0]


def test_me_returns_the_user_and_landing_for_a_local_token(anon_client, store):
    r = anon_client.get("/srp/auth/me", headers=_bearer(_local_token()))
    assert r.status_code == 200
    assert r.json() == {
        "user": {"id": str(store.USER_ID), "email": "mock.users.7@example.test", "first_name": "Riley", "last_name": "Okafor"},
        "landing": {"path": f"/seat/professional/{store.SEAT_ID}"},
    }
    assert "password_digest" not in r.text


def test_me_without_a_token_is_refused(anon_client, store):
    assert anon_client.get("/srp/auth/me").status_code in (401, 403)


def test_me_with_a_garbage_token_is_401(anon_client, store):
    assert anon_client.get("/srp/auth/me", headers=_bearer("not.a.jwt")).status_code == 401


def test_me_is_404_when_local_sign_in_is_off_and_never_reaches_the_database(anon_client, store, monkeypatch):
    token = _local_token()
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    get_settings.cache_clear()
    r = anon_client.get("/srp/auth/me", headers=_bearer(token))
    assert r.status_code in (401, 404)
    assert store.db.log == []


def test_a_supabase_token_passes_the_dependency_but_is_not_a_local_session(anon_client, store, monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "S" * 32)
    token = jwt.encode(
        {"sub": "abc", "aud": "authenticated", "role": "authenticated", "exp": 4102444800},
        "S" * 32,
        algorithm="HS256",
    )
    r = anon_client.get("/srp/auth/me", headers=_bearer(token))
    assert r.status_code == 403 and r.json() == {"detail": "local_session_required"}
    assert store.db.log == []


@pytest.mark.parametrize(
    "field,value",
    [("deleted_at", "2025-01-01"), ("deactivated_at", "2025-01-01"), ("is_manual_deactivated", True)],
)
def test_a_user_deactivated_after_sign_in_loses_the_session(anon_client, store, field, value):
    token = _local_token()
    store.user[field] = value
    assert anon_client.get("/srp/auth/me", headers=_bearer(token)).status_code == 401


def test_a_token_for_a_user_that_no_longer_exists_is_401(anon_client, store):
    assert anon_client.get("/srp/auth/me", headers=_bearer(_local_token(user_id=999))).status_code == 401


def test_a_user_without_a_seat_gets_403(anon_client, store):
    store.seat = None
    r = anon_client.get("/srp/auth/me", headers=_bearer(_local_token()))
    assert r.status_code == 403 and r.json() == {"detail": "no_professional_seat"}
