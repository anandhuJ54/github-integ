"""Tests for the local sign-in token (srp/local-login-srp-home): who accepts it and what is refused.

A local token has header `kid: "v3-local"` and is HS256 with LOCAL_AUTH_JWT_SECRET. Only the SRP
dependency `verify_srp_jwt` may accept it; the global `verify_jwt` never does.
"""
from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from _base import auth
from _base.config import get_settings

SECRET = "L" * 32
SUPABASE_SECRET = "S" * 32
_EC_KEY = ec.generate_private_key(ec.SECP256R1())


def _claims(**over) -> dict:
    now = int(time.time())
    return {
        "sub": "7",
        "email": "mock.users.7@example.test",
        "aud": "v3-local-srp",
        "iss": "v3-local-auth",
        "iat": now,
        "exp": now + 60,
        **over,
    }


def _local(claims: dict | None = None, *, key=SECRET, alg="HS256", kid="v3-local") -> str:
    headers = {"kid": kid} if kid else {}
    return jwt.encode(claims if claims is not None else _claims(), key, algorithm=alg, headers=headers)


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _srp(token: str) -> dict:
    return auth.verify_srp_jwt(_creds(token))


def _global(token: str) -> dict:
    return auth.verify_jwt(_creds(token))


def _refused(call, token: str) -> int:
    with pytest.raises(HTTPException) as e:
        call(token)
    return e.value.status_code


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", "1")
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", SECRET)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    get_settings.cache_clear()
    auth._jwks_client.cache_clear()
    yield
    get_settings.cache_clear()


# --- accepted -------------------------------------------------------------------------------


def test_srp_accepts_a_valid_local_token():
    claims = _srp(_local())
    assert claims["sub"] == "7"
    assert "role" not in claims  # the token does not pose as a Supabase `authenticated` user


def test_srp_still_accepts_a_supabase_token(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SUPABASE_SECRET)
    token = jwt.encode(
        _claims(aud="authenticated", role="authenticated", iss="https://proj.example.co/auth/v1"),
        SUPABASE_SECRET,
        algorithm="HS256",
    )
    assert _srp(token)["sub"] == "7"


# --- the global check never accepts a local token -----------------------------------------


def test_global_verify_jwt_rejects_a_valid_local_token():
    assert _refused(_global, _local()) == 401


def test_global_verify_jwt_rejects_a_local_token_even_if_supabase_hs256_is_configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)  # same bytes as the local key
    assert _refused(_global, _local()) == 401


# --- refused by the SRP check ---------------------------------------------------------------


@pytest.mark.parametrize(
    "claims",
    [
        _claims(exp=int(time.time()) - 10),
        _claims(aud="anon"),
        _claims(aud="authenticated"),  # the Supabase audience: a local token must not be usable there
        _claims(iss="someone-else"),
    ],
    ids=["expired", "wrong-audience", "supabase-audience", "wrong-issuer"],
)
def test_srp_rejects_bad_claims(claims):
    assert _refused(_srp, _local(claims)) == 401


@pytest.mark.parametrize("missing", ["exp", "iat", "sub", "aud", "iss"])
def test_srp_rejects_a_token_missing_a_required_claim(missing):
    claims = _claims()
    del claims[missing]
    assert _refused(_srp, _local(claims)) == 401


def test_srp_rejects_a_local_kid_signed_with_another_key():
    assert _refused(_srp, _local(key="X" * 32)) == 401


def test_srp_rejects_a_local_kid_signed_with_the_supabase_secret(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SUPABASE_SECRET)
    assert _refused(_srp, _local(key=SUPABASE_SECRET)) == 401


def test_srp_rejects_alg_none_with_the_local_kid():
    assert _refused(_srp, _local(key=None, alg="none")) == 401


def test_srp_rejects_an_asymmetric_alg_with_the_local_kid():
    assert _refused(_srp, _local(key=_EC_KEY, alg="ES256")) == 401


