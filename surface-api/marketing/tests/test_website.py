"""marketing /website endpoints (moved from xmp, surface audit 2026-10-25)
(no live DB/auth): the SQL each one sends, the PostgREST-shaped
answers, and the writes as the page sent them. No write reaches a database here."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from _base.auth import current_user
from _base.db import session as core_db
from surfaces.marketing.queries import website as q
from surfaces.marketing.routers.website_data import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
RID = "11111111-1111-4111-8111-111111111111"
RID2 = "22222222-2222-4222-8222-222222222222"
P = "/marketing/website"


class Cur:
    def __init__(self, rows, description=True):
        self.rows = rows or []
        self.description = description

    def fetchall(self):
        return self.rows

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, log, answer, write):
        self.log, self.answer, self.write = log, answer, write

    @contextmanager
    def pipeline(self):
        yield

    @contextmanager
    def transaction(self):
        yield

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
                super().__init__([], None)

            def execute(self, sql, params=None):
                self.rows = conn.execute(sql, params).rows
                # a write without RETURNING has no result set (psycopg: description None)
                self.description = None if sql.startswith(("UPDATE", "INSERT", "DELETE")) \
                    and "RETURNING" not in sql else True

            def fetchall(self):
                if self.description is None:
                    raise AssertionError("fetchall on a statement with no result set")
                return self.rows

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


def writes(log):
    return [x for x in log if x[1].startswith(("UPDATE", "INSERT", "DELETE"))]


def rls_error(table: str) -> psycopg.Error:
    return psycopg.errors.InsufficientPrivilege(
        f'new row violates row-level security policy for table "{table}"')


def unwrap(v):
    return v.obj if isinstance(v, Jsonb) else v


def values(params):
    return {k: unwrap(v) for k, v in params.items()}


# --- auth --------------------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [
    ("get", f"{P}/pages"), ("get", f"{P}/templates"), ("get", f"{P}/consent"),
    ("get", f"{P}/sellers"), ("post", f"{P}/pages"), ("patch", f"{P}/pages/{RID}"),
    ("delete", f"{P}/pages/{RID}"), ("post", f"{P}/templates"), ("patch", f"{P}/consent"),
    ("post", f"{P}/pages/bulk-publish"), ("delete", f"{P}/media/{RID}"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    kw = {"json": {}} if method in ("post", "patch", "put") else {}
    assert getattr(TestClient(app), method)(path, **kw).status_code == 403


# --- loaders -------------------------------------------------------------------------------------

@pytest.mark.parametrize("path,table,where,order,limit", [
    ("pages", "exp_web_pages", "exp_web_pages.deleted_at IS NULL",
     "exp_web_pages.updated_at DESC", 500),
    ("pages/trash", "exp_web_pages", "exp_web_pages.deleted_at IS NOT NULL",
     "exp_web_pages.deleted_at DESC", 500),
    ("templates", "exp_web_page_templates", "exp_web_page_templates.deleted_at IS NULL",
     "exp_web_page_templates.updated_at DESC", 1000),
    ("templates/trash", "exp_web_page_templates",
     "exp_web_page_templates.deleted_at IS NOT NULL",
     "exp_web_page_templates.deleted_at DESC", 1000),
    ("forms", "exp_web_forms", None, "exp_web_forms.created_at DESC", 1000),
    ("leads", "exp_web_leads", None, "exp_web_leads.created_at DESC", 1000),
    ("trust", "exp_web_trust_items", None, "exp_web_trust_items.sort_order ASC", 1000),
    ("alerts", "exp_web_alerts", None, "exp_web_alerts.created_at DESC", 1000),
    ("ads", "exp_web_ads", None, "exp_web_ads.created_at DESC", 1000),
    ("campaigns", "exp_web_campaigns", None, "exp_web_campaigns.created_at DESC", 1000),
    ("media", "exp_web_media", None, "exp_web_media.created_at DESC", 1000),
    ("sellers", "exp_sales_reps", None, "exp_sales_reps.name ASC", 500),
])
def test_loader_sql(dbfake, path, table, where, order, limit):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": RID}]
    assert client().get(f"{P}/{path}").json() == [{"id": RID}]
    (write, sql, params), = sqls(log, f"FROM public.{table}")
    assert write is False
    assert f"ORDER BY public.{order}" in sql
    if where:
        assert f"WHERE public.{where}" in sql
    else:
        assert "WHERE" not in sql
    assert limit in params.values()
    if path == "sellers":
        assert sql.startswith("SELECT public.exp_sales_reps.id, public.exp_sales_reps.name, "
                              "public.exp_sales_reps.role \nFROM")
    else:
        assert f"public.{table}.created_at" in sql or table == "exp_web_trust_items"


def test_loader_rows_are_postgrest_shaped(dbfake):
    import datetime as dt
    import decimal
    import uuid
    _, state = dbfake
    state["answer"] = lambda s, p: [{
        "id": uuid.UUID(RID), "budget": decimal.Decimal(250), "spend": decimal.Decimal("1.5"),
        "starts_on": dt.date(2026, 1, 2),
        "created_at": dt.datetime(2026, 1, 2, 3, 4, 5, 280300, tzinfo=dt.UTC),
    }]
    assert client().get(f"{P}/ads").json() == [{
        "id": RID, "budget": 250, "spend": 1.5, "starts_on": "2026-01-02",
        "created_at": "2026-01-02T03:04:05.2803+00:00",
    }]


def test_loaders_that_ignored_errors_answer_empty(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: rls_error("exp_web_pages") if "FROM" in s else []
    for path in ("pages", "pages/trash", "templates/trash", "forms", "leads", "trust",
                 "alerts", "ads", "campaigns", "media", "sellers"):
        r = client().get(f"{P}/{path}")
        assert r.status_code == 200 and r.json() == [], path


def test_page_templates_throws_its_error(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        "permission denied for table exp_web_page_templates")
    r = client().get(f"{P}/templates")
    assert r.status_code == 403
    assert r.json()["detail"] == "permission denied for table exp_web_page_templates"


def test_consent_reads_both_in_one_batch(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": "default", "banner_enabled": True}] \
        if "consent_config" in s else [{"id": RID}]
    assert client().get(f"{P}/consent").json() == {
        "events": [{"id": RID}], "config": {"id": "default", "banner_enabled": True}}
    (_, ev, evp), = sqls(log, "FROM public.exp_web_consent_events")
    assert "ORDER BY public.exp_web_consent_events.created_at DESC" in ev and 1000 in evp.values()
    (_, cfg, cfgp), = sqls(log, "FROM public.exp_web_consent_config")
    assert "WHERE public.exp_web_consent_config.id = " in cfg and "default" in cfgp.values()


def test_consent_errors_ignored(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: rls_error("x") if "FROM" in s else []
    assert client().get(f"{P}/consent").json() == {"events": [], "config": None}


# --- CMS page writes -------------------------------------------------------------------------

def test_create_page(dbfake):
    log, _ = dbfake
    r = client().post(f"{P}/pages", json={"title": "About", "slug": "about", "page_type": "page"})
    assert r.json() == {"ok": True}
    (write, sql, params), = writes(log)
    assert write is True
    assert sql.startswith("INSERT INTO public.exp_web_pages (slug, title, page_type, status, "
                          "body, updated_by) VALUES")
    assert "RETURNING" not in sql
    assert values(params) == {"title": "About", "slug": "about", "page_type": "page",
                              "status": "draft", "body": {}, "updated_by": None}
    assert isinstance(params["body"], Jsonb)


def test_create_page_refuses_other_columns(dbfake):
    log, _ = dbfake
    r = client().post(f"{P}/pages", json={"title": "a", "slug": "a", "page_type": "page",
                                          "status": "published"})
    assert r.status_code == 422 and writes(log) == []


def test_update_page_writes_only_sent_keys_plus_updated_at(dbfake):
    log, _ = dbfake
    body = [{"type": "hero", "props": {"title": "x"}}]
    client().patch(f"{P}/pages/{RID}", json={"title": "T", "body": body, "seo_desc": None})
    (write, sql, params), = writes(log)
    assert write is True
    assert sql.startswith("UPDATE public.exp_web_pages SET title=")
    assert "WHERE public.exp_web_pages.id = " in sql and "RETURNING" not in sql
    v = values(params)
    assert v.pop("updated_at") is not None
    assert v == {"title": "T", "body": body, "seo_desc": None, "id_1": RID}
    assert isinstance(params["body"], Jsonb)  # a list stays JSON, not a Postgres array


def test_update_page_json_null_body_is_sql_null(dbfake):
    log, _ = dbfake
    client().patch(f"{P}/pages/{RID}", json={"body": None})
    (_, _, params), = writes(log)
    assert params["body"] is None


def test_update_page_refuses_status(dbfake):
    log, _ = dbfake
    assert client().patch(f"{P}/pages/{RID}", json={"status": "published"}).status_code == 422
    assert writes(log) == []


def test_publish_unpublish_trash_restore_purge(dbfake):
    log, _ = dbfake
    c = client()
    c.post(f"{P}/pages/{RID}/publish", json={"updated_by": "a@b.c"})
    c.post(f"{P}/pages/{RID}/unpublish")
    c.post(f"{P}/pages/{RID}/trash", json={})
    c.post(f"{P}/pages/{RID}/restore")
    c.delete(f"{P}/pages/{RID}")
    pub, unpub, trash, restore, purge = writes(log)
    v = values(pub[2])
    assert v["status"] == "published" and v["updated_by"] == "a@b.c"
    assert v["published_at"] == v["updated_at"] and v["id_1"] == RID
    assert "status=" in unpub[1] and "updated_at=" in unpub[1] and unpub[2]["status"] == "draft"
    assert "published_at" not in unpub[1]
    v = values(trash[2])
    assert v["deleted_by"] is None and v["deleted_at"] is not None
    assert "status" not in trash[1] and "updated_at" not in trash[1]
    assert values(restore[2]) == {"deleted_at": None, "deleted_by": None, "status": "draft",
                                  "id_1": RID}
    assert purge[1].startswith("DELETE FROM public.exp_web_pages WHERE public.exp_web_pages.id = ")
    assert all(w for w, _, _ in (pub, unpub, trash, restore, purge))


def test_set_page_template(dbfake):
    log, _ = dbfake
    client().put(f"{P}/pages/{RID}/template", json={"template_id": None})
    (_, sql, params), = writes(log)
    assert sql.startswith("UPDATE public.exp_web_pages SET template_id=")
    assert "updated_at" not in sql and values(params) == {"template_id": None, "id_1": RID}


def test_bulk_actions_filter_by_ids(dbfake):
    log, _ = dbfake
    c = client()
    c.post(f"{P}/pages/bulk-publish", json={"ids": [RID, RID2], "updated_by": "e"})
    c.post(f"{P}/pages/bulk-unpublish", json={"ids": [RID]})
    c.post(f"{P}/pages/bulk-trash", json={"ids": [RID], "deleted_by": "e"})
    pub, unpub, trash = writes(log)
    assert "WHERE public.exp_web_pages.id IN (" in pub[1]
    assert RID in pub[2].values() and RID2 in pub[2].values()
    assert pub[2]["status"] == "published" and pub[2]["updated_by"] == "e"
    assert unpub[2]["status"] == "draft"
    assert trash[2]["deleted_by"] == "e" and "status" not in trash[1]


def test_bulk_with_no_ids_matches_nothing(dbfake):
    log, _ = dbfake
    client().post(f"{P}/pages/bulk-unpublish", json={"ids": []})
    (_, sql, _), = writes(log)
    assert "1 != 1" in sql


def test_duplicate_page_picks_a_free_slug_of_the_same_type(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"slug": "about-copy"}, {"slug": "about-copy-2"}] \
        if s.startswith("SELECT") else []
    r = client().post(f"{P}/pages/duplicate", json={
        "slug_base": "about-copy", "title": "About (copy)", "page_type": "page",
        "body": {"markdown": "x"}, "seo_title": None, "seo_desc": "d", "updated_by": "e"})
    assert r.json() == {"ok": True}
    (_, sel, sp), = sqls(log, "SELECT public.exp_web_pages.slug")
    assert "slug LIKE " in sel and "page_type = " in sel
    assert "about-copy%" in sp.values() and "page" in sp.values()
    (write, sql, params), = writes(log)
    assert write is True and "RETURNING" not in sql
    assert values(params) == {"title": "About (copy)", "slug": "about-copy-3", "page_type": "page",
                              "status": "draft", "body": {"markdown": "x"}, "seo_title": None,
                              "seo_desc": "d", "updated_by": "e"}  # no design_tag: not sent


def test_duplicate_page_ignores_a_failed_slug_read(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: rls_error("exp_web_pages") if s.startswith("SELECT") else []
    client().post(f"{P}/pages/duplicate", json={
        "slug_base": "x-copy", "title": "x (copy)", "page_type": "page", "design_tag": "new"})
    (_, _, params), = writes(log)
    assert params["slug"] == "x-copy" and params["design_tag"] == "new"
    assert params["body"] is None and params["updated_by"] is None


def test_page_from_template_returns_the_row(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"slug": "launch"}] if s.startswith("SELECT") \
        else [{"id": RID, "slug": "launch-2"}]
    r = client().post(f"{P}/pages/from-template", json={
        "slug_base": "launch", "title": "Launch", "page_type": "landing",
        "body": [{"type": "hero"}], "seo_title": "S", "seo_desc": None,
        "design_tag": "new", "updated_by": "e"})
    assert r.json() == {"id": RID, "slug": "launch-2"}
    (_, sel, _), = sqls(log, "SELECT public.exp_web_pages.slug")
    assert "page_type" not in sel  # this flow's slug read has no type filter
    (write, sql, params), = writes(log)
    assert write is True and "RETURNING public.exp_web_pages.id, " in sql
    assert values(params) == {"title": "Launch", "slug": "launch-2", "page_type": "landing",
                              "status": "draft", "body": [{"type": "hero"}], "seo_title": "S",
                              "seo_desc": None, "design_tag": "new", "updated_by": "e"}


def test_write_refused_by_rls_is_403_with_the_message(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: rls_error("exp_web_pages") if s.startswith("INSERT") else []
    r = client().post(f"{P}/pages", json={"title": "a", "slug": "a", "page_type": "page"})
    assert r.status_code == 403
    assert r.json()["detail"] == 'new row violates row-level security policy for table "exp_web_pages"'


def test_other_db_error_is_400_with_the_message(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: psycopg.errors.UniqueViolation(
        'duplicate key value violates unique constraint "exp_web_pages_slug_key"')
    r = client().post(f"{P}/pages", json={"title": "a", "slug": "a", "page_type": "page"})
    assert r.status_code == 400 and "exp_web_pages_slug_key" in r.json()["detail"]


# --- templates -------------------------------------------------------------------------------

def test_create_template_inserts_sent_keys_returning_row(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": RID, "name": "T"}]
    r = client().post(f"{P}/templates", json={
        "name": "T", "template_kind": "section", "source_page_id": RID2,
        "source_page_title": "Home", "body": [{"type": "hero"}], "page_settings": {"seo_title": "x"},
        "section_indexes": [0, 2], "design_tag": "new", "created_by": CLAIMS["sub"]})
    assert r.json() == {"id": RID, "name": "T"}
    (write, sql, params), = writes(log)
    assert write is True and sql.startswith("INSERT INTO public.exp_web_page_templates")
    assert "RETURNING public.exp_web_page_templates.id, " in sql
    assert "created_by_label" not in sql.split("RETURNING")[0]  # not sent → not written
    assert isinstance(params["body"], Jsonb) and isinstance(params["page_settings"], Jsonb)
    assert params["section_indexes"] == [0, 2]


def test_template_rename_trash_restore_purge(dbfake):
    log, _ = dbfake
    c = client()
    c.patch(f"{P}/templates/{RID}", json={"name": "N"})
    c.post(f"{P}/templates/{RID}/trash", json={"deleted_by": None})
    c.post(f"{P}/templates/{RID}/restore")
    c.delete(f"{P}/templates/{RID}")
    ren, trash, restore, purge = writes(log)
    assert values(ren[2]) == {"name": "N", "id_1": RID}
    assert trash[2]["deleted_at"] is not None and trash[2]["deleted_by"] is None
    assert values(restore[2]) == {"deleted_at": None, "deleted_by": None, "id_1": RID}
    assert "status" not in restore[1]
    assert purge[1].startswith("DELETE FROM public.exp_web_page_templates WHERE")


# --- other tables ----------------------------------------------------------------------------

@pytest.mark.parametrize("path,body,table,expected", [
    ("forms", {"name": "Demo", "slug": "demo", "destination": None, "fields": []},
     "exp_web_forms", {"name": "Demo", "slug": "demo", "destination": None, "fields": [],
                       "active": True}),
    ("trust", {"category": "Security", "title": "SOC2", "body": None, "doc_url": None},
     "exp_web_trust_items", {"category": "Security", "title": "SOC2", "body": None,
                             "doc_url": None}),
    ("alerts", {"alert_type": "info", "message": "Hi"},
     "exp_web_alerts", {"alert_type": "info", "message": "Hi", "active": True}),
    ("ads", {"name": "A", "placement": "hero", "budget": 250, "starts_on": "2026-11-01",
             "ends_on": None, "creative": {}},
     "exp_web_ads", {"name": "A", "placement": "hero", "budget": 250, "starts_on": "2026-11-01",
                     "ends_on": None, "creative": {}, "status": "draft", "spend": 0}),
    ("campaigns", {"name": "C", "cohort": "agents", "channel": "email", "starts_on": None},
     "exp_web_campaigns", {"name": "C", "cohort": "agents", "channel": "email",
                           "starts_on": None, "status": "draft", "assigned_profiles": 0}),
    ("media", {"title": "M", "media_type": "video", "url": "https://x", "gated": True,
               "form_slug": None},
     "exp_web_media", {"title": "M", "media_type": "video", "url": "https://x", "gated": True,
                       "form_slug": None}),
])
def test_creates(dbfake, path, body, table, expected):
    log, _ = dbfake
    assert client().post(f"{P}/{path}", json=body).json() == {"ok": True}
    (write, sql, params), = writes(log)
    assert write is True and sql.startswith(f"INSERT INTO public.{table} ")
    assert "RETURNING" not in sql
    assert values(params) == expected
    assert client().post(f"{P}/{path}", json={**body, "id": RID}).status_code == 422


def test_ad_dates_bind_as_date(dbfake):
    log, _ = dbfake
    client().post(f"{P}/ads", json={"name": "A", "placement": "hero", "starts_on": "2026-11-01"})
    (_, sql, _), = writes(log)
    assert "%(starts_on)s::DATE" in sql


@pytest.mark.parametrize("path,body,table", [
    ("forms", {"active": False}, "exp_web_forms"),
    ("alerts", {"active": False}, "exp_web_alerts"),
    ("ads", {"status": "live"}, "exp_web_ads"),
    ("campaigns", {"status": "live", "assigned_profiles": 12}, "exp_web_campaigns"),
    ("media", {"gated": True}, "exp_web_media"),
])
def test_patches_write_only_sent_keys(dbfake, path, body, table):
    log, _ = dbfake
    client().patch(f"{P}/{path}/{RID}", json=body)
    (write, sql, params), = writes(log)
    assert write is True and sql.startswith(f"UPDATE public.{table} SET")
    assert values(params) == {**body, "id_1": RID}
    assert client().patch(f"{P}/{path}/{RID}", json={"name": "x", "created_at": "x"}).status_code == 422


@pytest.mark.parametrize("path,table", [
    ("forms", "exp_web_forms"), ("trust", "exp_web_trust_items"), ("alerts", "exp_web_alerts"),
    ("ads", "exp_web_ads"), ("campaigns", "exp_web_campaigns"), ("media", "exp_web_media"),
])
def test_deletes(dbfake, path, table):
    log, _ = dbfake
    assert client().delete(f"{P}/{path}/{RID}").json() == {"ok": True}
    (_, sql, params), = writes(log)
    assert sql == f"DELETE FROM public.{table} WHERE public.{table}.id = %(id_1)s::UUID"
    assert params == {"id_1": RID}


def test_trust_patch_stamps_updated_at(dbfake):
    log, _ = dbfake
    client().patch(f"{P}/trust/{RID}", json={"sort_order": 5})
    (_, _, params), = writes(log)
    v = values(params)
    assert v.pop("updated_at") is not None and v == {"sort_order": 5, "id_1": RID}


def test_lead_status_and_assignment(dbfake):
    log, _ = dbfake
    c = client()
    c.patch(f"{P}/leads/{RID}/status", json={"status": "qualified"})
    c.patch(f"{P}/leads/{RID}/assignee", json={"assigned_to": RID2})
    c.patch(f"{P}/leads/{RID}/assignee", json={"assigned_to": None})
    st, assign, unassign = writes(log)
    assert values(st[2]) == {"status": "qualified", "id_1": RID}
    assert assign[2]["assigned_to"] == RID2 and assign[2]["assigned_at"] is not None
    assert values(unassign[2]) == {"assigned_to": None, "assigned_at": None, "id_1": RID}


def test_consent_config_saves_the_default_row(dbfake):
    log, _ = dbfake
    cfg = {"banner_enabled": True, "banner_title": "t", "banner_message": "m",
           "analytics_default": False, "marketing_default": False, "policy_url": None}
    client().patch(f"{P}/consent", json=cfg)
    (write, sql, params), = writes(log)
    assert write is True and "WHERE public.exp_web_consent_config.id = " in sql
    v = values(params)
    assert v.pop("updated_at") is not None and v == {**cfg, "id_1": "default"}


# --- helpers ---------------------------------------------------------------------------------

def test_free_slug_matches_the_page_loop():
    assert q.free_slug(set(), "a") == "a"
    assert q.free_slug({"a", "a-2", "a-3"}, "a") == "a-4"
    assert q.free_slug({"a-2"}, "a") == "a"
    assert q.free_slug({None}, "a") == "a"
