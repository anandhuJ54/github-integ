"""The Insights page's DDL script (srp/insights-page-schema, task 1): `srp/db/local/insights_schema.sql`.

It is run after `home_schema.sql`, `home_schema_hardening.sql`, `srs_schema.sql` and `profile_schema.sql`, adds FOUR tables (`insights_visibility`,
`insights_ai_engines`, `insights_competitor_positions`, `insights_spot_leaders`) to the local `srp_cleanup` schema and one unique constraint
`(id, tier_agent_id)` to Home's `home_competitors`; it changes nothing else. The static tests always run; the rest need a scratch database (they build a
scratch schema `srp_it_*`, apply the scripts to it and drop it):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/<a scratch database> uv run pytest srp/tests/test_insights_schema.py
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
BASE, HARD, SRS, PROFILE, INSIGHTS = (DB / n for n in ("home_schema.sql", "home_schema_hardening.sql", "srs_schema.sql", "profile_schema.sql", "insights_schema.sql"))
URL = os.environ.get("SRP_TEST_DATABASE_URL")
TABLES = ("insights_visibility", "insights_ai_engines", "insights_competitor_positions", "insights_spot_leaders")
METRICS = ("search_views", "maps_views", "calls", "directions", "website_clicks", "profile_views")
ENGINES = ("chatgpt", "gemini", "perplexity")
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")


def insights_text() -> str:
    return INSIGHTS.read_text()


def live_sql() -> str:
    """The script without comments (the rollback block is commented out)."""
    return "\n".join(re.sub(r"--.*$", "", line) for line in insights_text().splitlines())


# --- static: the text of the script ---------------------------------------------------------------

def test_the_script_exists_and_is_one_transaction():
    sql = live_sql().strip().lower()
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert sql.count("begin;") == 1 and sql.count("commit;") == 1


def test_it_creates_exactly_four_tables_and_adds_one_constraint():
    sql = live_sql().lower()
    assert re.findall(r"create table if not exists (\S+)", sql) == [f"srp_cleanup.{t}" for t in TABLES]
    assert re.findall(r"\balter table\b\s+(\S+)", sql) == ["srp_cleanup.home_competitors"]
    assert len(re.findall(r"add constraint", sql)) == 1 and "uq_home_competitors_id_seat" in sql and "unique (id, tier_agent_id)" in sql


def test_it_only_names_the_local_schema_and_changes_no_data():
    sql = live_sql().lower()
    for kw in ("truncate", "delete from", "insert into", "update srp_cleanup", "drop table", "drop column", "drop schema"):
        assert kw not in sql, kw
    assert "public." not in sql and "create schema" not in sql


def test_it_does_not_touch_the_legacy_tables():
    sql = live_sql().lower()
    for other in ("google_analytics", "ai_authority_stats", "srs_config_", "user_search_rank_scores", "tier_locations", "agent_locations", "locations", "tiers", "users"):
        assert f"srp_cleanup.{other}" not in sql, other
    assert set(re.findall(r"references (srp_cleanup\.\w+)", sql)) == {"srp_cleanup.tier_agents", "srp_cleanup.home_competitors", "srp_cleanup.home_map_cells"}


def test_it_adds_no_rls_no_function_no_trigger_and_grants_only_to_the_app_role():
    sql = live_sql().lower()
    assert "row level security" not in sql and "create policy" not in sql
    assert "create function" not in sql and "create or replace function" not in sql and "security definer" not in sql and "create trigger" not in sql
    assert not re.search(r"grant\s+.*\s+to\s+(anon|authenticated|public)", sql)
    for t in TABLES:
        assert f"revoke all on srp_cleanup.{t} from anon, authenticated, public;" in sql
        assert f"grant select, insert, update, delete on srp_cleanup.{t} to v3_app;" in sql


def test_it_has_a_commented_rollback():
    text = insights_text()
    for t in reversed(TABLES):
        assert re.search(rf"^--\s*drop table if exists srp_cleanup\.{t};", text, flags=re.MULTILINE)
    assert re.search(r"^--\s*alter table srp_cleanup\.home_competitors drop constraint if exists uq_home_competitors_id_seat;", text, flags=re.MULTILINE)


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


def constraints_of(conn, schema: str, table: str) -> set[str]:
    return {r["conname"] for r in conn.execute("select conname from pg_constraint where conrelid = %s::regclass", (f"{schema}.{table}",))}


@pytest.fixture
def schema(conn):
    """A scratch schema with the Home, SRS and Profile scripts applied (the Insights script is applied by each test, so it can be compared before and after)."""
    name = "srp_it_" + uuid.uuid4().hex[:8]
    conn.execute(f"create schema {name}")
    conn.execute(f"create table {name}.tier_agents (id bigint generated by default as identity primary key, user_id bigint)")
    conn.execute(f"insert into {name}.tier_agents (id, user_id) overriding system value values (1, 1), (2, 2)")
    try:
        for path in (BASE, HARD, SRS, PROFILE):
            apply(conn, name, path)
        yield name
    finally:
        conn.execute(f"drop schema if exists {name} cascade")


@pytest.fixture
def s(conn, schema):
    apply(conn, schema, INSIGHTS)
    # two seats, each with a snapshot, one map cell and one rival
    conn.execute(f"insert into {schema}.home_snapshots (id, tier_agent_id, as_of, total) overriding system value values (1, 1, '2026-10-27', 100), (2, 2, '2026-10-27', 100)")
    conn.execute(f"insert into {schema}.home_map_cells (id, snapshot_id, row_no, col_no, rank) overriding system value values (1, 1, 0, 0, 2), (2, 2, 0, 0, 5)")
    conn.execute(f"insert into {schema}.home_competitors (id, tier_agent_id, name, score, is_market_leader, position) overriding system value values "
                 "(1, 1, 'Rival One', 500, true, 1), (2, 2, 'Rival Two', 400, true, 1)")
    return schema


def insert(conn, s: str, table: str, base: dict, over: dict) -> None:
    row = {**base, **over}
    conn.execute(f"insert into {s}.{table} ({', '.join(row)}) values ({', '.join(['%s'] * len(row))})", list(row.values()))


def vis(conn, s, **o):
    insert(conn, s, "insights_visibility", {"tier_agent_id": 1, "metric": "calls", "value": 12, "source": "From Google", "trust_tier": "imported"}, o)


def eng(conn, s, **o):
    insert(conn, s, "insights_ai_engines", {"tier_agent_id": 1, "engine": "chatgpt", "cited": 1, "checked": 3, "note": "Names you for refinance."}, o)


def pos(conn, s, **o):
    insert(conn, s, "insights_competitor_positions", {"tier_agent_id": 1, "competitor_id": 1, "avg_position": 2.4}, o)


def lead(conn, s, **o):
    insert(conn, s, "insights_spot_leaders", {"cell_id": 1, "position": 1, "name": "Rival One", "is_you": False}, o)


def test_it_adds_the_four_tables_and_the_one_constraint_and_nothing_else(conn, schema):
    tables_before, before = tables_of(conn, schema), census(conn, schema)
    columns_before = {t: columns_of(conn, schema, t) for t in tables_before}
    cons_before = constraints_of(conn, schema, "home_competitors")
    apply(conn, schema, INSIGHTS)
    assert tables_of(conn, schema) - tables_before == set(TABLES)
    assert {t: columns_of(conn, schema, t) for t in tables_before} == columns_before, "no existing table changes its columns"
    assert constraints_of(conn, schema, "home_competitors") - cons_before == {"uq_home_competitors_id_seat"}
    after = census(conn, schema)
    assert after["trg"] == before["trg"] and after["fns"] == before["fns"], "no trigger or function is added"


def test_a_second_run_changes_nothing(conn, s):
    before = census(conn, s)
    apply(conn, s, INSIGHTS)
    assert census(conn, s) == before


def cols(conn, s, table):
    return {r["column_name"]: (r["data_type"], r["n"], r["is_nullable"]) for r in conn.execute(
        "select column_name, data_type, character_maximum_length as n, is_nullable from information_schema.columns where table_schema = %s and table_name = %s", (s, table))}


def test_the_tables_have_the_spec_columns(conn, s):
    assert cols(conn, s, "insights_visibility") == {
        "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "metric": ("character varying", 20, "NO"), "value": ("integer", None, "NO"),
        "period_days": ("integer", None, "NO"), "source": ("character varying", 60, "NO"), "trust_tier": ("character varying", 20, "NO"), "is_mock": ("boolean", None, "NO")}
    assert cols(conn, s, "insights_ai_engines") == {
        "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "engine": ("character varying", 12, "NO"), "cited": ("integer", None, "NO"),
        "checked": ("integer", None, "NO"), "note": ("character varying", 120, "YES"), "is_mock": ("boolean", None, "NO")}
    assert cols(conn, s, "insights_competitor_positions") == {
        "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "competitor_id": ("bigint", None, "NO"), "avg_position": ("numeric", None, "NO"),
        "is_mock": ("boolean", None, "NO")}
    assert cols(conn, s, "insights_spot_leaders") == {
        "id": ("bigint", None, "NO"), "cell_id": ("bigint", None, "NO"), "position": ("smallint", None, "NO"), "name": ("character varying", 160, "YES"),
        "is_you": ("boolean", None, "NO"), "is_mock": ("boolean", None, "NO")}


def test_avg_position_has_one_decimal(conn, s):
    row = conn.execute("select numeric_precision p, numeric_scale sc from information_schema.columns where table_schema = %s and table_name = 'insights_competitor_positions' and column_name = 'avg_position'", (s,)).fetchone()
    assert (row["p"], row["sc"]) == (3, 1)


@pytest.mark.parametrize("table", TABLES)
def test_each_table_has_a_bigint_identity_key_an_index_on_its_parent_and_comments(conn, s, table):
    idcol = conn.execute(
        "select data_type, is_identity, identity_generation from information_schema.columns where table_schema = %s and table_name = %s and column_name = 'id'", (s, table)).fetchone()
    assert idcol == {"data_type": "bigint", "is_identity": "YES", "identity_generation": "BY DEFAULT"}
    pk = conn.execute("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = %s::regclass and i.indisprimary", (f"{s}.{table}",)).fetchall()
    assert [r["attname"] for r in pk] == ["id"]
    parent = "cell_id" if table == "insights_spot_leaders" else "tier_agent_id"
    assert conn.execute("select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0] where i.indrelid = %s::regclass and a.attname = %s", (f"{s}.{table}", parent)).fetchone()
    assert conn.execute("select obj_description(%s::regclass) as c", (f"{s}.{table}",)).fetchone()["c"]
    missing = conn.execute(
        "select a.attname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped "
        "where n.nspname = %s and c.relname = %s and col_description(c.oid, a.attnum) is null", (s, table)).fetchall()
    assert not missing, missing


def test_no_row_level_security_and_no_policies(conn, s):
    assert not conn.execute(
        "select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and (c.relrowsecurity or c.relforcerowsecurity)", (s,)).fetchone()
    assert not conn.execute("select 1 from pg_policies where schemaname = %s", (s,)).fetchone()


@pytest.mark.parametrize("table", TABLES)
def test_grants_are_closed_to_anon_authenticated_and_public_and_open_to_the_app_role(conn, s, table):
    acl = conn.execute(
        "select coalesce(r.rolname, 'PUBLIC') as grantee, array_agg(a.privilege_type order by a.privilege_type) as privs "
        "from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a "
        "left join pg_roles r on r.oid = a.grantee where n.nspname = %s and c.relname = %s and a.grantee <> c.relowner group by 1", (s, table)).fetchall()
    grants = {r["grantee"]: r["privs"] for r in acl}
    assert "PUBLIC" not in grants and "anon" not in grants and "authenticated" not in grants, grants
    if conn.execute("select 1 from pg_roles where rolname = 'v3_app'").fetchone():
        assert grants.get("v3_app") == ["DELETE", "INSERT", "SELECT", "UPDATE"], grants


# insights_visibility --------------------------------------------------------------------------------------

@pytest.mark.parametrize("metric", METRICS)
def test_every_metric_is_accepted(conn, s, metric):
    vis(conn, s, metric=metric)


@pytest.mark.parametrize("tier", TIERS)
def test_every_trust_tier_is_accepted(conn, s, tier):
    vis(conn, s, trust_tier=tier)


def test_visibility_defaults_and_zero_value(conn, s):
    vis(conn, s, value=0)
    assert conn.execute(f"select period_days, is_mock, value from {s}.insights_visibility").fetchone() == {"period_days": 30, "is_mock": True, "value": 0}


@pytest.mark.parametrize("over, error", [
    ({"metric": "views"}, errors.CheckViolation),
    ({"metric": "Calls"}, errors.CheckViolation),
    ({"value": -1}, errors.CheckViolation),
    ({"value": None}, errors.NotNullViolation),
    ({"period_days": 0}, errors.CheckViolation),
    ({"period_days": -30}, errors.CheckViolation),
    ({"trust_tier": "verified"}, errors.CheckViolation),
    ({"trust_tier": None}, errors.NotNullViolation),
    ({"source": None}, errors.NotNullViolation),
    ({"source": "x" * 61}, errors.StringDataRightTruncation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
])
def test_a_bad_visibility_row_is_refused(conn, s, over, error):
    with pytest.raises(error):
        vis(conn, s, **over)


def test_one_visibility_row_per_seat_and_metric(conn, s):
    vis(conn, s)
    with pytest.raises(errors.UniqueViolation):
        vis(conn, s, value=5)
    vis(conn, s, tier_agent_id=2)
    vis(conn, s, metric="directions")


# insights_ai_engines --------------------------------------------------------------------------------------

@pytest.mark.parametrize("engine", ENGINES)
def test_every_engine_is_accepted(conn, s, engine):
    eng(conn, s, engine=engine)


def test_an_engine_note_is_optional_and_cited_may_equal_checked_or_be_zero(conn, s):
    eng(conn, s, engine="chatgpt", note=None, cited=3, checked=3)
    eng(conn, s, engine="gemini", cited=0, checked=0)
    assert conn.execute(f"select is_mock from {s}.insights_ai_engines limit 1").fetchone() == {"is_mock": True}


@pytest.mark.parametrize("over, error", [
    ({"engine": "bing"}, errors.CheckViolation),
    ({"engine": "ChatGPT"}, errors.CheckViolation),
    ({"cited": 4, "checked": 3}, errors.CheckViolation),
    ({"cited": -1}, errors.CheckViolation),
    ({"checked": -1, "cited": -2}, errors.CheckViolation),
    ({"cited": None}, errors.NotNullViolation),
    ({"checked": None}, errors.NotNullViolation),
    ({"note": "x" * 121}, errors.StringDataRightTruncation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
])
def test_a_bad_engine_row_is_refused(conn, s, over, error):
    with pytest.raises(error):
        eng(conn, s, **over)


def test_one_engine_row_per_seat_and_engine(conn, s):
    eng(conn, s)
    with pytest.raises(errors.UniqueViolation):
        eng(conn, s, cited=2)
    eng(conn, s, tier_agent_id=2)
    eng(conn, s, engine="gemini")


# insights_competitor_positions ----------------------------------------------------------------------------

def test_a_position_for_a_rival_of_the_same_seat_is_accepted(conn, s):
    pos(conn, s)
    pos(conn, s, tier_agent_id=2, competitor_id=2, avg_position=1.0)
    assert conn.execute(f"select avg_position::text a, is_mock from {s}.insights_competitor_positions where tier_agent_id = 1").fetchone() == {"a": "2.4", "is_mock": True}


def test_a_position_cannot_name_another_seats_rival(conn, s):
    with pytest.raises(errors.ForeignKeyViolation):
        pos(conn, s, tier_agent_id=1, competitor_id=2)
    with pytest.raises(errors.ForeignKeyViolation):
        pos(conn, s, tier_agent_id=2, competitor_id=1)


@pytest.mark.parametrize("over, error", [
    ({"avg_position": 0.9}, errors.CheckViolation),
    ({"avg_position": 0}, errors.CheckViolation),
    ({"avg_position": -1}, errors.CheckViolation),
    ({"avg_position": None}, errors.NotNullViolation),
    ({"competitor_id": None}, errors.NotNullViolation),
    ({"competitor_id": 99}, errors.ForeignKeyViolation),
    ({"avg_position": 100}, errors.NumericValueOutOfRange),
])
def test_a_bad_position_row_is_refused(conn, s, over, error):
    with pytest.raises(error):
        pos(conn, s, **over)


def test_one_position_per_rival(conn, s):
    pos(conn, s)
    with pytest.raises(errors.UniqueViolation):
        pos(conn, s, avg_position=3.0)


def test_the_new_unique_on_home_competitors_is_what_the_foreign_key_uses(conn, s):
    cons = conn.execute("select conname, pg_get_constraintdef(oid) d from pg_constraint where conrelid = %s::regclass and contype in ('u', 'f')", (f"{s}.insights_competitor_positions",)).fetchall()
    defs = " ".join(c["d"] for c in cons)
    assert "(competitor_id, tier_agent_id)" in defs and "home_competitors(id, tier_agent_id)" in defs.replace(f"{s}.", "")


# insights_spot_leaders ------------------------------------------------------------------------------------

@pytest.mark.parametrize("position", [1, 2, 3])
def test_every_leader_position_is_accepted(conn, s, position):
    lead(conn, s, position=position)


def test_a_leader_is_you_with_no_name_or_a_rival_with_a_name(conn, s):
    lead(conn, s, position=1, name=None, is_you=True)
    lead(conn, s, position=2, name="Rival One", is_you=False)
    assert conn.execute(f"select is_mock from {s}.insights_spot_leaders limit 1").fetchone() == {"is_mock": True}


@pytest.mark.parametrize("over, error", [
    ({"position": 0}, errors.CheckViolation),
    ({"position": 4}, errors.CheckViolation),
    ({"position": None}, errors.NotNullViolation),
    ({"name": "Pat", "is_you": True}, errors.CheckViolation),        # "You" has no name
    ({"name": None, "is_you": False}, errors.CheckViolation),        # a rival has one
    ({"is_you": None}, errors.NotNullViolation),
    ({"name": "x" * 161}, errors.StringDataRightTruncation),
    ({"cell_id": 99}, errors.ForeignKeyViolation),
    ({"cell_id": None}, errors.NotNullViolation),
])
def test_a_bad_leader_row_is_refused(conn, s, over, error):
    with pytest.raises(error):
        lead(conn, s, **over)


def test_one_leader_per_cell_and_position(conn, s):
    lead(conn, s)
    with pytest.raises(errors.UniqueViolation):
        lead(conn, s, name="Other")
    lead(conn, s, position=2, name="Other")
    lead(conn, s, cell_id=2)


def test_leaders_go_with_their_cell(conn, s):
    lead(conn, s)
    lead(conn, s, position=2, cell_id=2)
    conn.execute(f"delete from {s}.home_snapshots where id = 1")
    assert conn.execute(f"select count(*) n from {s}.insights_spot_leaders").fetchone()["n"] == 1
