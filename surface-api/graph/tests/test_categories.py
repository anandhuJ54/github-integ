"""graph /categories endpoints (no live DB/auth): the SQL each one sends, the PostgREST-shaped
answers, and the writes as the page sent them. No write reaches a database here."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.graph.routers.categories_data import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
RID = "11111111-1111-4111-8111-111111111111"
P = "/graph/categories"


class Cur:
    def __init__(self, rows):
        self.rows = rows or []

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write
        self.commits = 0

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

    def commit(self):
        self.commits += 1
        self.log.append((self.write, "COMMIT", {}))

    def execute(self, sql, params=None):
        self.log.append((self.write, sql, params or {}))
        rows = [] if "savepoint" in sql else self.answer(sql, params or {})
        if isinstance(rows, Exception):
            raise rows
        return Cur(rows)

    def cursor(self):
        conn = self

        class C(Cur):
            def __init__(self):
                super().__init__([])

            def execute(self, sql, params=None):
                self.rows = conn.execute(sql, params).rows

        return C()


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


def sqls(log, needle):
    return [x for x in log if needle in x[1]]


def rls_error(table: str) -> psycopg.Error:
    return psycopg.errors.InsufficientPrivilege(
        f'new row violates row-level security policy for table "{table}"')


@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/stats"), ("get", f"{P}/detail?gcid=gcid:x"), ("post", f"{P}/taxonomy"),
    ("delete", f"{P}/node-registry/{RID}"), ("patch", f"{P}/category"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "patch") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


# --- categories index ------------------------------------------------------------------------

def test_stats_counts_in_one_statement(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"total": 4041, "active": 10, "excluded": 3, "launched": None}]
    r = client().get(f"{P}/stats").json()
    assert r == {"total": 4041, "active": 10, "excluded": 3, "launched": 0}
    (_, sql, _), = sqls(log, "gbp_categories")
    assert "count(*) FILTER (WHERE public.gbp_categories.status = " in sql
    assert "is_launched IS true" in sql


def test_list_search_sort_and_limit(dbfake):
    log, _ = dbfake
    client().get(f"{P}/list", params={"search": " real*estate (x) ", "sort": "estimated_profiles",
                                      "asc": "false"})
    (_, sql, params), = sqls(log, "gbp_categories")
    assert "SELECT public.gbp_categories.gcid, public.gbp_categories.display_name" in sql
    assert "display_name ILIKE" in sql and "gcid ILIKE" in sql and " OR " in sql
    assert "ORDER BY public.gbp_categories.estimated_profiles DESC NULLS LAST" in sql
    assert "%real%estate x%" in params.values()  # `,%()` stripped, `*` → `%` as PostgREST did
    assert 500 in params.values()


def test_list_ascending_without_search(dbfake):
    log, _ = dbfake
    client().get(f"{P}/list", params={"sort": "gcid"})
    (_, sql, _), = sqls(log, "gbp_categories")
    assert "ILIKE" not in sql and "ORDER BY public.gbp_categories.gcid ASC NULLS LAST" in sql


def test_list_sort_key_is_allow_listed(dbfake):
    log, _ = dbfake
    assert client().get(f"{P}/list", params={"sort": "gcid; drop table x"}).status_code == 422
    assert client().get(f"{P}/list", params={"sort": "slug"}).status_code == 422
    assert log == []


@pytest.mark.parametrize("view,cols", [
    ("tree", "status, public.gbp_categories.estimated_profiles"),
    ("detail", "entity_type, public.gbp_categories.estimated_profiles"),
])
def test_children_columns_per_view(dbfake, view, cols):
    log, _ = dbfake
    client().post(f"{P}/children", json={"gcids": ["gcid:a", "gcid:b"], "view": view})
    (_, sql, params), = sqls(log, "gbp_categories")
    assert cols in sql and "IN (" in sql and "ORDER BY public.gbp_categories.display_name ASC" in sql
    assert {"gcid:a", "gcid:b"} <= set(params.values())


# --- detail ----------------------------------------------------------------------------------

def test_detail_reads_and_shapes(dbfake):
    log, state = dbfake

    def answer(s, p):
        if "FROM public.gbp_categories" in s:
            return [{"gcid": "gcid:x", "display_name": "X"}]
        if "exp_category_compliance" in s:
            return [{"gcid": "gcid:x"}]
        if "exp_validate_category_full" in s:
            return [{"check_code": "c", "passed": True, "detail": "ok"}]
        if "exp_category_knowledge" in s:
            return [{"gcid": "gcid:x", "entity_type": "location"}, {"gcid": "gcid:x"}]
        return []
    state["answer"] = answer
    r = client().get(f"{P}/detail", params={"gcid": "gcid:x"}).json()
    assert r["category"] == {"gcid": "gcid:x", "display_name": "X"}
    assert r["compliance"] == {"gcid": "gcid:x"}
    assert len(r["knowledge"]) == 2
    assert r["groups"] is None  # the page's embed had no relationship: PostgREST errored
    assert r["validation"] == [{"check_code": "c", "passed": True, "detail": "ok"}]
    (_, sql, params), = sqls(log, "exp_validate_category_full")
    assert "FROM public.exp_validate_category_full(" in sql and "gcid:x" in params.values()
    (_, sql, _), = sqls(log, "exp_category_directories")
    assert "ORDER BY public.exp_category_directories.priority ASC" in sql
    (_, sql, _), = sqls(log, "exp_category_secondaries")
    assert "primary_gcid = " in sql and "ORDER BY public.exp_category_secondaries.relevance ASC" in sql
    (_, sql, params), = sqls(log, "FROM public.exp_taxonomy")
    assert 1 in params.values()
    assert not sqls(log, "exp_category_group")


def test_detail_failed_side_read_is_null_but_category_error_is_raised(dbfake):
    _, state = dbfake

    def answer(s, p):
        if "exp_category_ui_config" in s:
            return psycopg.errors.UndefinedColumn("boom")
        return [{"gcid": "gcid:x"}] if "FROM public.gbp_categories" in s else []
    state["answer"] = answer
    r = client().get(f"{P}/detail", params={"gcid": "gcid:x"}).json()
    assert r["uiConfigs"] is None and r["knowledge"] == [] and r["category"] == {"gcid": "gcid:x"}

    state["answer"] = lambda s, p: (psycopg.errors.InsufficientPrivilege("permission denied")
                                    if "FROM public.gbp_categories" in s else [])
    assert client().get(f"{P}/detail", params={"gcid": "gcid:x"}).status_code == 403


# --- maybeSingle -----------------------------------------------------------------------------

def test_maybe_single_thrown_vs_ignored(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"ai_agents": {}}, {"ai_agents": None}] \
        if "exp_category_knowledge" in s else []
    r = client().get(f"{P}/ai-config/knowledge", params={"gcid": "gcid:x"})
    assert r.status_code == 406 and "multiple (or no) rows" in r.json()["detail"]
    state["answer"] = lambda s, p: [{"entity_type": "a"}, {"entity_type": "b"}]
    assert client().get(f"{P}/entity-type", params={"gcid": "gcid:x"}).json() is None
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/compliance", params={"gcid": "gcid:x"}).json() is None


def test_scoring_one_of_each(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"ear": 1, "band": "b"}] if "exp_category_ear" in s else []
    r = client().get(f"{P}/scoring", params={"gcid": "gcid:x"}).json()
    assert r == {"ear": {"ear": 1, "band": "b"}, "eaa": None, "completeness": None, "eaq": None,
                 "eav": None, "category": None}


def test_listings_failed_read_is_null(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.UndefinedTable("x") \
        if "exp_listings_overlays" in s else [{"family": "f", "present": True}] \
        if "exp_listings_category_status" in s else []
    r = client().get(f"{P}/listings", params={"gcid": "gcid:x"}).json()
    assert r == {"overlays": None, "crosswalk": [], "status": [{"family": "f", "present": True}]}


def test_catalog_filters_version(dbfake):
    log, _ = dbfake
    client().get(f"{P}/listings/catalog", params={"catalog_version": "v1"})
    (_, sql, params), = sqls(log, "exp_listings_field_map")
    assert "catalog_version = " in sql and "v1" in params.values()


def test_node_registry_order_and_cap(dbfake):
    log, _ = dbfake
    client().get(f"{P}/node-registry", params={"gcid": "gcid:x"})
    (_, sql, params), = log
    assert "ORDER BY public.exp_vertical_node_registry.priority ASC" in sql
    assert 1000 in params.values()


def test_schema_registry_active_only(dbfake):
    log, _ = dbfake
    client().get(f"{P}/schema/registry", params={"gcid": "gcid:x"})
    (_, sql, _), = log
    assert "is_active IS true" in sql


# --- writes (SQL only) -----------------------------------------------------------------------

def test_category_update_only_sent_keys(dbfake):
    log, _ = dbfake
    assert client().patch(f"{P}/category", json={"gcid": "gcid:x", "status": "active"}) \
        .json() == {"ok": True}
    (write, sql, params), = log
    assert write
    assert sql.startswith("UPDATE public.gbp_categories SET status=")
    assert "supports_single_pro_office" not in sql and "WHERE public.gbp_categories.gcid = " in sql
    assert set(params.values()) == {"active", "gcid:x"}


def test_write_column_allow_list(dbfake):
    log, _ = dbfake
    c = client()
    assert c.patch(f"{P}/category", json={"gcid": "g", "display_name": "x"}).status_code == 422
    assert c.post(f"{P}/taxonomy", json={"gcid": "g", "evidence": {}}).status_code == 422
    assert c.patch(f"{P}/node-registry/{RID}", json={"gcid": "g"}).status_code == 422
    assert log == []


def test_rule_insert_refused_by_rls_is_403_with_the_message(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: rls_error("content_compliance_rules") \
        if s.startswith("INSERT INTO public.content_compliance_rules") else []
    r = client().post(f"{P}/compliance-rules", json={
        "gcid": "gcid:x", "rule_name": "n", "rule_type": "prohibited_phrase", "rule_value": None,
        "applies_to": ["profile"], "severity": "warn", "is_active": True})
    assert r.status_code == 403
    assert r.json()["detail"] == \
        'new row violates row-level security policy for table "content_compliance_rules"'
    (_, sql, params), = sqls(log, "INSERT INTO public.content_compliance_rules")
    assert "RETURNING" not in sql  # PostgREST's return=minimal
    assert params["applies_to"] == ["profile"] and params["rule_value"] is None
    assert not sqls(log, "audit_log")  # the page threw before the audit insert


def test_rule_update_audits_with_the_rule_id(dbfake):
    log, _ = dbfake
    client().patch(f"{P}/compliance-rules/{RID}", json={"rule_name": "n", "is_active": False})
    (_, sql, params), = sqls(log, "UPDATE public.content_compliance_rules")
    assert "WHERE public.content_compliance_rules.id = " in sql and RID in params.values()
    (_, sql, params), = sqls(log, "INSERT INTO public.audit_log")
    assert params == {"action": "compliance_rule.update",
                      "entity_type": "content_compliance_rules", "entity_id": RID}


def test_rule_toggle_and_delete(dbfake):
    log, _ = dbfake
    client().patch(f"{P}/compliance-rules/{RID}/active", json={"is_active": False})
    client().delete(f"{P}/compliance-rules/{RID}")
    assert [x[1].split(" ")[0] for x in log] == ["UPDATE", "DELETE"]
    assert log[0][2]["is_active"] is False
    assert not sqls(log, "audit_log")


def test_audit_error_is_ignored(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InvalidTextRepresentation("bad uuid") \
        if "audit_log" in s else []
    r = client().post(f"{P}/ai-config", json={"gcid": "gcid:x", "ai_agents": {"sdr_tone": "x"}})
    assert r.json() == {"ok": True}
    (_, sql, params), = sqls(log, "UPDATE public.exp_category_knowledge")
    assert "ai_agents=" in sql and params["ai_agents"].obj == {"sdr_tone": "x"}
    (_, _, params), = sqls(log, "INSERT INTO public.audit_log")
    assert params["entity_id"] == "gcid:x"


def test_taxonomy_audits_with_metadata_are_not_sent(dbfake):
    log, _ = dbfake
    c = client()
    c.post(f"{P}/taxonomy", json={"gcid": "gcid:x", "level": "alias", "term": "t",
                                  "priority": 5, "search_volume_monthly": None})
    c.patch(f"{P}/taxonomy/{RID}", json={"term": "t2"})
    c.post(f"{P}/taxonomy/reorder", json={"gcid": "gcid:x",
                                          "updates": [{"id": RID, "priority": 1}]})
    assert not sqls(log, "audit_log")  # PostgREST rejected them (no metadata column)
    (_, sql, params), = sqls(log, "INSERT INTO public.exp_taxonomy")
    assert "RETURNING" not in sql and params["search_volume_monthly"] is None
    c.delete(f"{P}/taxonomy/{RID}")
    (_, _, params), = sqls(log, "INSERT INTO public.audit_log")
    assert params == {"action": "taxonomy.delete", "entity_type": "exp_taxonomy",
                      "entity_id": RID}


def test_node_insert_and_update(dbfake):
    log, _ = dbfake
    form = {"node_name": "N", "node_slug": "n", "node_description": None, "ring": "identity",
            "connection_method": "manual", "schema_type": None, "schema_property": None,
            "required_for_score": False, "score_points": 0, "priority": 3, "url_pattern": None,
            "url_example": None, "compliance_notes": None, "is_active": True, "notes": None}
    client().post(f"{P}/node-registry", json={"gcid": "gcid:x", **form})
    client().patch(f"{P}/node-registry/{RID}", json=form)
    (_, ins, ip), (_, upd, up) = log
    assert ins.startswith("INSERT INTO public.exp_vertical_node_registry (gcid, node_name")
    assert "RETURNING" not in ins and ip["gcid"] == "gcid:x"
    assert upd.startswith("UPDATE public.exp_vertical_node_registry SET node_name=")
    assert "gcid=" not in upd.split("WHERE")[0] and RID in up.values()


def test_reorder_keeps_the_updates_before_a_failure(dbfake):
    log, state = dbfake
    second = "22222222-2222-4222-8222-222222222222"
    state["answer"] = lambda s, p: psycopg.errors.CheckViolation("bad") if second in p.values() \
        else []
    r = client().post(f"{P}/node-registry/reorder", json={"updates": [
        {"id": RID, "priority": 1}, {"id": second, "priority": 2},
        {"id": "33333333-3333-4333-8333-333333333333", "priority": 3}]})
    assert r.status_code == 400
    kinds = [x[1].split(" ")[0] for x in log]
    assert kinds == ["UPDATE", "UPDATE", "COMMIT"]  # the first stays written, the third never ran
