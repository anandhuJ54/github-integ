"""The app refuses to start when local sign-in is on without a usable signing key (criterion 9).

Lives in `tests/` (not `_base/tests/`) because it builds the app shell; `_base` must not import `app`.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from _base.config import get_settings
from app.main import create_app


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_ENABLED", "1")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.parametrize("secret", [None, "", "short"])
def test_app_start_fails_with_a_missing_or_weak_secret(monkeypatch, secret):
    if secret is None:
        monkeypatch.delenv("LOCAL_AUTH_JWT_SECRET", raising=False)
    else:
        monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", secret)
    with pytest.raises(RuntimeError, match="LOCAL_AUTH_JWT_SECRET"), TestClient(create_app("test", [])):
        pass


def test_app_starts_with_a_32_byte_secret(monkeypatch):
    monkeypatch.setenv("LOCAL_AUTH_JWT_SECRET", "L" * 32)
    with TestClient(create_app("test", [])) as client:
        assert client.get("/openapi.json").status_code == 200


def test_app_starts_without_a_secret_when_the_flag_is_off(monkeypatch):
    monkeypatch.delenv("LOCAL_AUTH_ENABLED")
    monkeypatch.delenv("LOCAL_AUTH_JWT_SECRET", raising=False)
    get_settings.cache_clear()
    with TestClient(create_app("test", [])):
        pass
