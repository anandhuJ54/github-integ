"""POST /srp/auth/login (srp/local-login-srp-home, task 4).

The database is replaced by a small stateful fake of `srp_cleanup.users` and `tier_agents`, so the
lock rule can be exercised across several attempts. SQL is matched by the markers the service uses.
"""
from __future__ import annotations

import logging

import bcrypt
import pytest

from _base import auth
from _base.config import get_settings
from surfaces.srp.auth import services


def _login(anon_client, store, password=None, email="mock.users.7@example.test"):
    password = store.PASSWORD if password is None else password
    return anon_client.post("/srp/auth/login", json={"email": email, "password": password})


# --- criterion 1 ------------------------------------------------------------------------------


def test_correct_login_returns_a_token_and_the_landing_path(anon_client, store):
    r = _login(anon_client, store)
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "Bearer"
    assert body["user"] == {
        "id": str(store.USER_ID),
        "email": "mock.users.7@example.test",
        "first_name": "Riley",
        "last_name": "Okafor",
    }
    assert body["landing"] == {"path": f"/seat/professional/{store.SEAT_ID}"}
    claims = auth.verify_srp_jwt(
        type("C", (), {"scheme": "Bearer", "credentials": body["access_token"]})()
    )
    assert claims["sub"] == str(store.USER_ID)
    assert isinstance(body["expires_at"], str) and body["expires_at"].endswith("Z")
    assert store.logins == 1


def test_the_response_never_contains_the_password_digest(anon_client, store):
    body = _login(anon_client, store).text
    assert "password_digest" not in body
    assert store.user["password_digest"] not in body


def test_email_is_looked_up_lower_cased(anon_client, store):
    assert _login(anon_client, store, email="  Mock.Users.7@EXAMPLE.test ").status_code == 200
    assert store.lookups[0][0] == "mock.users.7@example.test"


# --- criteria 2 and 4 -------------------------------------------------------------------------


def test_wrong_password_and_unknown_email_look_the_same(anon_client, store):
    wrong = _login(anon_client, store, password=store.WRONG)
    unknown = _login(anon_client, store, email="nobody@example.test")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "invalid_credentials"}


def test_a_hash_check_runs_even_when_the_user_does_not_exist(anon_client, store, monkeypatch):
    calls = []
    real = bcrypt.checkpw
    monkeypatch.setattr(services.bcrypt, "checkpw", lambda p, h: calls.append(h) or real(p, h))
    _login(anon_client, store, email="nobody@example.test")
    assert len(calls) == 1  # the dummy digest, so timing does not reveal the missing user


@pytest.mark.parametrize(
    "field,value",
    [("deleted_at", "2025-01-01"), ("deactivated_at", "2025-01-01"), ("is_manual_deactivated", True)],
)
def test_deleted_or_deactivated_users_are_refused_without_counting(anon_client, store, field, value):
    store.user[field] = value
    r = _login(anon_client, store)
    assert r.status_code == 401 and r.json() == {"detail": "invalid_credentials"}
    assert store.misses == [] and store.logins == 0


def test_a_malformed_stored_digest_is_a_refusal_not_a_server_error(anon_client, store):
    store.user["password_digest"] = "mock70b717e8eb8fe898d406"  # the mock data's digests look like this
    r = _login(anon_client, store)
    assert r.status_code == 401
    assert store.misses == [(1, False)]


def test_a_null_digest_is_a_refusal(anon_client, store):
    store.user["password_digest"] = None
    assert _login(anon_client, store).status_code == 401


def test_a_password_over_72_bytes_is_a_refusal_not_a_server_error(anon_client, store):
    assert _login(anon_client, store, password="p" * 100).status_code == 401


# --- criterion 3 ------------------------------------------------------------------------------


