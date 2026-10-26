"""One Postgres schema per Surface (AGENTS.md §4): a Surface's ORM classes (`src/models/`) are in
the schema named after it, and its migrations create tables only there. The classes of every
Surface configure together (relationships resolve in the running app, not only in tests).
Shared-core classes (`_base/models/`) stay in `public`."""
from __future__ import annotations

import importlib
import re

import pytest
from sqlalchemy import Table
from sqlalchemy.orm import configure_mappers

from _base.db.base import Base
from app.surfaces import ROOT, SURFACES


@pytest.mark.parametrize("surface", SURFACES)
def test_models_are_in_the_surfaces_schema(surface):
    models = importlib.import_module(f"surfaces.{surface}.models")
    tables = [v.__table__ for v in vars(models).values() if isinstance(v, type) and issubclass(v, Base)]
    tables += [v for v in vars(models).values() if isinstance(v, Table)]
    wrong = [f"{t.schema}.{t.name}" for t in tables if t.schema != surface]
    assert wrong == []


def test_every_surfaces_models_configure_together():
    for surface in SURFACES:
        importlib.import_module(f"surfaces.{surface}.models")
    configure_mappers()
    importlib.import_module("_base.models")
    configure_mappers()
    assert {t.schema for t in Base.metadata.tables.values()} <= set(SURFACES) | {None}


def test_base_models_are_in_public():
    """Shared-core classes leave `schema` unset: their tables live in `public`."""
    models = importlib.import_module("_base.models")
    classes = [v for v in vars(models).values() if isinstance(v, type) and issubclass(v, Base)]
    assert classes and all(c.__table__.schema is None for c in classes)


@pytest.mark.parametrize("surface", SURFACES)
def test_migrations_create_tables_only_in_the_surfaces_schema(surface):
    wrong = []
    for path in sorted((ROOT / surface / "db" / "migrations").glob("*.py")):
        for name in re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?([\w.]+)", path.read_text()):
            if not name.startswith(f"{surface}."):
                wrong.append(f"{path.name}: {name}")
    assert wrong == []
