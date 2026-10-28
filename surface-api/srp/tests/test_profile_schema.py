"""The Profile page's DDL script (srp/profile-page-schema, task 1): `srp/db/local/profile_schema.sql`.

It is run after `home_schema.sql`, `home_schema_hardening.sql` and `srs_schema.sql`, adds TWO tables (`profile_facts`, `profile_graph_groups`) to the local
`srp_cleanup` schema and changes nothing else. The static tests always run; the rest need a scratch database (they build a scratch schema `srp_it_*`, apply the
four scripts to it and drop it):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/<a scratch database> uv run pytest srp/tests/test_profile_schema.py
"""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DB = Path(__file__).resolve().parents[1] / "db" / "local"
BASE, HARD, SRS, PROFILE = DB / "home_schema.sql", DB / "home_schema_hardening.sql", DB / "srs_schema.sql", DB / "profile_schema.sql"
URL = os.environ.get("SRP_TEST_DATABASE_URL")
# the 8 facts whose value is read from the existing tables (so profile_facts stores no value for them), and the 10 whose value lives in profile_facts
EXISTING = ("name", "title", "photo", "bio", "year_started", "office_phone", "mobile_phone", "email")
OWN = ("address", "hours", "nmls", "licensed_in", "products", "service_areas", "designations", "awards", "education", "company")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
GROUPS = ("identity", "contact", "licence", "products", "reviews", "presence")


def profile_text() -> str:
    return PROFILE.read_text()


def live_sql() -> str:
    """The script without comments (the rollback block is commented out)."""
    return "\n".join(re.sub(r"--.*$", "", line) for line in profile_text().splitlines())


# --- static: the text of the script ---------------------------------------------------------------

def test_the_script_exists_and_is_one_transaction():
    sql = live_sql().strip().lower()
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert sql.count("begin;") == 1 and sql.count("commit;") == 1


def test_it_creates_exactly_two_tables_and_alters_nothing():
    sql = live_sql().lower()
    assert re.findall(r"create table if not exists (\S+)", sql) == ["srp_cleanup.profile_facts", "srp_cleanup.profile_graph_groups"]
    assert not re.search(r"\balter table\b", sql)


def test_it_only_names_the_local_schema_and_changes_no_data():
    sql = live_sql().lower()
    for kw in ("truncate", "delete from", "insert into", "update srp_cleanup", "drop table", "drop column", "drop schema"):
        assert kw not in sql, kw
    assert "public." not in sql and "create schema" not in sql


def test_it_does_not_touch_any_other_table_or_the_legacy_ones():
    sql = live_sql().lower()
    for other in ("srs_config_", "user_search_rank_scores", "ai_authority_stats", "education_details", "tier_locations", "agent_locations", "locations", "tiers", "users"):
        assert f"srp_cleanup.{other}" not in sql, other
    assert "srp_cleanup.service_areas" not in sql and "from srp_cleanup." not in sql and "join srp_cleanup." not in sql
    refs = set(re.findall(r"references (srp_cleanup\.\w+)", sql))
    assert refs == {"srp_cleanup.tier_agents"}


def test_it_adds_no_rls_no_function_no_trigger_and_grants_only_to_the_app_role():
    sql = live_sql().lower()
    assert "row level security" not in sql and "create policy" not in sql
    assert "create function" not in sql and "create or replace function" not in sql and "security definer" not in sql and "create trigger" not in sql
    assert not re.search(r"grant\s+.*\s+to\s+(anon|authenticated|public)", sql)
    for t in ("profile_facts", "profile_graph_groups"):
        assert f"revoke all on srp_cleanup.{t} from anon, authenticated, public;" in sql
        assert f"grant select, insert, update, delete on srp_cleanup.{t} to v3_app;" in sql


def test_it_has_a_commented_rollback():
    text = profile_text()
    for t in ("profile_graph_groups", "profile_facts"):
        assert re.search(rf"^--\s*drop table if exists srp_cleanup\.{t};", text, flags=re.MULTILINE)


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


@pytest.fixture
def schema(conn):
    """A scratch schema with the Home and SRS scripts applied (the Profile script is applied by each test, so it can be compared before and after)."""
    name = "srp_it_" + uuid.uuid4().hex[:8]
    conn.execute(f"create schema {name}")
    conn.execute(f"create table {name}.tier_agents (id bigint generated by default as identity primary key, user_id bigint)")
    conn.execute(f"insert into {name}.tier_agents (id, user_id) overriding system value values (1, 1), (2, 2)")
    try:
        for path in (BASE, HARD, SRS):
            apply(conn, name, path)
        yield name
    finally:
        conn.execute(f"drop schema if exists {name} cascade")


@pytest.fixture
def s(conn, schema):
    apply(conn, schema, PROFILE)
    return schema


def fact(conn, s: str, **over) -> None:
    field = over.get("field", "nmls")
    row = {"tier_agent_id": 1, "field": field, "value": None if field in EXISTING else "1234567", "source": "From NMLS", "trust_tier": "authority_verified", **over}
    if row["value"] is not None and not isinstance(row["value"], Jsonb):
        row["value"] = Jsonb(row["value"])
    cols = ", ".join(row)
    conn.execute(f"insert into {s}.profile_facts ({cols}) values ({', '.join(['%s'] * len(row))})", list(row.values()))