def test_five_misses_lock_the_user_and_the_correct_password_is_then_refused(anon_client, store):
    for _ in range(5):
        assert _login(anon_client, store, password=store.WRONG).status_code == 401
    assert store.misses == [(1, False), (2, False), (3, False), (4, False), (5, True)]
    assert _login(anon_client, store).status_code == 401  # correct password, still locked
    assert store.logins == 0


def test_after_the_lock_window_the_correct_password_works_and_resets_the_count(anon_client, store):
    store.user.update(failed_attempts=5, is_locked=False, locked_at="2025-01-01 00:00:00")
    assert _login(anon_client, store).status_code == 200
    assert store.logins == 1 and store.user["failed_attempts"] == 0


def test_a_miss_after_an_expired_lock_starts_a_fresh_count(anon_client, store):
    store.user.update(failed_attempts=5, is_locked=False, locked_at="2025-01-01 00:00:00")
    _login(anon_client, store, password=store.WRONG)
    assert store.misses == [(1, False)]


def test_a_locked_user_is_not_counted_again(anon_client, store):
    store.user.update(failed_attempts=5, is_locked=True)
    _login(anon_client, store, password=store.WRONG)
    assert store.misses == []


# --- criterion 5 ------------------------------------------------------------------------------


def test_a_user_without_a_professional_seat_gets_403_and_no_token(anon_client, store):
    store.seat = None
    r = _login(anon_client, store)
    assert r.status_code == 403
    assert r.json() == {"detail": "no_professional_seat"}
    assert "access_token" not in r.text
    assert store.logins == 0 and store.resets == 1


def test_the_seat_lookup_prefers_the_primary_mapping_then_the_lowest_id(anon_client, store):
    _login(anon_client, store)
    sql = " ".join(store.db.find("tier_agents")[0][2].lower().split())
    assert "order by coalesce(am.is_primary, false) desc, ta.id asc" in sql
    assert "ta.deleted_at is null" in sql and "limit 1" in sql


# --- criterion 8 ------------------------------------------------------------------------------


def test_login_is_404_when_local_sign_in_is_off(anon_client, store, monkeypatch):
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    get_settings.cache_clear()
    r = _login(anon_client, store)
    assert r.status_code == 404
    assert store.db.log == []  # not even a database call


def test_login_is_404_even_for_a_bad_body_when_local_sign_in_is_off(anon_client, store, monkeypatch):
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    get_settings.cache_clear()
    assert anon_client.post("/srp/auth/login", json={"email": "x"}).status_code == 404  # not 422: no hint it exists


def test_a_malformed_stored_digest_still_costs_a_full_hash_check(anon_client, store, monkeypatch):
    """Otherwise an unseeded user answers in microseconds and a known one in ~0.4 s, which lists accounts."""
    targets = []
    real = bcrypt.checkpw

    def spy(password, digest):
        targets.append(digest)
        return real(password, digest)

    monkeypatch.setattr(services.bcrypt, "checkpw", spy)
    store.user["password_digest"] = "mock70b717e8eb8fe898d406"
    assert _login(anon_client, store).status_code == 401
    assert services._DUMMY_DIGEST.encode() in targets


# --- criterion 15 -----------------------------------------------------------------------------


def test_no_password_digest_or_token_reaches_the_logs(anon_client, store, caplog):
    caplog.set_level(logging.DEBUG)
    ok = _login(anon_client, store)
    _login(anon_client, store, password=store.WRONG)
    text = caplog.text
    assert store.PASSWORD not in text and store.WRONG not in text
    assert store.user["password_digest"] not in text
    assert ok.json()["access_token"] not in text


# --- input limits -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "a@example.test", "password": ""},
        {"email": "a@example.test", "password": "p" * 129},
        {"email": "e" * 300 + "@example.test", "password": "x"},
        {"password": "x"},
        {"email": "a@example.test"},
    ],
)
def test_bad_bodies_are_422(anon_client, store, payload):
    assert anon_client.post("/srp/auth/login", json=payload).status_code == 422
    assert store.db.log == []
