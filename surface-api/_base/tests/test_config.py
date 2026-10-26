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
