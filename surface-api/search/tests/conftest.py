"""search test fixtures on top of the shared ones (surface-api/conftest.py)."""
from __future__ import annotations

import pytest

# Modules whose `role_connection` the execute-style fake DB replaces.
_MODULES = (
    "surfaces.search.internal",
    "surfaces.search.search_presentation.presentation",
    "surfaces.search.geo.geo",
    "surfaces.search.sitemap.sitemap",
    "surfaces.search.public_site.router",
)


@pytest.fixture
def fake_db(fake_db_for):
    from surfaces.search import internal as indexing

    indexing.reset_site_indexing_cache()
    yield fake_db_for(_MODULES)
    indexing.reset_site_indexing_cache()


@pytest.fixture
def client(surface_client):
    return surface_client("search")


@pytest.fixture
def anon_client(surface_client):
    return surface_client("search", signed_in=False)