def group(conn, s: str, **over) -> None:
    row = {"tier_agent_id": 1, "group_key": "identity", "facts": 12, **over}
    conn.execute(f"insert into {s}.profile_graph_groups ({', '.join(row)}) values ({', '.join(['%s'] * len(row))})", list(row.values()))


def test_it_adds_the_two_tables_and_nothing_else(conn, schema):
    tables_before, before = tables_of(conn, schema), census(conn, schema)
    columns_before = {t: columns_of(conn, schema, t) for t in tables_before}
    apply(conn, schema, PROFILE)
    assert tables_of(conn, schema) - tables_before == {"profile_facts", "profile_graph_groups"}
    assert {t: columns_of(conn, schema, t) for t in tables_before} == columns_before, "no existing table changes"
    after = census(conn, schema)
    assert after["trg"] == before["trg"] and after["fns"] == before["fns"], "no trigger or function is added"


def test_a_second_run_changes_nothing(conn, s):
    before = census(conn, s)
    apply(conn, s, PROFILE)
    assert census(conn, s) == before


def test_the_facts_table_has_the_spec_columns(conn, s):
    cols = {r["column_name"]: (r["data_type"], r["n"], r["is_nullable"]) for r in conn.execute(
        "select column_name, data_type, character_maximum_length as n, is_nullable from information_schema.columns where table_schema = %s and table_name = 'profile_facts'", (s,))}
    assert cols == {
        "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "field": ("character varying", 20, "NO"), "value": ("jsonb", None, "YES"),
        "source": ("character varying", 60, "NO"), "trust_tier": ("character varying", 20, "NO"), "confirmed_at": ("timestamp without time zone", None, "YES"),
        "is_mock": ("boolean", None, "NO"),
    }


def test_the_groups_table_has_the_spec_columns(conn, s):
    cols = {r["column_name"]: (r["data_type"], r["n"], r["is_nullable"]) for r in conn.execute(
        "select column_name, data_type, character_maximum_length as n, is_nullable from information_schema.columns where table_schema = %s and table_name = 'profile_graph_groups'", (s,))}
    assert cols == {
        "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "group_key": ("character varying", 12, "NO"),
        "facts": ("integer", None, "NO"), "is_mock": ("boolean", None, "NO"),
    }


@pytest.mark.parametrize("table", ["profile_facts", "profile_graph_groups"])
def test_each_table_has_a_bigint_identity_key_an_indexed_seat_and_comments(conn, s, table):
    idcol = conn.execute(
        "select data_type, is_identity, identity_generation from information_schema.columns where table_schema = %s and table_name = %s and column_name = 'id'", (s, table)).fetchone()
    assert idcol == {"data_type": "bigint", "is_identity": "YES", "identity_generation": "BY DEFAULT"}
    pk = conn.execute("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = %s::regclass and i.indisprimary", (f"{s}.{table}",)).fetchall()
    assert [r["attname"] for r in pk] == ["id"]
    assert conn.execute("select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0] where i.indrelid = %s::regclass and a.attname = 'tier_agent_id'", (f"{s}.{table}",)).fetchone()
    assert conn.execute("select obj_description(%s::regclass) as c", (f"{s}.{table}",)).fetchone()["c"]
    missing = conn.execute(
        "select a.attname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped "
        "where n.nspname = %s and c.relname = %s and col_description(c.oid, a.attnum) is null", (s, table)).fetchall()
    assert not missing, missing


def test_no_row_level_security_and_no_policies(conn, s):
    assert not conn.execute(
        "select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and (c.relrowsecurity or c.relforcerowsecurity)", (s,)).fetchone()
    assert not conn.execute("select 1 from pg_policies where schemaname = %s", (s,)).fetchone()


@pytest.mark.parametrize("table", ["profile_facts", "profile_graph_groups"])
def test_grants_are_closed_to_anon_authenticated_and_public_and_open_to_the_app_role(conn, s, table):
    acl = conn.execute(
        "select coalesce(r.rolname, 'PUBLIC') as grantee, array_agg(a.privilege_type order by a.privilege_type) as privs "
        "from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a "
        "left join pg_roles r on r.oid = a.grantee where n.nspname = %s and c.relname = %s and a.grantee <> c.relowner group by 1", (s, table)).fetchall()
    grants = {r["grantee"]: r["privs"] for r in acl}
    assert "PUBLIC" not in grants and "anon" not in grants and "authenticated" not in grants, grants
    if conn.execute("select 1 from pg_roles where rolname = 'v3_app'").fetchone():
        assert grants.get("v3_app") == ["DELETE", "INSERT", "SELECT", "UPDATE"], grants


# constraints of profile_facts: each bad row is refused ---------------------------------------------------------

@pytest.mark.parametrize("field", OWN)
def test_every_field_with_its_own_value_is_accepted_with_a_string(conn, s, field):
    fact(conn, s, field=field, value="a value")


