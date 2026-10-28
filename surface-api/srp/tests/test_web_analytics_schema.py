"""The Web analytics page's DDL script (srp/web-analytics-page-schema, task 1): `srp/db/local/web_analytics_schema.sql`.

It is run after `home_schema.sql`, `home_schema_hardening.sql`, `srs_schema.sql`, `profile_schema.sql` and `insights_schema.sql`, adds ONE table (`web_checks`) to the local
`srp_cleanup` schema and changes nothing else. The static tests always run; the rest need a scratch database (they build a scratch schema `srp_it_*`, apply the scripts to it
and drop it):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/<a scratch database> uv run pytest srp/tests/test_web_analytics_schema.py
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
SCRIPTS = [DB / n for n in ("home_schema.sql", "home_schema_hardening.sql", "srs_schema.sql", "profile_schema.sql", "insights_schema.sql")]
WEB = DB / "web_analytics_schema.sql"
URL = os.environ.get("SRP_TEST_DATABASE_URL")
KEYS = ("entity_markup", "nap", "indexing", "service_pages", "speed", "ai_readiness", "content", "conversion", "reviews_on_site", "security")
SCORED = ("entity_markup", "nap", "indexing", "service_pages")
UNSCORED = tuple(k for k in KEYS if k not in SCORED)
HEADLINED = ("speed", "ai_readiness")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")


def web_text() -> str:
    return WEB.read_text()


def live_sql() -> str:
    """The script without comments (the rollback block is commented out)."""
    return "\n".join(re.sub(r"--.*$", "", line) for line in web_text().splitlines())


# --- static: the text of the script ---------------------------------------------------------------

def test_the_script_exists_and_is_one_transaction():
    sql = live_sql().strip().lower()
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert sql.count("begin;") == 1 and sql.count("commit;") == 1


def test_it_creates_exactly_one_table_and_alters_nothing():
    sql = live_sql().lower()
    assert re.findall(r"create table if not exists (\S+)", sql) == ["srp_cleanup.web_checks"]
    assert not re.search(r"\balter table\b", sql)


def test_it_only_names_the_local_schema_and_changes_no_data():
    sql = live_sql().lower()
    for kw in ("truncate", "delete from", "insert into", "update srp_cleanup", "drop table", "drop column", "drop schema"):
        assert kw not in sql, kw
    assert "public." not in sql and "create schema" not in sql


def test_it_does_not_touch_the_legacy_or_other_tables():
    sql = live_sql().lower()
    for other in ("website_analytics_data", "website_analytics_categories", "agents_website_data", "audits", "google_analytics", "home_", "srs_", "profile_", "insights_"):
        assert f"srp_cleanup.{other}" not in sql, other
    assert set(re.findall(r"references (srp_cleanup\.\w+)", sql)) == {"srp_cleanup.tier_agents"}


def test_it_adds_no_rls_no_function_no_trigger_and_grants_only_to_the_app_role():
    sql = live_sql().lower()
    assert "row level security" not in sql and "create policy" not in sql
    assert "create function" not in sql and "create or replace function" not in sql and "security definer" not in sql and "create trigger" not in sql
    assert not re.search(r"grant\s+.*\s+to\s+(anon|authenticated|public)", sql)
    assert "revoke all on srp_cleanup.web_checks from anon, authenticated, public;" in sql
    assert "grant select, insert, update, delete on srp_cleanup.web_checks to v3_app;" in sql


def test_it_has_a_commented_rollback():
    assert re.search(r"^--\s*drop table if exists srp_cleanup\.web_checks;", web_text(), flags=re.MULTILINE)


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
    """A scratch schema with the earlier scripts applied (the Web analytics script is applied by each test, so it can be compared before and after)."""
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
    apply(conn, schema, WEB)
    return schema


def check(conn, s: str, **over) -> None:
    """A valid scored row by default (markup, warn, 20 of 42); `over` changes columns."""
    row = {"tier_agent_id": 1, "check_key": "entity_markup", "state": "warn", "result": "Structured data is incomplete", "points": 20, "points_max": 42,
           "source": "From your site scan", "trust_tier": "platform_observed", **over}
    conn.execute(f"insert into {s}.web_checks ({', '.join(row)}) values ({', '.join(['%s'] * len(row))})", list(row.values()))


def unscored(conn, s: str, key: str = "security", state: str = "pass", **over) -> None:
    check(conn, s, **{"check_key": key, "state": state, "result": "HTTPS", "points": None, "points_max": None,
                      "headline": "LCP 1.9 s" if key in HEADLINED else None, **over})


def test_it_adds_the_one_table_and_nothing_else(conn, schema):
    tables_before, before = tables_of(conn, schema), census(conn, schema)
    columns_before = {t: columns_of(conn, schema, t) for t in tables_before}
    cons_before = constraints_of(conn, schema)
    apply(conn, schema, WEB)
    assert tables_of(conn, schema) - tables_before == {"web_checks"}
    assert {t: columns_of(conn, schema, t) for t in tables_before} == columns_before, "no existing table changes its columns"
    assert all(c.endswith("_web_checks") or "web_checks" in c for c in constraints_of(conn, schema) - cons_before), "only the new table's constraints are new"
    after = census(conn, schema)
    assert after["trg"] == before["trg"] and after["fns"] == before["fns"], "no trigger or function is added"


def test_a_second_run_changes_nothing(conn, s):
    before = census(conn, s)
    apply(conn, s, WEB)
    assert census(conn, s) == before


def test_the_table_has_the_spec_columns(conn, s):
    cols = {r["column_name"]: (r["data_type"], r["n"], r["is_nullable"]) for r in conn.execute(
        "select column_name, data_type, character_maximum_length as n, is_nullable from information_schema.columns where table_schema = %s and table_name = 'web_checks'", (s,))}
    assert cols == {
        "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "check_key": ("character varying", 20, "NO"), "state": ("character varying", 4, "NO"),
        "result": ("character varying", 240, "NO"), "headline": ("character varying", 40, "YES"), "points": ("integer", None, "YES"), "points_max": ("integer", None, "YES"),
        "source": ("character varying", 60, "NO"), "trust_tier": ("character varying", 20, "NO"), "is_mock": ("boolean", None, "NO"),
    }


def test_the_table_has_a_bigint_identity_key_an_indexed_seat_and_comments(conn, s):
    idcol = conn.execute("select data_type, is_identity, identity_generation from information_schema.columns where table_schema = %s and table_name = 'web_checks' and column_name = 'id'", (s,)).fetchone()
    assert idcol == {"data_type": "bigint", "is_identity": "YES", "identity_generation": "BY DEFAULT"}
    pk = conn.execute("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = %s::regclass and i.indisprimary", (f"{s}.web_checks",)).fetchall()
    assert [r["attname"] for r in pk] == ["id"]
    assert conn.execute("select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0] where i.indrelid = %s::regclass and a.attname = 'tier_agent_id'", (f"{s}.web_checks",)).fetchone()
    assert conn.execute("select obj_description(%s::regclass) as c", (f"{s}.web_checks",)).fetchone()["c"]
    missing = conn.execute(
        "select a.attname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped "
        "where n.nspname = %s and c.relname = 'web_checks' and col_description(c.oid, a.attnum) is null", (s,)).fetchall()
    assert not missing, missing


def test_no_row_level_security_and_no_policies(conn, s):
    assert not conn.execute(
        "select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and (c.relrowsecurity or c.relforcerowsecurity)", (s,)).fetchone()
    assert not conn.execute("select 1 from pg_policies where schemaname = %s", (s,)).fetchone()


def test_grants_are_closed_to_anon_authenticated_and_public_and_open_to_the_app_role(conn, s):
    acl = conn.execute(
        "select coalesce(r.rolname, 'PUBLIC') as grantee, array_agg(a.privilege_type order by a.privilege_type) as privs "
        "from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a "
        "left join pg_roles r on r.oid = a.grantee where n.nspname = %s and c.relname = 'web_checks' and a.grantee <> c.relowner group by 1", (s,)).fetchall()
    grants = {r["grantee"]: r["privs"] for r in acl}
    assert "PUBLIC" not in grants and "anon" not in grants and "authenticated" not in grants, grants
    if conn.execute("select 1 from pg_roles where rolname = 'v3_app'").fetchone():
        assert grants.get("v3_app") == ["DELETE", "INSERT", "SELECT", "UPDATE"], grants


# --- accepted rows ---------------------------------------------------------------------------------

@pytest.mark.parametrize("key", SCORED)
def test_every_scored_check_is_accepted_at_none_some_and_full_points(conn, s, key):
    check(conn, s, check_key=key, state="fail", points=0, points_max=10)
    conn.execute(f"delete from {s}.web_checks")
    check(conn, s, check_key=key, state="warn", points=1, points_max=10)
    conn.execute(f"delete from {s}.web_checks")
    check(conn, s, check_key=key, state="pass", points=10, points_max=10)


@pytest.mark.parametrize("key", UNSCORED)
@pytest.mark.parametrize("state", ["fail", "warn", "pass"])
def test_every_unscored_check_is_accepted_in_every_state(conn, s, key, state):
    unscored(conn, s, key, state)


@pytest.mark.parametrize("tier", TIERS)
def test_every_trust_tier_is_accepted(conn, s, tier):
    check(conn, s, trust_tier=tier)


def test_defaults(conn, s):
    unscored(conn, s)
    assert conn.execute(f"select is_mock, points, points_max, headline from {s}.web_checks").fetchone() == {"is_mock": True, "points": None, "points_max": None, "headline": None}


# --- refused rows ----------------------------------------------------------------------------------

@pytest.mark.parametrize("over, error", [
    ({"check_key": "markup"}, errors.CheckViolation),
    ({"check_key": "Nap"}, errors.CheckViolation),
    ({"state": "ok"}, errors.CheckViolation),
    ({"state": "PASS"}, errors.CheckViolation),
    ({"trust_tier": "verified"}, errors.CheckViolation),
    ({"trust_tier": None}, errors.NotNullViolation),
    ({"source": None}, errors.NotNullViolation),
    ({"result": None}, errors.NotNullViolation),
    ({"result": ""}, errors.CheckViolation),
    ({"result": "   "}, errors.CheckViolation),
    ({"check_key": None}, errors.NotNullViolation),
    ({"state": None}, errors.NotNullViolation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
    ({"source": "x" * 61}, errors.StringDataRightTruncation),
    ({"result": "x" * 241}, errors.StringDataRightTruncation),
    ({"check_key": "x" * 21}, errors.StringDataRightTruncation),
    # points and their maximum go together
    ({"points": None}, errors.CheckViolation),
    ({"points_max": None}, errors.CheckViolation),
    ({"points": -1, "state": "fail"}, errors.CheckViolation),
    ({"points": 43}, errors.CheckViolation),
    ({"points_max": 0, "points": 0, "state": "fail"}, errors.CheckViolation),
    ({"points_max": 0, "points": 0, "state": "pass"}, errors.CheckViolation),     # full points of nothing is still refused
    ({"points_max": -5, "points": -5, "state": "fail"}, errors.CheckViolation),
    # the state follows the points
    ({"points": 20, "state": "pass"}, errors.CheckViolation),
    ({"points": 20, "state": "fail"}, errors.CheckViolation),
    ({"points": 42, "points_max": 42, "state": "warn"}, errors.CheckViolation),
    ({"points": 42, "points_max": 42, "state": "fail"}, errors.CheckViolation),
    ({"points": 0, "state": "pass"}, errors.CheckViolation),
    ({"points": 0, "state": "warn"}, errors.CheckViolation),
    ({"points": 1, "state": "fail"}, errors.CheckViolation),
    ({"points": 41, "state": "pass"}, errors.CheckViolation),
    # only the four scored checks have points
    ({"check_key": "speed", "headline": "LCP 3.1 s"}, errors.CheckViolation),
    ({"check_key": "security", "state": "warn"}, errors.CheckViolation),
])
def test_a_bad_row_is_refused(conn, s, over, error):
    with pytest.raises(error):
        check(conn, s, **over)


@pytest.mark.parametrize("state", ["ok", "PASS", "", "fai"])
def test_an_unscored_check_refuses_a_state_outside_the_three(conn, s, state):
    with pytest.raises(errors.CheckViolation):
        unscored(conn, s, state=state)


@pytest.mark.parametrize("key", SCORED)
def test_a_scored_check_must_have_points(conn, s, key):
    with pytest.raises(errors.CheckViolation):
        check(conn, s, check_key=key, points=None, points_max=None)


@pytest.mark.parametrize("key", HEADLINED)
def test_a_speed_or_ai_readiness_check_needs_a_headline(conn, s, key):
    with pytest.raises(errors.CheckViolation):
        unscored(conn, s, key, "warn", headline=None)
    unscored(conn, s, key, "warn")  # the default carries one


@pytest.mark.parametrize("key", [k for k in KEYS if k not in HEADLINED])
def test_no_other_check_has_a_headline(conn, s, key):
    over = {"points": 5, "points_max": 10, "state": "warn"} if key in SCORED else {}
    with pytest.raises(errors.CheckViolation):
        (check if key in SCORED else unscored)(conn, s, **({"check_key": key, "headline": "LCP 3.1 s", **over} if key in SCORED else {"key": key, "headline": "x"}))


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_headline_that_is_blank_is_refused(conn, s, blank):
    with pytest.raises(errors.CheckViolation):
        unscored(conn, s, "speed", "warn", headline=blank)


def test_one_row_per_seat_and_check(conn, s):
    unscored(conn, s)
    with pytest.raises(errors.UniqueViolation):
        unscored(conn, s, state="warn")
    unscored(conn, s, tier_agent_id=2)
    unscored(conn, s, key="content", state="fail")
