"""Tests for Supabase JWT verification: ES256 via JWKS, legacy HS256, and rejection paths."""
from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from _base import auth

_EC_KEY = ec.generate_private_key(ec.SECP256R1())
_OTHER_EC_KEY = ec.generate_private_key(ec.SECP256R1())


def _claims(**over) -> dict:
    now = int(time.time())
    return {"sub": "u1", "aud": "authenticated", "role": "authenticated", "exp": now + 60, **over}


class _FakeJwks:
    def get_signing_key_from_jwt(self, token):
        return type("K", (), {"key": _EC_KEY.public_key()})()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    auth._jwks_client.cache_clear()
    monkeypatch.setattr(auth, "_jwks_client", lambda: _FakeJwks())
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)


def _verify(token: str) -> dict:
    return auth.verify_jwt(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))


def test_es256_token_verified_against_jwks():
    token = jwt.encode(_claims(), _EC_KEY, algorithm="ES256", headers={"kid": "k1"})
    assert _verify(token)["sub"] == "u1"


def test_es256_token_signed_by_other_key_rejected():
    token = jwt.encode(_claims(), _OTHER_EC_KEY, algorithm="ES256", headers={"kid": "k1"})
    with pytest.raises(HTTPException) as e:
        _verify(token)
    assert e.value.status_code == 401


def test_expired_and_wrong_audience_rejected():
    for claims in (_claims(exp=int(time.time()) - 10), _claims(aud="anon")):
        token = jwt.encode(claims, _EC_KEY, algorithm="ES256")
        with pytest.raises(HTTPException) as e:
            _verify(token)
        assert e.value.status_code == 401


def test_hs256_accepted_only_with_shared_secret(monkeypatch):
    token = jwt.encode(_claims(), "s" * 32, algorithm="HS256")
    with pytest.raises(HTTPException) as e:
        _verify(token)
    assert e.value.status_code == 401
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "s" * 32)
    assert _verify(token)["sub"] == "u1"


def test_none_algorithm_rejected():
    token = jwt.encode(_claims(), None, algorithm="none")
    with pytest.raises(HTTPException) as e:
        _verify(token)
    assert e.value.status_code == 401


def test_jwks_unreachable_is_503(monkeypatch):
    class _Down:
        def get_signing_key_from_jwt(self, token):
            raise jwt.PyJWKClientConnectionError("down")

    monkeypatch.setattr(auth, "_jwks_client", lambda: _Down())
    token = jwt.encode(_claims(), _EC_KEY, algorithm="ES256")
    with pytest.raises(HTTPException) as e:
        _verify(token)
    assert e.value.status_code == 503


def test_jwks_url_from_supabase_url(monkeypatch):
    monkeypatch.undo()
    auth._jwks_client.cache_clear()
    monkeypatch.setenv("SUPABASE_URL", "https://proj.example.co/")
    assert auth._jwks_client().uri == "https://proj.example.co/auth/v1/.well-known/jwks.json"
    auth._jwks_client.cache_clear()