def test_products_can_be_a_list_of_strings(conn, s):
    fact(conn, s, field="products", value=["Conventional", "FHA", "VA"])


@pytest.mark.parametrize("field", EXISTING)
def test_every_existing_table_field_is_accepted_without_a_value(conn, s, field):
    fact(conn, s, field=field, value=None, source="Confirmed by you", trust_tier="owner_verified")


@pytest.mark.parametrize("tier", TIERS)
def test_every_trust_tier_is_accepted(conn, s, tier):
    fact(conn, s, trust_tier=tier)


def test_defaults_and_an_optional_confirmed_date(conn, s):
    fact(conn, s)
    assert conn.execute(f"select confirmed_at, is_mock from {s}.profile_facts").fetchone() == {"confirmed_at": None, "is_mock": True}
    fact(conn, s, field="address", value="100 Example Street", confirmed_at="2026-10-16 09:00")
    assert conn.execute(f"select confirmed_at::text c from {s}.profile_facts where field = 'address'").fetchone()["c"] == "2026-10-16 09:00:00"


@pytest.mark.parametrize("over, error", [
    ({"field": "bio_text"}, errors.CheckViolation),
    ({"field": "x", "value": "v"}, errors.CheckViolation),
    ({"field": "NMLS"}, errors.CheckViolation),
    ({"field": "name", "value": "Pat Example"}, errors.CheckViolation),             # a value of an existing-table field would be a second copy
    ({"field": "title", "value": ["x"]}, errors.CheckViolation),
    ({"field": "email", "value": "pat@example.test"}, errors.CheckViolation),
    ({"field": "address", "value": None}, errors.CheckViolation),                    # a fact with its own value needs one
    ({"field": "nmls", "value": None}, errors.CheckViolation),
    ({"value": ""}, errors.CheckViolation),                                          # blank means missing: no row
    ({"value": "   "}, errors.CheckViolation),
    ({"field": "products", "value": []}, errors.CheckViolation),
    ({"value": 123}, errors.CheckViolation),                                         # only a string or a list of strings
    ({"value": {"a": "b"}}, errors.CheckViolation),
    ({"value": True}, errors.CheckViolation),
    ({"field": "products", "value": ["FHA", 5]}, errors.CheckViolation),
    ({"field": "products", "value": [["FHA"]]}, errors.CheckViolation),
    ({"trust_tier": "verified"}, errors.CheckViolation),
    ({"trust_tier": "x"}, errors.CheckViolation),
    ({"trust_tier": "Owner_Verified"}, errors.CheckViolation),
    ({"source": None}, errors.NotNullViolation),
    ({"trust_tier": None}, errors.NotNullViolation),
    ({"field": None}, errors.NotNullViolation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
    ({"source": "x" * 61}, errors.StringDataRightTruncation),
    ({"field": "x" * 21}, errors.StringDataRightTruncation),
])
def test_a_bad_fact_is_refused(conn, s, over, error):
    with pytest.raises(error):
        fact(conn, s, **over)


def test_a_second_fact_for_the_same_seat_and_field_is_refused_but_another_seat_or_field_is_fine(conn, s):
    fact(conn, s)
    with pytest.raises(errors.UniqueViolation):
        fact(conn, s, value="7654321")
    fact(conn, s, tier_agent_id=2)
    fact(conn, s, field="licensed_in", value="IA, IL")


# constraints of profile_graph_groups -------------------------------------------------------------------------

@pytest.mark.parametrize("key", GROUPS)
def test_every_group_is_accepted(conn, s, key):
    group(conn, s, group_key=key)


def test_the_group_defaults_and_zero_facts(conn, s):
    group(conn, s, facts=0)
    assert conn.execute(f"select facts, is_mock from {s}.profile_graph_groups").fetchone() == {"facts": 0, "is_mock": True}


@pytest.mark.parametrize("over, error", [
    ({"group_key": "reviewz"}, errors.CheckViolation),
    ({"group_key": "x"}, errors.CheckViolation),
    ({"group_key": "Identity"}, errors.CheckViolation),
    ({"facts": -1}, errors.CheckViolation),
    ({"facts": None}, errors.NotNullViolation),
    ({"group_key": None}, errors.NotNullViolation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
    ({"group_key": "x" * 13}, errors.StringDataRightTruncation),
])
def test_a_bad_group_is_refused(conn, s, over, error):
    with pytest.raises(error):
        group(conn, s, **over)


def test_a_second_group_for_the_same_seat_and_key_is_refused_but_another_seat_or_key_is_fine(conn, s):
    group(conn, s)
    with pytest.raises(errors.UniqueViolation):
        group(conn, s, facts=3)
    group(conn, s, tier_agent_id=2)
    group(conn, s, group_key="contact")


def test_the_json_a_fact_stores_round_trips(conn, s):
    fact(conn, s, field="products", value=["Conventional", "Cash-out", "Rate-and-term"])
    assert conn.execute(f"select value from {s}.profile_facts").fetchone()["value"] == ["Conventional", "Cash-out", "Rate-and-term"]
    assert json.loads(json.dumps(["x"])) == ["x"]
