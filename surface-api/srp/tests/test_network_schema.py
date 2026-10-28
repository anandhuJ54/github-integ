"""The Network page's DDL script (srp/network-page-schema, task 1): `srp/db/local/network_schema.sql`.

It is run after the Home, SRS, Profile, Insights, Web analytics and Connections scripts, adds TWO tables (`network_partners`, `network_referrals`) to the local `srp_cleanup`
schema and changes nothing else. The static tests always run; the rest need a scratch database (they build a scratch schema `srp_it_*`, apply the scripts to it and drop it):

    SRP_TEST_DATABASE_URL=postgresql://localhost:5432/<a scratch database> uv run pytest srp/tests/test_network_schema.py
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
SCRIPTS = [DB / n for n in ("home_schema.sql", "home_schema_hardening.sql", "srs_schema.sql", "profile_schema.sql", "insights_schema.sql", "web_analytics_schema.sql",
                            "connections_schema.sql")]
NET = DB / "network_schema.sql"
URL = os.environ.get("SRP_TEST_DATABASE_URL")
TABLES = ("network_partners", "network_referrals")
STATES = ("promoted", "request", "suggested", "saved")
KINDS = {"promoted": None, "request": "asked", "suggested": "zillow", "saved": "saved"}
ROLES = ("Agent", "Title", "Inspector")
LISTS = {"received": ("new", "followed", "closed"), "requested": ("waiting", "replied"), "given": ("thanked", "done")}
TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
PARTNER_COLUMNS = {
    "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "position": ("integer", None, "NO"), "name": ("character varying", 80, "NO"),
    "company": ("character varying", 80, "NO"), "role": ("character varying", 10, "NO"), "state": ("character varying", 9, "NO"),
    "reason_kind": ("character varying", 8, "YES"), "reason_count": ("integer", None, "YES"), "reason_on": ("date", None, "YES"),
    "source": ("character varying", 60, "NO"), "trust_tier": ("character varying", 20, "NO"), "is_mock": ("boolean", None, "NO"),
}
REFERRAL_COLUMNS = {
    "id": ("bigint", None, "NO"), "tier_agent_id": ("bigint", None, "NO"), "list_key": ("character varying", 9, "NO"), "position": ("integer", None, "NO"),
    "name": ("character varying", 80, "NO"), "detail": ("character varying", 80, "NO"), "partner_id": ("bigint", None, "YES"), "status": ("character varying", 8, "NO"),
    "occurred_on": ("date", None, "NO"), "source": ("character varying", 60, "NO"), "trust_tier": ("character varying", 20, "NO"), "is_mock": ("boolean", None, "NO"),
}


def net_text() -> str:
    return NET.read_text()


def live_sql() -> str:
    """The script without comments (the rollback block is commented out)."""
    return "\n".join(re.sub(r"--.*$", "", line) for line in net_text().splitlines())


# --- static: the text of the script ---------------------------------------------------------------

def test_the_script_exists_and_is_one_transaction():
    sql = live_sql().strip().lower()
    assert sql.startswith("begin;") and sql.rstrip().endswith("commit;")
    assert sql.count("begin;") == 1 and sql.count("commit;") == 1


def test_it_creates_exactly_the_two_tables_partners_first_and_alters_nothing():
    sql = live_sql().lower()
    assert re.findall(r"create table if not exists (\S+)", sql) == ["srp_cleanup.network_partners", "srp_cleanup.network_referrals"]
    assert not re.search(r"\balter table\b", sql)


def test_it_only_names_the_local_schema_and_changes_no_data():
    sql = live_sql().lower()
    for kw in ("truncate", "delete from", "insert into", "update srp_cleanup", "drop table", "drop column", "drop schema"):
        assert kw not in sql, kw
    assert "public." not in sql and "create schema" not in sql


def test_it_does_not_touch_the_legacy_or_other_tables():
    sql = live_sql().lower()
    for other in ("pin_partner_profiles", "referral_sents", "referral_requests", "referral_histories", "referral_emails", "partners", "invite_partners", "invite_signups",
                  "invite_members", "home_", "srs_", "profile_", "insights_", "web_", "connected_accounts"):
        assert f"srp_cleanup.{other}" not in sql, other
    assert set(re.findall(r"references (srp_cleanup\.\w+)", sql)) == {"srp_cleanup.tier_agents", "srp_cleanup.network_partners"}


def test_it_adds_no_rls_no_function_no_trigger_and_grants_only_to_the_app_role():
    sql = live_sql().lower()
    assert "row level security" not in sql and "create policy" not in sql
    assert "create function" not in sql and "create or replace function" not in sql and "security definer" not in sql and "create trigger" not in sql
    assert not re.search(r"grant\s+.*\s+to\s+(anon|authenticated|public)", sql)
    for t in TABLES:
        assert f"revoke all on srp_cleanup.{t} from anon, authenticated, public;" in sql, t
        assert f"grant select, insert, update, delete on srp_cleanup.{t} to v3_app;" in sql, t


def test_it_has_a_commented_rollback_that_drops_the_referrals_first():
    found = re.findall(r"^--\s*drop table if exists (srp_cleanup\.\w+);", net_text(), flags=re.MULTILINE)
    assert found == ["srp_cleanup.network_referrals", "srp_cleanup.network_partners"]


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
    """A scratch schema with the earlier scripts applied (the Network script is applied by each test, so it can be compared before and after)."""
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
    apply(conn, schema, NET)
    return schema


def insert(conn, s: str, table: str, row: dict) -> int:
    return conn.execute(f"insert into {s}.{table} ({', '.join(row)}) values ({', '.join(['%s'] * len(row))}) returning id", list(row.values())).fetchone()["id"]


def partner(conn, s: str, **over) -> int:
    """A valid promoted partner by default; `over` changes columns."""
    row = {"tier_agent_id": 1, "position": 1, "name": "Mock Partner One", "company": "Mock Lending Co", "role": "Agent", "state": "promoted", "reason_kind": None,
           "reason_count": None, "reason_on": None, "source": "From your sign-in", "trust_tier": "owner_verified", **over}
    return insert(conn, s, "network_partners", row)


def referral(conn, s: str, **over) -> int:
    """A valid received referral (new, from the profile) by default; `over` changes columns."""
    row = {"tier_agent_id": 1, "list_key": "received", "position": 1, "name": "Mock Person", "detail": "First-time buyers", "partner_id": None, "status": "new",
           "occurred_on": "2026-10-14", "source": "From your sign-in", "trust_tier": "owner_verified", **over}
    return insert(conn, s, "network_referrals", row)


def test_it_adds_the_two_tables_and_nothing_else(conn, schema):
    tables_before, before = tables_of(conn, schema), census(conn, schema)
    columns_before = {t: columns_of(conn, schema, t) for t in tables_before}
    cons_before = constraints_of(conn, schema)
    apply(conn, schema, NET)
    assert tables_of(conn, schema) - tables_before == set(TABLES)
    assert {t: columns_of(conn, schema, t) for t in tables_before} == columns_before, "no existing table changes its columns"
    assert all("network_" in c for c in constraints_of(conn, schema) - cons_before), "only the new tables' constraints are new"
    after = census(conn, schema)
    assert after["trg"] == before["trg"] and after["fns"] == before["fns"], "no trigger or function is added"


def test_a_second_run_changes_nothing(conn, s):
    before = census(conn, s)
    apply(conn, s, NET)
    assert census(conn, s) == before


@pytest.mark.parametrize("table, expected", [("network_partners", PARTNER_COLUMNS), ("network_referrals", REFERRAL_COLUMNS)])
def test_each_table_has_exactly_the_spec_columns_and_none_that_could_hold_a_contact_detail(conn, s, table, expected):
    cols = {r["column_name"]: (r["data_type"], r["n"], r["is_nullable"]) for r in conn.execute(
        "select column_name, data_type, character_maximum_length as n, is_nullable from information_schema.columns where table_schema = %s and table_name = %s", (s, table))}
    assert cols == expected


@pytest.mark.parametrize("table", TABLES)
def test_each_table_has_a_bigint_identity_key_an_indexed_seat_and_comments(conn, s, table):
    idcol = conn.execute("select data_type, is_identity, identity_generation from information_schema.columns where table_schema = %s and table_name = %s and column_name = 'id'", (s, table)).fetchone()
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


# --- accepted partner rows ---------------------------------------------------------------------------

@pytest.mark.parametrize("state", STATES)
def test_every_state_is_accepted_with_its_own_reason(conn, s, state):
    over = {"state": state, "reason_kind": KINDS[state]}
    if state == "saved":
        over["reason_on"] = "2026-10-12"
    if state == "suggested":
        over["reason_count"] = 2
    partner(conn, s, **over)


@pytest.mark.parametrize("kind", ["zillow", "closings"])
def test_a_suggestion_can_cite_zillow_or_closings_with_a_count(conn, s, kind):
    partner(conn, s, state="suggested", reason_kind=kind, reason_count=3)


@pytest.mark.parametrize("role", ROLES)
def test_every_role_is_accepted(conn, s, role):
    partner(conn, s, role=role)


@pytest.mark.parametrize("tier", TIERS)
def test_every_trust_tier_is_accepted_on_both_tables(conn, s, tier):
    partner(conn, s, trust_tier=tier)
    referral(conn, s, trust_tier=tier)


def test_one_position_and_one_name_per_seat(conn, s):
    partner(conn, s)
    with pytest.raises(errors.UniqueViolation):
        partner(conn, s, name="Another Name")
    with pytest.raises(errors.UniqueViolation):
        partner(conn, s, position=2)
    partner(conn, s, tier_agent_id=2)  # another seat may reuse both
    partner(conn, s, position=2, name="Mock Partner Two")


def test_defaults(conn, s):
    partner(conn, s)
    referral(conn, s)
    assert conn.execute(f"select is_mock from {s}.network_partners").fetchone() == {"is_mock": True}
    assert conn.execute(f"select is_mock from {s}.network_referrals").fetchone() == {"is_mock": True}


# --- refused partner rows ----------------------------------------------------------------------------

@pytest.mark.parametrize("over, error", [
    ({"role": "Realtor"}, errors.CheckViolation),
    ({"role": None}, errors.NotNullViolation),
    ({"state": "gone"}, errors.CheckViolation),
    ({"state": "Promoted"}, errors.CheckViolation),
    ({"state": None}, errors.NotNullViolation),
    ({"trust_tier": "verified"}, errors.CheckViolation),
    ({"trust_tier": None}, errors.NotNullViolation),
    ({"source": None}, errors.NotNullViolation),
    ({"source": ""}, errors.CheckViolation),
    ({"source": "x" * 61}, errors.StringDataRightTruncation),
    ({"name": ""}, errors.CheckViolation),
    ({"name": "   "}, errors.CheckViolation),
    ({"name": None}, errors.NotNullViolation),
    ({"name": "x" * 81}, errors.StringDataRightTruncation),
    ({"company": ""}, errors.CheckViolation),
    ({"company": None}, errors.NotNullViolation),
    ({"position": 0}, errors.CheckViolation),
    ({"position": -1}, errors.CheckViolation),
    ({"position": None}, errors.NotNullViolation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
    ({"tier_agent_id": None}, errors.NotNullViolation),
    # a reason exists only in the way the state allows
    ({"state": "promoted", "reason_kind": "asked"}, errors.CheckViolation),
    ({"state": "promoted", "reason_kind": "saved", "reason_on": "2026-10-12"}, errors.CheckViolation),
    ({"state": "request", "reason_kind": None}, errors.CheckViolation),
    ({"state": "request", "reason_kind": "zillow", "reason_count": 2}, errors.CheckViolation),
    ({"state": "request", "reason_kind": "saved", "reason_on": "2026-10-12"}, errors.CheckViolation),
    ({"state": "suggested", "reason_kind": None}, errors.CheckViolation),
    ({"state": "suggested", "reason_kind": "asked"}, errors.CheckViolation),
    ({"state": "suggested", "reason_kind": "saved", "reason_on": "2026-10-12"}, errors.CheckViolation),
    ({"state": "saved", "reason_kind": None}, errors.CheckViolation),
    ({"state": "saved", "reason_kind": "asked"}, errors.CheckViolation),
    ({"state": "saved", "reason_kind": "zillow", "reason_count": 2}, errors.CheckViolation),
    ({"reason_kind": "email"}, errors.CheckViolation),
    # the count is set exactly for zillow and closings, and is at least 1
    ({"state": "suggested", "reason_kind": "zillow", "reason_count": None}, errors.CheckViolation),
    ({"state": "suggested", "reason_kind": "closings", "reason_count": None}, errors.CheckViolation),
    ({"state": "suggested", "reason_kind": "zillow", "reason_count": 0}, errors.CheckViolation),
    ({"state": "suggested", "reason_kind": "closings", "reason_count": -2}, errors.CheckViolation),
    ({"reason_count": 3}, errors.CheckViolation),
    ({"state": "request", "reason_kind": "asked", "reason_count": 1}, errors.CheckViolation),
    ({"state": "saved", "reason_kind": "saved", "reason_on": "2026-10-12", "reason_count": 1}, errors.CheckViolation),
    # the date is set exactly for saved
    ({"state": "saved", "reason_kind": "saved", "reason_on": None}, errors.CheckViolation),
    ({"state": "request", "reason_kind": "asked", "reason_on": "2026-10-12"}, errors.CheckViolation),
    ({"state": "suggested", "reason_kind": "zillow", "reason_count": 2, "reason_on": "2026-10-12"}, errors.CheckViolation),
    ({"reason_on": "2026-10-12"}, errors.CheckViolation),
])
def test_a_bad_partner_is_refused(conn, s, over, error):
    with pytest.raises(error):
        partner(conn, s, **over)


# --- referral rows -----------------------------------------------------------------------------------

@pytest.mark.parametrize("list_key, status", [(lst, st) for lst, sts in LISTS.items() for st in sts])
def test_every_list_accepts_each_of_its_own_statuses(conn, s, list_key, status):
    pid = partner(conn, s) if list_key == "given" else None
    referral(conn, s, list_key=list_key, status=status, partner_id=pid)


def test_a_received_referral_may_name_a_partner_or_not(conn, s):
    pid = partner(conn, s)
    referral(conn, s, partner_id=pid)
    referral(conn, s, position=2, name="Another Person", partner_id=None)


def test_one_position_per_seat_and_list(conn, s):
    referral(conn, s)
    with pytest.raises(errors.UniqueViolation):
        referral(conn, s, name="Another Person")
    referral(conn, s, list_key="requested", status="waiting")  # another list may reuse the position
    referral(conn, s, tier_agent_id=2)  # another seat may too


@pytest.mark.parametrize("over, error", [
    ({"list_key": "sent"}, errors.CheckViolation),
    ({"list_key": None}, errors.NotNullViolation),
    ({"status": "nudged"}, errors.CheckViolation),
    ({"status": "Closed"}, errors.CheckViolation),
    ({"status": None}, errors.NotNullViolation),
    ({"trust_tier": "verified"}, errors.CheckViolation),
    ({"source": None}, errors.NotNullViolation),
    ({"source": ""}, errors.CheckViolation),
    ({"name": ""}, errors.CheckViolation),
    ({"name": "   "}, errors.CheckViolation),
    ({"name": None}, errors.NotNullViolation),
    ({"name": "x" * 81}, errors.StringDataRightTruncation),
    ({"detail": ""}, errors.CheckViolation),
    ({"detail": None}, errors.NotNullViolation),
    ({"detail": "x" * 81}, errors.StringDataRightTruncation),
    ({"occurred_on": None}, errors.NotNullViolation),
    ({"position": 0}, errors.CheckViolation),
    ({"tier_agent_id": 99}, errors.ForeignKeyViolation),
    ({"partner_id": 99999}, errors.ForeignKeyViolation),
    # a list allows only its own statuses
    ({"list_key": "received", "status": "waiting"}, errors.CheckViolation),
    ({"list_key": "received", "status": "thanked"}, errors.CheckViolation),
    ({"list_key": "requested", "status": "new"}, errors.CheckViolation),
    ({"list_key": "requested", "status": "done"}, errors.CheckViolation),
    ({"list_key": "requested", "status": "closed"}, errors.CheckViolation),
])
def test_a_bad_referral_is_refused(conn, s, over, error):
    with pytest.raises(error):
        referral(conn, s, **over)


@pytest.mark.parametrize("status", ["new", "followed", "closed", "waiting", "replied"])
def test_a_given_referral_refuses_the_statuses_of_the_other_lists(conn, s, status):
    with pytest.raises(errors.CheckViolation):
        referral(conn, s, list_key="given", status=status, partner_id=partner(conn, s))


def test_a_given_referral_needs_a_partner_and_a_requested_one_has_none(conn, s):
    with pytest.raises(errors.CheckViolation):
        referral(conn, s, list_key="given", status="done", partner_id=None)
    with pytest.raises(errors.CheckViolation):
        referral(conn, s, list_key="requested", status="waiting", partner_id=partner(conn, s))


def test_a_referral_can_only_point_to_a_partner_of_its_own_seat(conn, s):
    other = partner(conn, s, tier_agent_id=2)
    with pytest.raises(errors.ForeignKeyViolation):
        referral(conn, s, tier_agent_id=1, list_key="given", status="done", partner_id=other)
    with pytest.raises(errors.ForeignKeyViolation):
        referral(conn, s, tier_agent_id=1, partner_id=other)
    referral(conn, s, tier_agent_id=2, list_key="given", status="done", partner_id=other)


def test_a_partner_with_referrals_cannot_be_deleted_first(conn, s):
    pid = partner(conn, s)
    referral(conn, s, list_key="given", status="done", partner_id=pid)
    with pytest.raises(errors.ForeignKeyViolation):
        conn.execute(f"delete from {s}.network_partners where id = %s", (pid,))
    conn.execute(f"delete from {s}.network_referrals")
    conn.execute(f"delete from {s}.network_partners where id = %s", (pid,))
