"""Every Surface has the same shape and is registered everywhere; no route is mounted twice."""
from __future__ import annotations

import re
import tomllib
from collections import Counter

from app.main import app
from app.routes import ROUTERS
from app.surfaces import NAME_PATTERN, ROOT, SURFACES

# `internal` may be a module or, when large, a package (`internal/__init__.py`).
SHAPE = (
    "__init__.py",
    "router.py",
    "exports.py",
    ("internal.py", "internal/__init__.py"),
    "models/__init__.py",
)


def test_surface_names_are_lowercase_and_underscores():
    assert [n for n in SURFACES if not re.fullmatch(NAME_PATTERN, n)] == []


def test_every_surface_folder_is_registered():
    on_disk = {p.name for p in ROOT.iterdir() if (p / "src" / "__init__.py").exists()}
    assert on_disk == set(SURFACES)


def test_every_surface_has_the_standard_files():
    missing = []
    for n in SURFACES:
        for want in SHAPE:
            options = want if isinstance(want, tuple) else (want,)
            if not any((ROOT / n / "src" / f).exists() for f in options):
                missing.append(f"{n}/src/{options[0]}")
    assert missing == []


def test_every_surface_is_mapped_in_pyproject():
    tool = tomllib.loads((ROOT / "pyproject.toml").read_text())["tool"]["setuptools"]
    assert tool["package-dir"] == {f"surfaces.{n}": f"{n}/src" for n in SURFACES}
    assert sorted(tool["packages"]) == sorted(f"surfaces.{n}" for n in SURFACES)


def test_every_surface_router_is_mounted_once():
    assert len(ROUTERS) == len(SURFACES)
    assert len({id(r) for r in ROUTERS}) == len(SURFACES)


def test_no_duplicate_method_and_path():
    seen = Counter(
        (method, route.path)
        for route in app.routes
        for method in (getattr(route, "methods", None) or ())
    )
    assert [k for k, n in seen.items() if n > 1] == []
