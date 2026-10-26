"""Import boundaries between Surfaces (the Python side of the `boundary/*` lint).

- A Surface imports another Surface only through `surfaces.<other>.exports`; its tests may also
  use the other Surface's `surfaces.<other>.testing` (test helpers).
- `_base` (shared core) never imports `app` or any Surface.
- Only the owning Surface reads and writes the tables in its schema (AGENTS.md §2): no other Surface
  (or `_base`) names them in SQL or maps an ORM relationship to them, and `exports.py` hands out
  plain shapes, never ORM classes, tables or columns. A foreign key is the one direct reference: the
  owner's exported `*_ID_FK` constant, and `REFERENCES <owner>.<table>` in a migration.
"""
from __future__ import annotations

import ast
import importlib
import re
from pathlib import Path

from sqlalchemy import Table
from sqlalchemy.orm import InstrumentedAttribute, configure_mappers

from _base.db.base import Base
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


def _other_schema_refs(text: str, own: str) -> list[str]:
    """`<schema>.<table>` names of another Surface's schema in `text`."""
    others = "|".join(x for x in SURFACES if x != own)
    return re.findall(rf"(?<![\w.])((?:{others})\.[a-z_]+)\b", text)


def _strings(path: Path) -> list[str]:
    """String literals in a module, docstrings left out (they may name tables in prose)."""
    tree = ast.parse(path.read_text(), filename=str(path))
    docs = {id(n.body[0].value) for n in ast.walk(tree)
            if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
            and n.body and isinstance(n.body[0], ast.Expr)
            and isinstance(n.body[0].value, ast.Constant)}
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs]


def test_code_never_names_another_surfaces_tables():
    """No SQL or table name in a Surface's (or `_base`'s) code points into another Surface's schema.
    The exported `*_ID_FK` constants are the owner's own strings; tests and migrations are checked
    on their own."""
    violations = []
    for own in (*SURFACES, "_base"):
        for path in _py_files(ROOT / own):
            parts = path.relative_to(ROOT / own).parts
            if "tests" in parts or "migrations" in parts:
                continue
            for text in _strings(path):
                violations += [f"{path.relative_to(ROOT)}: {r}" for r in _other_schema_refs(text, own)]
    assert not violations, (
        "Only the owner reads or writes its schema's tables; call its exports.py:\n"
        + "\n".join(sorted(set(violations)))
    )


def test_migrations_only_reference_another_surfaces_tables_by_foreign_key():
    violations = []
    for own in (*SURFACES, "_base"):
        for path in sorted((ROOT / own / "db" / "migrations").glob("*.py")):
            sql = re.sub(r"REFERENCES [a-z_]+\.[a-z_]+", "", "\n".join(_strings(path)))
            violations += [f"{path.relative_to(ROOT)}: {r}" for r in _other_schema_refs(sql, own)]
    assert not violations, "\n".join(violations)


def test_orm_relationships_stay_inside_a_surface():
    """A relationship by name (`relationship("Account")`) needs no import, so it is checked on the
    mapped classes: it may point at its own Surface's schema or at shared core (`public`)."""
    for name in ("_base.models", *(f"surfaces.{x}.models" for x in SURFACES)):
        importlib.import_module(name)
    configure_mappers()
    violations = []
    for mapper in Base.registry.mappers:
        own = mapper.local_table.schema
        for rel in mapper.relationships:
            target = rel.mapper.local_table.schema
            if target is not None and target != own:
                violations.append(f"{mapper.class_.__name__}.{rel.key} -> {target}.{rel.mapper.local_table.name}")
    assert not violations, "\n".join(violations)


def test_exports_hand_out_no_orm_classes_tables_or_columns():
    violations = []
    for own in SURFACES:
        exports = importlib.import_module(f"surfaces.{own}.exports")
        public = getattr(exports, "__all__", [n for n in vars(exports) if not n.startswith("_")])
        for name in public:
            value = getattr(exports, name)
            if (isinstance(value, (Table, InstrumentedAttribute))
                    or (isinstance(value, type) and issubclass(value, Base))):
                violations.append(f"surfaces.{own}.exports.{name}")
    assert not violations, "exports.py returns plain shapes, not models:\n" + "\n".join(violations)
