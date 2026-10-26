"""ops test fixtures on top of the shared ones (surface-api/conftest.py)."""
from __future__ import annotations

import pytest

# Modules whose `role_connection` the execute-style fake DB replaces.
_MODULES = ("surfaces.ops.dev_weekly.services",)


@pytest.fixture
def fake_db(fake_db_for):
    return fake_db_for(_MODULES)


@pytest.fixture
def client(surface_client):
    return surface_client("ops")


@pytest.fixture
def anon_client(surface_client):
    return surface_client("ops", signed_in=False)
