"""xmp /website/nav-menus endpoints (no live DB/auth): the SQL each one sends, the role it runs
as, and the writes as the page sent them. No write reaches a database here."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from _base.core.server_fn import optional_user
from xmp.queries.website_test import FakeConn, values, writes
from xmp.routers.website_data import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}
RID = "11111111-1111-4111-8111-111111111111"
P = "/xmp/website/nav-menus"


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    roles: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        roles.append(role)
        assert (role, claims) in (("authenticated", CLAIMS), ("anon", None))
        yield FakeConn(log, lambda s, p: state["answer"](s, p), write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state, roles


def client(claims: dict | None = CLAIMS) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: claims
    app.dependency_overrides[optional_user] = lambda: claims
    return TestClient(app)


def test_cms_endpoints_need_a_signed_in_user():
    app = FastAPI()
    app.include_router(router)
    c = TestClient(app)
    assert c.get(P).status_code == 403
    assert c.get(f"{P}/trash").status_code == 403
    assert c.post(P, json={"name": "x", "menu_type": "header"}).status_code == 403
    assert c.delete(f"{P}/{RID}").status_code == 403


def test_load_nav_menus_sql(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": RID, "name": "Main"}]
    assert client().get(P).json() == [{"id": RID, "name": "Main"}]
    sql = log[-1][1]
    assert "FROM public.exp_web_nav_menus" in sql
    assert "public.exp_web_nav_menus.deleted_at IS NULL" in sql
    assert "ORDER BY public.exp_web_nav_menus.menu_type ASC, public.exp_web_nav_menus.name ASC" in sql
    assert "LIMIT" in sql and log[-1][2]["param_1"] == 1000
    assert "created_by" not in sql  # the page's column list, not select *


def test_load_deleted_sql(dbfake):
    log, _, _ = dbfake
    client().get(f"{P}/trash")
    sql = log[-1][1]
    assert "deleted_at IS NOT NULL" in sql and "ORDER BY public.exp_web_nav_menus.deleted_at DESC" in sql


def test_assigned_nav_is_anon_when_signed_out(dbfake):
    log, state, roles = dbfake
    state["answer"] = lambda s, p: [{"id": RID, "menu_type": "header", "items": {}}]
    r = client(None).get(f"{P}/assigned")
    assert r.status_code == 200 and r.json()[0]["menu_type"] == "header"
    assert roles == ["anon"]
    sql, params = log[-1][1], log[-1][2]
    assert "assigned_site = %(assigned_site_1)s" in sql and params["assigned_site_1"] == "main_site"
    assert "deleted_at IS NULL" in sql
    client().get(f"{P}/assigned", params={"site": "other"})
    assert roles[-1] == "authenticated" and log[-1][2]["assigned_site_1"] == "other"


def test_get_one_is_single(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: []
    assert client().get(f"{P}/{RID}").status_code == 406
    state["answer"] = lambda s, p: [{"name": "a"}, {"name": "b"}]
    assert client().get(f"{P}/{RID}").status_code == 406
    state["answer"] = lambda s, p: [{"name": "a", "menu_type": "footer", "items": {}, "notes": None}]
    assert client().get(f"{P}/{RID}").json()["name"] == "a"
    assert "LIMIT" in log[-1][1] and log[-1][2]["param_1"] == 2


def test_create_inserts_with_design_tag_new_and_returns_id(dbfake):
    log, state, _ = dbfake
    state["answer"] = lambda s, p: [{"id": RID}] if s.startswith("INSERT") else []
    r = client().post(P, json={"name": "Main", "menu_type": "header",
                               "items": {"groups": [], "actions": []}, "notes": None})
    assert r.json() == {"id": RID}
    (w,) = writes(log)
    assert w[0] is True and "RETURNING public.exp_web_nav_menus.id" in w[1]
    assert values(w[2]) == {"name": "Main", "menu_type": "header", "notes": None,
                            "items": {"groups": [], "actions": []}, "design_tag": "new"}


def test_create_refuses_other_columns(dbfake):
    r = client().post(P, json={"name": "x", "menu_type": "header", "assigned_site": "main_site"})
    assert r.status_code == 422


def test_update_writes_only_sent_keys(dbfake):
    log, _, _ = dbfake
    client().patch(f"{P}/{RID}", json={"name": "New"})
    (w,) = writes(log)
    assert w[1].startswith("UPDATE public.exp_web_nav_menus SET name=")
    assert values(w[2]) == {"name": "New", "id_1": RID}


def test_set_assignment_clears_the_slot_then_assigns(dbfake):
    log, _, _ = dbfake
    client().put(f"{P}/{RID}/assignment", json={"menu_type": "header", "site": "main_site"})
    clear, assign = writes(log)
    assert "assigned_site = %(assigned_site_1)s" in clear[1] and "menu_type" in clear[1]
    assert "id != %(id_1)s" in clear[1]
    assert values(clear[2]) == {"assigned_site": None, "assigned_site_1": "main_site",
                                "menu_type_1": "header", "id_1": RID}
    assert values(assign[2]) == {"assigned_site": "main_site", "id_1": RID}


def test_unassign_is_one_update(dbfake):
    log, _, _ = dbfake
    client().put(f"{P}/{RID}/assignment", json={"menu_type": "header", "site": None})
    (w,) = writes(log)
    assert values(w[2]) == {"assigned_site": None, "id_1": RID}


def test_trash_restore_delete(dbfake):
    log, _, _ = dbfake
    c = client()
    c.post(f"{P}/{RID}/trash", json={"deleted_by": CLAIMS["sub"]})
    c.post(f"{P}/{RID}/restore")
    c.delete(f"{P}/{RID}")
    trash, restore, delete = writes(log)
    v = values(trash[2])
    assert v["deleted_by"] == CLAIMS["sub"] and v["assigned_site"] is None
    assert v["deleted_at"] is not None  # server clock
    assert values(restore[2]) == {"deleted_at": None, "deleted_by": None, "id_1": RID}
    assert delete[1].startswith("DELETE FROM public.exp_web_nav_menus WHERE")


def test_rls_refusal_is_403(dbfake):
    _, state, _ = dbfake
    state["answer"] = lambda s, p: psycopg.errors.InsufficientPrivilege(
        'new row violates row-level security policy for table "exp_web_nav_menus"')
    assert client().patch(f"{P}/{RID}", json={"name": "x"}).status_code == 403
