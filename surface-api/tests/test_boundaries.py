"""Import boundaries between Surfaces (the Python side of the `boundary/*` lint).

- A Surface imports another Surface only through `surfaces.<other>.exports`; its tests may also
  use the other Surface's `surfaces.<other>.testing` (test helpers).
- `_base` (shared core) never imports `app` or any Surface.
"""
from __future__ import annotations

import ast
from pathlib import Path

from app.surfaces import ROOT, SURFACES


def _imports(path: Path) -> list[str]:
    names: list[str] = []
    for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.append(node.module)
            names += [f"{node.module}.{a.name}" for a in node.names]
    return names


def _py_files(folder: Path) -> list[Path]:
    return [p for p in folder.rglob("*.py") if "__pycache__" not in p.parts]


def test_surfaces_only_import_each_other_through_exports():
    violations = []
    for own in SURFACES:
        for path in _py_files(ROOT / own):
            in_tests = "tests" in path.relative_to(ROOT / own).parts
            allowed = {"exports", "testing"} if in_tests else {"exports"}
            for name in _imports(path):
                parts = name.split(".")
                if parts[0] == "surfaces" and len(parts) >= 2 and parts[1] != own:
                    if len(parts) == 2 or parts[2] not in allowed:
                        violations.append(f"{path.relative_to(ROOT)} imports {name}")
                # Another Surface's tests are never imported (`<other>.tests.test_x`).
                elif parts[0] in SURFACES and parts[0] != own:
                    violations.append(f"{path.relative_to(ROOT)} imports {name}")
    assert not violations, (
        "Cross-Surface imports must go through `surfaces.<name>.exports` "
        "(or `.testing` in tests):\n" + "\n".join(sorted(set(violations)))
    )


def test_base_does_not_depend_on_app_or_surfaces():
    blocked = {"app", "surfaces", *SURFACES}
    violations = [
        f"{path.relative_to(ROOT)} imports {name}"
        for path in _py_files(ROOT / "_base")
        for name in _imports(path)
        if name.split(".")[0] in blocked
    ]
    assert not violations, "\n".join(violations)
