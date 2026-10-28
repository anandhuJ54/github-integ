"""The SRS page's DDL script (srp/srs-page-schema, task 1): `srp/db/local/srs_schema.sql`.

It is run after `home_schema.sql` and `home_schema_hardening.sql`, adds ONE table (`srs_lane_gaps`) and ONE column
(`home_score_lanes.short_name`) to the local `srp_cleanup` schema, and changes nothing else. The static tests always run;
the rest need a scratch database (they build a scratch schema `srp_it_*`, apply the three scripts to it and drop it):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/<a scratch database> uv run pytest srp/tests/test_srs_schema.py
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
BASE, HARD, SRS = DB / "home_schema.sql", DB / "home_schema_hardening.sql", DB / "srs_schema.sql"
URL = os.environ.get("SRP_TEST_DATABASE_URL")
TARGETS = ("profile", "voce", "website", "connections", "reviews", "chat", "billing")


def srs_text() -> str:
    return SRS.read_text()


def live_sql() -> str:
    """The script without comments (the rollback block is commented out)."""
    return "\n".join(re.sub(r"--.*$", "", line) for line in srs_text().splitlines())


# --- static: the text of the script ---------------------------------------------------------------

def test_the_script_exists_and_is_one_transaction():
    sql = live_sql().strip().lower()
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert sql.count("begin;") == 1 and sql.count("commit;") == 1


def test_it_creates_exactly_one_table_and_adds_exactly_one_column():
    sql = live_sql().lower()
    assert re.findall(r"create table if not exists (\S+)", sql) == ["srp_cleanup.srs_lane_gaps"]
    assert len(re.findall(r"\balter table\b", sql)) == 1
    assert re.search(r"alter table srp_cleanup\.home_score_lanes\s+add column if not exists short_name varchar\(24\)", sql)


def test_it_only_names_the_local_schema_and_changes_no_data():
    sql = live_sql().lower()
    for kw in ("truncate", "delete from", "insert into", "update srp_cleanup", "drop table", "drop column", "drop schema"):
        assert kw not in sql, kw
    assert "public." not in sql and "create schema" not in sql
    assert not re.search(r"\b(?!srp_cleanup)\w+\.(srs_config|user_search_rank|ai_authority|home_)\w*", sql)


def test_it_does_not_touch_the_legacy_srs_tables():
    sql = live_sql().lower()
    for legacy in ("srs_config_", "user_search_rank_scores", "ai_authority_stats"):
        assert legacy not in sql, legacy


def test_it_adds_no_rls_no_function_and_grants_only_to_the_app_role():
    sql = live_sql().lower()
    assert "row level security" not in sql and "create policy" not in sql
    assert "create function" not in sql and "create or replace function" not in sql and "security definer" not in sql
    assert not re.search(r"grant\s+.*\s+to\s+(anon|authenticated|public)", sql)
    assert "revoke all on srp_cleanup.srs_lane_gaps from anon, authenticated, public;" in sql
    assert "grant select, insert, update, delete on srp_cleanup.srs_lane_gaps to v3_app;" in sql


def test_it_has_a_commented_rollback():
    text = srs_text()
    assert re.search(r"^--\s*drop table if exists srp_cleanup\.srs_lane_gaps;", text, flags=re.MULTILINE)
    assert re.search(r"^--\s*alter table srp_cleanup\.home_score_lanes drop column if exists short_name;", text, flags=re.MULTILINE)


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


@pytest.fixture
def schema(conn):
    """A scratch schema with the Home scripts applied (the SRS script is applied by each test, so it can be compared before and after)."""
    name = "srp_it_" + uuid.uuid4().hex[:8]
    conn.execute(f"create schema {name}")
    conn.execute(f"create table {name}.tier_agents (id bigint generated by default as identity primary key, user_id bigint)")
    conn.execute(f"insert into {name}.tier_agents (id, user_id) overriding system value values (1, 1), (2, 2)")
    try:
        apply(conn, name, BASE)
        apply(conn, name, HARD)
        conn.execute(f"insert into {name}.home_score_lanes (key, name, max_points, position) values ('articles', 'Articles', 103, 1), ('gbp', 'Google Business Profile', 68, 2)")
        yield name
    finally:
        conn.execute(f"drop schema if exists {name} cascade")


@pytest.fixture
def s(conn, schema):
    apply(conn, schema, SRS)
    return schema


def lane_id(conn, s: str, key: str = "articles") -> int:
    return conn.execute(f"select id from {s}.home_score_lanes where key = %s", (key,)).fetchone()["id"]


def gap(conn, s: str, **over) -> None:
    row = {"tier_agent_id": 1, "lane_id": lane_id(conn, s), "you_text": "0 articles", "rival_text": "14 articles", "action_label": "Start publishing",
           "action_target": "voce", **over}
    cols = ", ".join(row)
    conn.execute(f"insert into {s}.srs_lane_gaps ({cols}) values ({', '.join(['%s'] * len(row))})", list(row.values()))


def test_it_adds_the_table_and_the_column_and_nothing_else(conn, schema):
    tables_before = {r["relname"] for r in conn.execute("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and c.relkind = 'r'", (schema,))}
    lanes_before = columns_of(conn, schema, "home_score_lanes")
    before = census(conn, schema)
    apply(conn, schema, SRS)
    tables_after = {r["relname"] for r in conn.execute("select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and c.relkind = 'r'", (schema,))}
    assert tables_after - tables_before == {"srs_lane_gaps"} and tables_before <= tables_after
    assert columns_of(conn, schema, "home_score_lanes") == [*lanes_before, "short_name"]
    after = census(conn, schema)
    assert after["trg"] == before["trg"] and after["fns"] == before["fns"], "no trigger or function is added"


def test_the_other_home_tables_and_the_seat_table_are_untouched(conn, schema):
    others = [r["relname"] for r in conn.execute(
        "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and c.relkind = 'r' and relname <> 'home_score_lanes' order by 1", (schema,))]
    before = {t: columns_of(conn, schema, t) for t in others}
    apply(conn, schema, SRS)
    assert {t: columns_of(conn, schema, t) for t in others} == before
    assert columns_of(conn, schema, "tier_agents") == ["id", "user_id"]


def test_a_second_run_changes_nothing(conn, s):
    before = census(conn, s)
    apply(conn, s, SRS)
    assert census(conn, s) == before


def test_the_short_name_column_is_a_nullable_varchar_24_with_a_comment(conn, s):
    col = conn.execute(
        "select data_type, character_maximum_length as n, is_nullable from information_schema.columns "
        "where table_schema = %s and table_name = 'home_score_lanes' and column_name = 'short_name'", (s,)).fetchone()
    assert col == {"data_type": "character varying", "n": 24, "is_nullable": "YES"}
    assert conn.execute("select col_description(%s::regclass, (select attnum from pg_attribute where attrelid = %s::regclass and attname = 'short_name')) as c",
                        (f"{s}.home_score_lanes", f"{s}.home_score_lanes")).fetchone()["c"]
    conn.execute(f"update {s}.home_score_lanes set short_name = %s where key = 'gbp'", ("G" * 24,))
    conn.execute(f"update {s}.home_score_lanes set short_name = null where key = 'gbp'")
    with pytest.raises(errors.StringDataRightTruncation):
        conn.execute(f"update {s}.home_score_lanes set short_name = %s where key = 'gbp'", ("G" * 25,))


def test_the_table_has_a_bigint_identity_key_and_the_spec_columns(conn, s):
    idcol = conn.execute(
        "select data_type, is_identity, identity_generation from information_schema.columns where table_schema = %s and table_name = 'srs_lane_gaps' and column_name = 'id'", (s,)).fetchone()
    assert idcol == {"data_type": "bigint", "is_identity": "YES", "identity_generation": "BY DEFAULT"}
    pk = conn.execute("select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = %s::regclass and i.indisprimary", (f"{s}.srs_lane_gaps",)).fetchall()
    assert [r["attname"] for r in pk] == ["id"]
    cols = {r["column_name"]: (r["data_type"], r["n"], r["is_nullable"]) for r in conn.execute(
        "select column_name, data_type, character_maximum_length as n, is_nullable from information_schema.columns where table_schema = %s and table_name = 'srs_lane_gaps'", (s,))}
    assert cols == {
        "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "lane_id": ("bigint", None, "NO"),
        "you_text": ("character varying", 200, "NO"), "rival_text": ("character varying", 200, "NO"), "note": ("character varying", 200, "YES"),
        "is_missing": ("boolean", None, "NO"), "action_label": ("character varying", 60, "NO"), "action_target": ("character varying", 16, "NO"),
        "is_mock": ("boolean", None, "NO"),
    }


def test_the_seat_and_lane_columns_are_indexed(conn, s):
    for col in ("tier_agent_id", "lane_id"):
        assert conn.execute(
            "select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0] where i.indrelid = %s::regclass and a.attname = %s",
            (f"{s}.srs_lane_gaps", col)).fetchone(), col


def test_the_table_and_every_column_has_a_comment(conn, s):
    assert conn.execute("select obj_description(%s::regclass) as c", (f"{s}.srs_lane_gaps",)).fetchone()["c"]
    missing = conn.execute(
        "select a.attname from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped "
        "where n.nspname = %s and c.relname = 'srs_lane_gaps' and col_description(c.oid, a.attnum) is null", (s,)).fetchall()
    assert not missing, missing


def test_no_row_level_security_and_no_policies(conn, s):
    assert not conn.execute(
        "select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %s and (c.relrowsecurity or c.relforcerowsecurity)", (s,)).fetchone()
    assert not conn.execute("select 1 from pg_policies where schemaname = %s", (s,)).fetchone()


def test_grants_are_closed_to_anon_authenticated_and_public_and_open_to_the_app_role(conn, s):
    acl = conn.execute(
        "select coalesce(r.rolname, 'PUBLIC') as grantee, array_agg(a.privilege_type order by a.privilege_type) as privs "
        "from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a "
        "left join pg_roles r on r.oid = a.grantee where n.nspname = %s and c.relname = 'srs_lane_gaps' and a.grantee <> c.relowner group by 1", (s,)).fetchall()
    grants = {r["grantee"]: r["privs"] for r in acl}
    assert "PUBLIC" not in grants and "anon" not in grants and "authenticated" not in grants, grants
    if conn.execute("select 1 from pg_roles where rolname = 'v3_app'").fetchone():
        assert grants.get("v3_app") == ["DELETE", "INSERT", "SELECT", "UPDATE"], grants


# constraints: each bad row is refused -------------------------------------------------------------------

def test_a_valid_row_goes_in_with_the_defaults(conn, s):
    gap(conn, s)
    row = conn.execute(f"select note, is_missing, is_mock from {s}.srs_lane_gaps").fetchone()
    assert row == {"note": None, "is_missing": False, "is_mock": True}


@pytest.mark.parametrize("target", TARGETS)
def test_every_screen_target_is_accepted(conn, s, target):
    gap(conn, s, action_target=target)


def test_a_note_and_the_missing_flag_can_be_set(conn, s):
    gap(conn, s, note="31 in the last 12 months", is_missing=True)
    assert conn.execute(f"select note, is_missing from {s}.srs_lane_gaps").fetchone() == {"note": "31 in the last 12 months", "is_missing": True}


@pytest.mark.parametrize("over, error", [
    ({"action_target": "elsewhere"}, errors.CheckViolation),
    ({"action_target": "Billing"}, errors.CheckViolation),
    ({"action_target": "x"}, errors.CheckViolation),
    ({"action_target": "listings"}, errors.CheckViolation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
    ({"lane_id": 99999}, errors.ForeignKeyViolation),
    ({"you_text": None}, errors.NotNullViolation),
    ({"rival_text": None}, errors.NotNullViolation),
    ({"action_label": None}, errors.NotNullViolation),
    ({"action_target": None}, errors.NotNullViolation),
    ({"is_missing": None}, errors.NotNullViolation),
    ({"you_text": "x" * 201}, errors.StringDataRightTruncation),
    ({"action_label": "x" * 61}, errors.StringDataRightTruncation),
])
def test_a_bad_row_is_refused(conn, s, over, error):
    with pytest.raises(error):
        gap(conn, s, **over)


def test_a_second_row_for_the_same_seat_and_lane_is_refused_but_another_seat_or_lane_is_fine(conn, s):
    gap(conn, s)
    with pytest.raises(errors.UniqueViolation):
        gap(conn, s, you_text="1 article")
    gap(conn, s, tier_agent_id=2)
    gap(conn, s, lane_id=lane_id(conn, s, "gbp"), action_target="connections")


def test_a_lane_with_gap_rows_cannot_be_deleted(conn, s):
    gap(conn, s)
    with pytest.raises(errors.ForeignKeyViolation):
        conn.execute(f"delete from {s}.home_score_lanes where key = 'articles'")
