"""The security baseline (AGENTS.md §3) in this Surface's migrations, read from the files: every
new table revokes everything from anon / authenticated / PUBLIC and grants back only to
authenticated / service_role (no row-level security, so grants are the whole control); the schema
is closed to anon / PUBLIC.
The same check runs for campaigns (campaigns/tests/test_migrations_security.py)."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

MIGRATIONS = sorted((Path(__file__).resolve().parents[1] / "db" / "migrations").glob("*.py"))


@pytest.mark.parametrize("path", MIGRATIONS, ids=[p.stem for p in MIGRATIONS])
def test_new_tables_are_closed_to_anon_by_grants(path):
    sql = path.read_text()
    for schema in re.findall(r"CREATE SCHEMA IF NOT EXISTS (\w+);", sql):
        assert f"REVOKE ALL ON SCHEMA {schema} FROM PUBLIC, anon;" in sql, schema
    for table in re.findall(r"CREATE TABLE (\w+\.\w+)", sql):
        assert f"REVOKE ALL ON {table} FROM anon, authenticated, PUBLIC;" in sql, table
    for grantees in re.findall(r"GRANT [^;]* TO ([^;]*);", sql):
        assert {g.strip() for g in grantees.split(",")} <= {"authenticated", "service_role"}, grantees
