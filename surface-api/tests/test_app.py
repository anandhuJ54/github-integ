"""Smoke test: every Surface's aggregate router is mounted on the dev app.

No DB / no network — asserts route *wiring* only (each Surface exposes its base
`/hello` + `/me`, and the meta liveness/readiness probes are present).
"""
from __future__ import annotations

from app import main as app

# Prefix each Surface's base router mounts (hyphenated for multiword packages).
SURFACES = [
    "sales", "marketing", "search", "srp", "xmp", "campaigns", "etl", "graph",
    "nora-os", "skills", "conversion-agents", "admin", "ops", "integrations", "reports",
]


def _paths() -> set[str]:
    return {r.path for r in app.app.routes if getattr(r, "methods", None)}


def test_every_surface_base_router_is_mounted():
    paths = _paths()
    missing = [
        p for s in SURFACES for p in (f"/{s}/hello", f"/{s}/me") if p not in paths
    ]
    assert not missing, f"unmounted surface routes: {missing}"


def test_meta_probes_present():
    paths = _paths()
    assert "/healthz" in paths
    assert "/readyz" in paths
