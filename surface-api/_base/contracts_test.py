"""Every published contracts/<surface>/openapi.json matches the app (rerun _base.contracts)."""
from __future__ import annotations

import json

import pytest

from _base.contracts import CONTRACTS, surface_openapi
from app import app

PUBLISHED = sorted(CONTRACTS.glob("*/openapi.json"))


@pytest.mark.parametrize("path", PUBLISHED, ids=[p.parent.name for p in PUBLISHED])
def test_contract_is_current(path):
    expected = surface_openapi(app.openapi(), path.parent.name)
    assert json.loads(path.read_text()) == expected, (
        f"stale: run `uv run python -m _base.contracts {path.parent.name}`"
    )
