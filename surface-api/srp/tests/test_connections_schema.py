"""The Connections page's DDL script (srp/connections-page-schema, task 1): `srp/db/local/connections_schema.sql`.

It is run after the Home, SRS, Profile, Insights and Web analytics scripts, adds ONE table (`connected_accounts`) to the local `srp_cleanup` schema and changes nothing else.
The static tests always run; the rest need a scratch database (they build a scratch schema `srp_it_*`, apply the scripts to it and drop it):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/<a scratch database> uv run pytest srp/tests/test_connections_schema.py
"""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from psycopg.rows import dict_row

DB = Path(__file__).resolve().parents[1] / "db" / "local"
SCRIPTS = [DB / n for n in ("home_schema.sql", "home_schema_hardening.sql", "srs_schema.sql", "profile_schema.sql", "insights_schema.sql", "web_analytics_schema.sql")]
CONN = DB / "connections_schema.sql"
URL = os.environ.get("SRP_TEST_DATABASE_URL")
PROVIDERS = ("google_business", "search_console", "youtube", "facebook", "instagram", "linkedin", "x", "zillow", "yelp", "website_cms", "loan_system")
STATES = ("connected", "available", "matched", "partial")
MATCHABLE = ("zillow", "yelp")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
COLUMNS = {
    "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "provider": ("character varying", 20, "NO"), "state": ("character varying", 9, "NO"),
    "synced_at": ("timestamp without time zone", None, "YES"), "source": ("character varying", 60, "NO"), "trust_tier": ("character varying", 20, "NO"),
    "is_mock": ("boolean", None, "NO"),
}


def conn_text() -> str:
    return CONN.read_text()


def live_sql() -> str:
    """The script without comments (the rollback block is commented out)."""
    return "\n".join(re.sub(r"--.*$", "", line) for line in conn_text().splitlines())


# --- static: the text of the script ---------------------------------------------------------------

def test_the_script_exists_and_is_one_transaction():
    sql = live_sql().strip().lower()
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert sql.count("begin;") == 1 and sql.count("commit;") == 1


def test_it_creates_exactly_one_table_and_alters_nothing():
    sql = live_sql().lower()
    assert re.findall(r"create table if not exists (\S+)", sql) == ["srp_cleanup.connected_accounts"]
    assert not re.search(r"\balter table\b", sql)


def test_it_only_names_the_local_schema_and_changes_no_data():
    sql = live_sql().lower()
    for kw in ("truncate", "delete from", "insert into", "update srp_cleanup", "drop table", "drop column", "drop schema"):
        assert kw not in sql, kw
    assert "public." not in sql and "create schema" not in sql


def test_it_does_not_touch_the_legacy_or_other_tables():
    sql = live_sql().lower()
    for other in ("social_media_connections", "account_users", "google_analytics", "home_", "srs_", "profile_", "insights_", "web_"):
        assert f"srp_cleanup.{other}" not in sql, other
    assert set(re.findall(r"references (srp_cleanup\.\w+)", sql)) == {"srp_cleanup.tier_agents"}


def test_it_adds_no_rls_no_function_no_trigger_and_grants_only_to_the_app_role():
    sql = live_sql().lower()
    assert "row level security" not in sql and "create policy" not in sql
    assert "create function" not in sql and "create or replace function" not in sql and "security definer" not in sql and "create trigger" not in sql
    assert not re.search(r"grant\s+.*\s+to\s+(anon|authenticated|public)", sql)
    assert "revoke all on srp_cleanup.connected_accounts from anon, authenticated, public;" in sql
    assert "grant select, insert, update, delete on srp_cleanup.connected_accounts to v3_app;" in sql


def test_it_has_a_commented_rollback():
    assert re.search(r"^--\s*drop table if exists srp_cleanup\.connected_accounts;", conn_text(), flags=re.MULTILINE)


# --- real Postgres ---------------------------------------------------------------------------------

@pytest.fixture
def conn():
    if not URL:
        pytest.skip("SRP_TEST_DATABASE_URL is not set")
    with psycopg.connect(URL, autocommit=True, row_factory=dict_row) as c:
        yield c


def apply(conn, schema: str, path: Path) -> None:
    conn.execute(re.sub(r"\bsrp_cleanup\b", schema, path.read_text()))


