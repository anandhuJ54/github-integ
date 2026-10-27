"""Unit tests for _base.config — the environment-driven runtime settings."""
from __future__ import annotations

import pytest

from _base.config import Settings, get_settings


@pytest.fixture(autouse=True)
def _clear_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_defaults_are_safe(monkeypatch):
    for var in ("DB_POOL_MIN", "DB_POOL_MAX", "DB_POOL_TIMEOUT", "HTTP_THREADPOOL",
                "CORS_ALLOW_ORIGINS"):
        monkeypatch.delenv(var, raising=False)
    s = get_settings()
    assert s.db_pool_min == 1
    assert s.db_pool_max == 10
    assert s.effective_threadpool() == 10        # derived from db_pool_max when unset


def test_env_overrides(monkeypatch):
    monkeypatch.setenv("DB_POOL_MAX", "30")
    monkeypatch.setenv("HTTP_THREADPOOL", "40")
    s = get_settings()
    assert s.db_pool_max == 30
    assert s.effective_threadpool() == 40


def test_cors_wildcard_disables_credentials():
    s = Settings(cors_origins=["*"])
    origins, creds = s.effective_cors()
    assert origins == ["*"]
    assert creds is False                         # "*" + credentials is invalid per spec


def test_cors_allowlist_enables_credentials():
    s = Settings(cors_origins=["https://app.example.com"])
    origins, creds = s.effective_cors()
    assert origins == ["https://app.example.com"]
    assert creds is True


def test_cors_parsed_from_csv(monkeypatch):
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://a.com, https://b.com")
    s = get_settings()
    assert s.cors_origins == ["https://a.com", "https://b.com"]
    assert s.effective_cors() == (["https://a.com", "https://b.com"], True)


def test_bad_integer_fails_loudly(monkeypatch):
    monkeypatch.setenv("DB_POOL_MAX", "not-a-number")
    with pytest.raises(ValueError):
        get_settings()


def test_validate_rejects_min_above_max():
    with pytest.raises(ValueError):
        Settings(db_pool_min=20, db_pool_max=10).validate()


# --- local sign-in settings (srp/local-login-srp-home, task 1) ---------------------------------


def test_local_auth_defaults_are_off(monkeypatch):
    for var in ("LOCAL_AUTH_ENABLED", "LOCAL_AUTH_TOKEN_HOURS", "SRP_LOCAL_SCHEMA"):
        monkeypatch.delenv(var, raising=False)
    s = get_settings()
    assert s.local_auth_enabled is False
    assert s.local_auth_token_hours == 8
    assert s.srp_local_schema == "srp_cleanup"


@pytest.mark.parametrize("raw", ["1", "true", "TRUE", "yes", "on"])
def test_local_auth_flag_accepts_truthy_values(monkeypatch, raw):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", raw)
    assert get_settings().local_auth_enabled is True


@pytest.mark.parametrize("raw", ["0", "false", "no", "off", ""])
def test_local_auth_flag_accepts_falsy_values(monkeypatch, raw):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", raw)
    assert get_settings().local_auth_enabled is False


def test_local_auth_flag_rejects_unclear_value(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", "maybe")
    with pytest.raises(ValueError, match="LOCAL_AUTH_ENABLED"):
        get_settings()


@pytest.mark.parametrize("hours", ["0", "-1", "169"])
def test_local_auth_token_hours_bounded(monkeypatch, hours):
    monkeypatch.setenv("LOCAL_AUTH_TOKEN_HOURS", hours)
    with pytest.raises(ValueError, match="LOCAL_AUTH_TOKEN_HOURS"):
        get_settings()


@pytest.mark.parametrize("name", ["srp_cleanup", "srp", "_scratch1"])
def test_local_schema_name_accepted(monkeypatch, name):
    monkeypatch.setenv("SRP_LOCAL_SCHEMA", name)
    assert get_settings().srp_local_schema == name


@pytest.mark.parametrize("name", ["bad;drop table x", "Srp_Cleanup", "srp-cleanup", "1srp", 'a"b', "a" * 64])
def test_local_schema_name_rejected(monkeypatch, name):
    monkeypatch.setenv("SRP_LOCAL_SCHEMA", name)
    with pytest.raises(ValueError, match="SRP_LOCAL_SCHEMA"):
        get_settings()