def test_srp_rejects_another_hmac_alg_with_the_local_kid():
    assert _refused(_srp, _local(alg="HS384", key="L" * 48)) == 401


def test_a_local_key_token_without_the_local_kid_is_not_accepted():
    # no kid: it takes the Supabase path, where HS256 needs SUPABASE_JWT_SECRET, which is unset
    assert _refused(_srp, _local(kid=None)) == 401


# --- off by default -------------------------------------------------------------------------


def test_local_token_rejected_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    get_settings.cache_clear()
    assert _refused(_srp, _local()) == 401


def test_local_token_rejected_when_the_secret_is_unusable(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", "short")
    assert _refused(_srp, _local(key="short")) == 401


# --- start-up check (criterion 9) -----------------------------------------------------------


def test_startup_check_is_a_no_op_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    monkeypatch.delenv("LOCAL_AUTH_JWT_SECRET")
    get_settings.cache_clear()
    auth.require_local_auth_ready()


def test_startup_check_passes_with_a_32_byte_secret():
    auth.require_local_auth_ready()


@pytest.mark.parametrize("secret", [None, "", "x" * 31])
def test_startup_check_fails_for_a_missing_or_short_secret(monkeypatch, secret):
    if secret is None:
        monkeypatch.delenv("LOCAL_AUTH_JWT_SECRET")
    else:
        monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", secret)
    with pytest.raises(RuntimeError, match="LOCAL_AUTH_JWT_SECRET") as e:
        auth.require_local_auth_ready()
    if secret:
        assert secret not in str(e.value)  # never echo the secret



# --- issuing (used by the SRP login) ----------------------------------------------------------


def test_issued_token_verifies_for_srp_and_never_globally():
    token, exp = auth.issue_local_token(7, "mock.users.7@example.test", hours=8)
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "HS256" and header["kid"] == "v3-local"
    claims = _srp(token)
    assert claims["sub"] == "7"
    assert claims["email"] == "mock.users.7@example.test"
    assert claims["iss"] == "v3-local-auth" and claims["aud"] == "v3-local-srp"
    assert "role" not in claims
    assert claims["exp"] == exp
    assert 0 < claims["exp"] - claims["iat"] <= 8 * 3600
    assert _refused(_global, token) == 401


def test_issued_token_lifetime_follows_the_setting(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_TOKEN_HOURS", "2")
    get_settings.cache_clear()
    token, _ = auth.issue_local_token(7, None)
    claims = _srp(token)
    assert claims["exp"] - claims["iat"] == 2 * 3600
    assert "email" not in claims


def test_issue_refuses_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="not enabled"):
        auth.issue_local_token(7, None)


def test_issue_refuses_with_a_weak_secret(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", "zq9-weak")
    with pytest.raises(RuntimeError, match="LOCAL_AUTH_JWT_SECRET") as e:
        auth.issue_local_token(7, None)
    assert "zq9-weak" not in str(e.value)  # never echo the secret


# --- review findings: issuer spoofing and secret reuse -----------------------------------------


def test_a_token_that_passed_the_supabase_path_can_never_claim_the_local_issuer(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SUPABASE_SECRET)
    spoof = jwt.encode(
        _claims(aud="authenticated", role="authenticated"), SUPABASE_SECRET, algorithm="HS256"
    )  # iss is the local issuer, no kid, signed with the Supabase secret
    assert _refused(_srp, spoof) == 401
    assert _refused(_global, spoof) == 401


def test_startup_check_refuses_a_secret_equal_to_the_supabase_one(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    with pytest.raises(RuntimeError, match="must differ") as e:
        auth.require_local_auth_ready()
    assert SECRET not in str(e.value)


def test_issuing_refuses_a_secret_equal_to_the_supabase_one(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    with pytest.raises(RuntimeError, match="must differ"):
        auth.issue_local_token(7, None)