def census(conn, schema: str) -> dict:
    """Counts that change if anything is added, dropped or altered in the schema."""
    return conn.execute(
        "select (select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = %s) as cons, "
        "(select count(*) from pg_indexes where schemaname = %s) as idx, "
        "(select count(*) from information_schema.columns where table_schema = %s) as cols, "
        "(select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and not t.tgisinternal) as trg, "
        "(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = %s) as fns",
        (schema, schema, schema, schema, schema)).fetchone()


def columns_of(conn, schema: str, table: str) -> list[str]:
    return [r["column_name"] for r in conn.execute(
        "select column_name from information_schema.columns where table_schema = %s and table_name = %s order by ordinal_position", (schema, table))]


def tables_of(conn, schema: str) -> set[str]:
    return {r["relname"] for r in conn.execute("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and c.relkind = 'r'", (schema,))}


def constraints_of(conn, schema: str) -> set[str]:
    return {r["conname"] for r in conn.execute("select conname from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = %s", (schema,))}


@pytest.fixture
def schema(conn):
    """A scratch schema with the earlier scripts applied (the Connections script is applied by each test, so it can be compared before and after)."""
    name = "srp_it_" + uuid.uuid4().hex[:8]
    conn.execute(f"create schema {name}")
    conn.execute(f"create table {name}.tier_agents (id bigint generated by default as identity primary key, user_id bigint)")
    conn.execute(f"insert into {name}.tier_agents (id, user_id) overriding system value values (1, 1), (2, 2)")
    try:
        for path in SCRIPTS:
            apply(conn, name, path)
        yield name
    finally:
        conn.execute(f"drop schema if exists {name} cascade")


@pytest.fixture
def s(conn, schema):
    apply(conn, schema, CONN)
    return schema


def account(conn, s: str, **over) -> None:
    """A valid connected row by default (Google Business Profile, synced); `over` changes columns."""
    row = {"tier_agent_id": 1, "provider": "google_business", "state": "connected", "synced_at": "2026-10-20 09:00:00", "source": "From your sign-in",
           "trust_tier": "owner_verified", **over}
    conn.execute(f"insert into {s}.connected_accounts ({', '.join(row)}) values ({', '.join(['%s'] * len(row))})", list(row.values()))


def test_it_adds_the_one_table_and_nothing_else(conn, schema):
    tables_before, before = tables_of(conn, schema), census(conn, schema)
    columns_before = {t: columns_of(conn, schema, t) for t in tables_before}
    cons_before = constraints_of(conn, schema)
    apply(conn, schema, CONN)
    assert tables_of(conn, schema) - tables_before == {"connected_accounts"}
    assert {t: columns_of(conn, schema, t) for t in tables_before} == columns_before, "no existing table changes its columns"
    assert all("connected_accounts" in c for c in constraints_of(conn, schema) - cons_before), "only the new table's constraints are new"
    after = census(conn, schema)
    assert after["trg"] == before["trg"] and after["fns"] == before["fns"], "no trigger or function is added"


def test_a_second_run_changes_nothing(conn, s):
    before = census(conn, s)
    apply(conn, s, CONN)
    assert census(conn, s) == before


def test_the_table_has_exactly_the_spec_columns_and_none_that_could_hold_a_secret(conn, s):
    cols = {r["column_name"]: (r["data_type"], r["n"], r["is_nullable"]) for r in conn.execute(
        "select column_name, data_type, character_maximum_length as n, is_nullable from information_schema.columns where table_schema = %s and table_name = 'connected_accounts'", (s,))}
    assert cols == COLUMNS


def test_the_table_has_a_bigint_identity_key_an_indexed_seat_and_comments(conn, s):
    idcol = conn.execute("select data_type, is_identity, identity_generation from information_schema.columns where table_schema = %s and table_name = 'connected_accounts' and column_name = 'id'", (s,)).fetchone()
    assert idcol == {"data_type": "bigint", "is_identity": "YES", "identity_generation": "BY DEFAULT"}
    pk = conn.execute("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = %s::regclass and i.indisprimary", (f"{s}.connected_accounts",)).fetchall()
    assert [r["attname"] for r in pk] == ["id"]
    assert conn.execute("select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0] where i.indrelid = %s::regclass and a.attname = 'tier_agent_id'", (f"{s}.connected_accounts",)).fetchone()
    assert conn.execute("select obj_description(%s::regclass) as c", (f"{s}.connected_accounts",)).fetchone()["c"]
    missing = conn.execute(
        "select a.attname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped "
        "where n.nspname = %s and c.relname = 'connected_accounts' and col_description(c.oid, a.attnum) is null", (s,)).fetchall()
    assert not missing, missing


def test_no_row_level_security_and_no_policies(conn, s):
    assert not conn.execute(
        "select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and (c.relrowsecurity or c.relforcerowsecurity)", (s,)).fetchone()
    assert not conn.execute("select 1 from pg_policies where schemaname = %s", (s,)).fetchone()


def test_grants_are_closed_to_anon_authenticated_and_public_and_open_to_the_app_role(conn, s):
    acl = conn.execute(
        "select coalesce(r.rolname, 'PUBLIC') as grantee, array_agg(a.privilege_type order by a.privilege_type) as privs "
        "from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a "
        "left join pg_roles r on r.oid = a.grantee where n.nspname = %s and c.relname = 'connected_accounts' and a.grantee <> c.relowner group by 1", (s,)).fetchall()
    grants = {r["grantee"]: r["privs"] for r in acl}
    assert "PUBLIC" not in grants and "anon" not in grants and "authenticated" not in grants, grants
    if conn.execute("select 1 from pg_roles where rolname = 'v3_app'").fetchone():
        assert grants.get("v3_app") == ["DELETE", "INSERT", "SELECT", "UPDATE"], grants


# --- accepted rows ---------------------------------------------------------------------------------

@pytest.mark.parametrize("provider", PROVIDERS)
def test_every_provider_is_accepted_connected_and_available(conn, s, provider):
    account(conn, s, provider=provider)
    conn.execute(f"delete from {s}.connected_accounts")
    account(conn, s, provider=provider, state="available", synced_at=None, source="Not connected", trust_tier="self_declared")


@pytest.mark.parametrize("provider", MATCHABLE)
@pytest.mark.parametrize("state", ["matched", "partial"])
def test_zillow_and_yelp_can_be_matched_or_partial(conn, s, provider, state):
    account(conn, s, provider=provider, state=state, trust_tier="platform_observed", source="Matched by NORA")


@pytest.mark.parametrize("tier", TIERS)
def test_every_trust_tier_is_accepted(conn, s, tier):
    account(conn, s, trust_tier=tier)


def test_one_row_per_seat_and_provider(conn, s):
    account(conn, s)
    with pytest.raises(errors.UniqueViolation):
        account(conn, s, state="available", synced_at=None)
    account(conn, s, tier_agent_id=2)
    account(conn, s, provider="youtube")


def test_defaults(conn, s):
    account(conn, s)
    assert conn.execute(f"select is_mock from {s}.connected_accounts").fetchone() == {"is_mock": True}


# --- refused rows ----------------------------------------------------------------------------------

@pytest.mark.parametrize("over, error", [
    ({"provider": "google"}, errors.CheckViolation),
    ({"provider": "Yelp"}, errors.CheckViolation),
    ({"provider": None}, errors.NotNullViolation),
    ({"provider": "x" * 21}, errors.StringDataRightTruncation),
    ({"state": "linked"}, errors.CheckViolation),
    ({"state": "CONNECTED"}, errors.CheckViolation),
    ({"state": None}, errors.NotNullViolation),
    ({"trust_tier": "verified"}, errors.CheckViolation),
    ({"trust_tier": None}, errors.NotNullViolation),
    ({"source": None}, errors.NotNullViolation),
    ({"source": ""}, errors.CheckViolation),
    ({"source": "   "}, errors.CheckViolation),
    ({"source": "x" * 61}, errors.StringDataRightTruncation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
    ({"tier_agent_id": None}, errors.NotNullViolation),
    # synced exactly when the account is not "available"
    ({"synced_at": None}, errors.CheckViolation),
    ({"state": "available"}, errors.CheckViolation),
    ({"state": "matched", "synced_at": None, "provider": "yelp"}, errors.CheckViolation),
    ({"state": "partial", "synced_at": None, "provider": "zillow"}, errors.CheckViolation),
    # matched and partial exist only for zillow and yelp
    ({"state": "matched"}, errors.CheckViolation),
    ({"state": "partial", "provider": "linkedin"}, errors.CheckViolation),
    ({"state": "matched", "provider": "google_business"}, errors.CheckViolation),
])
def test_a_bad_row_is_refused(conn, s, over, error):
    with pytest.raises(error):
        account(conn, s, **over)


@pytest.mark.parametrize("provider", [p for p in PROVIDERS if p not in MATCHABLE])
@pytest.mark.parametrize("state", ["matched", "partial"])
def test_no_other_provider_can_be_matched_or_partial(conn, s, provider, state):
    with pytest.raises(errors.CheckViolation):
        account(conn, s, provider=provider, state=state)
