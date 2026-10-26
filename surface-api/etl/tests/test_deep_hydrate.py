"""Tests for surfaces.etl.deep_hydrate (fake psycopg connection; no DB, no network)."""
from __future__ import annotations

from typing import Any

import pytest
from psycopg import sql as psql
from psycopg.types.json import Jsonb
from surfaces.etl import deep_hydrate as dh

from etl.tests.test_statefarm import HTML


class FakeCursor:
    def __init__(self, conn: FakeConn):
        self.conn = conn
        self.description = None
        self._rows: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, query: Any, params: Any = None):
        text = query.as_string(None) if isinstance(query, psql.Composable) else str(query)
        self.conn.log.append((" ".join(text.split()), list(params or [])))
        rows = self.conn.respond(text, list(params or []))
        self._rows = rows
        self.description = [("x",)] if rows is not None else None

    def fetchall(self):
        return list(self._rows or [])

    def fetchone(self):
        return (self._rows or [None])[0]


class FakeConn:
    def __init__(self, respond):
        self.respond = respond
        self.log: list[tuple[str, list]] = []

    def cursor(self):
        return FakeCursor(self)


def _sql_as_string(monkeypatch):
    # sql.Composable.as_string(None) needs a real connection for Identifier quoting.
    monkeypatch.setattr(psql.Identifier, "as_string",
                        lambda self, ctx=None: ".".join(f'"{s}"' for s in self._obj))


@pytest.fixture(autouse=True)
def _ident(monkeypatch):
    _sql_as_string(monkeypatch)


URL = "https://www.statefarm.com/agent/us/tx/austin/jane-doe"


def test_hash_slug_and_split():
    assert dh.hash_slug("sf-", "abc", 8) == "sf-ba7816bf"
    assert dh.split_name("  Jane  Q Doe ") == {"first": "Jane", "last": "Q Doe"}
    assert dh.split_name("Cher") == {"first": "Cher", "last": ""}


def test_gate_and_floor():
    conn = FakeConn(lambda q, p: [])
    floor = dh.load_field_floor(conn, "gcid:x")
    assert floor == {**dh.DEFAULT_FLOOR, "gcid": "gcid:x"}
    f = {"field_count": 3, "products": [], "licenses": [], "bio": ""}
    v = dh.gate_fields(f, {"min_fields": 8, "min_products": 1, "min_licenses": 0,
                           "required_keys": ["bio"]})
    assert v == {"passed": False, "field_count": 3, "reasons": [
        "field_count 3 < min_fields 8", "products 0 < min 1", "missing required key 'bio'"]}


def test_hydrate_shallow_marks_row():
    conn = FakeConn(lambda q, p: [] if q.lstrip().startswith("select") else None)
    row = {"stage_id": "s1", "detail_url": URL, "payload": {"a": 1}}
    out = dh.hydrate_staging_row(conn, row, "<html></html>", dict(dh.DEFAULT_FLOOR),
                                 refetch=lambda u: "<html></html>")
    assert out["ok"] is False and out["shallow"] is True
    assert out["error"] == "field-yield gate: no JSON-LD agency object on detail page"
    sql_text, params = conn.log[-1]
    assert sql_text.startswith("update exp_etl_staging set payload = %s, resolution_status")
    assert isinstance(params[0], Jsonb) and params[0].obj["field_tier"] == "shallow"
    assert params[0].obj["a"] == 1 and params[1] == "s1"


def test_hydrate_promotes_and_writes():
    def respond(q: str, p: list):
        if q.startswith("insert into") and "returning id" in q:
            return [{"id": "org-1"}] if '"organizations"' in q else [{"id": "pro-9"}]
        if q.lstrip().startswith("select"):
            return []
        return None

    conn = FakeConn(respond)
    row = {"stage_id": "s2", "detail_url": URL, "payload": None}
    floor = {**dh.DEFAULT_FLOOR, "min_fields": 5}
    out = dh.hydrate_staging_row(conn, row, HTML, floor)
    assert out["ok"] is True
    assert out["professional_id"] == "pro-9" and out["office_id"] == "org-1"
    assert out["created_professional"] is True and out["created_team"] == 1
    assert out["licenses"] == 2 and out["products"] == 1 and out["socials"] == 2
    texts = [t for t, _ in conn.log]
    assert any(t.startswith('insert into "organizations"') for t in texts)
    assert any(t.startswith("delete from graph_nodes") for t in texts)
    node_inserts = [(t, p) for t, p in conn.log if t.startswith('insert into "graph_nodes"')]
    # 1 product + 2 socials + 2 licenses for the agent, 1 credential for the team member
    assert len(node_inserts) == 6
    final_sql, final_params = conn.log[-1]
    assert "field_tier = 'enrichment'" in final_sql
    assert final_params[0].obj["field_tier"] == "deep" and final_params[1] == "s2"


def test_find_professional_by_phone():
    def respond(q: str, p: list):
        if "canonical_url" in q:
            return []
        if "phone = %s or phone = %s" in q:
            return [{"id": "x", "phone": "512-555-0100", "display_name": "J"}]
        return []

    conn = FakeConn(respond)
    assert dh.find_professional(conn, {"detail_url": URL, "phone": "(512) 555-0100"}) == "x"
    assert conn.log[1][1] == ["(512) 555-0100", "5125550100"]


def test_summarize():
    res = [
        {"ok": True, "field_count": 10, "has_bio": True, "products": 2, "socials": 0,
         "licenses": 1, "team": 0, "created_team": 2, "created_professional": True},
        {"ok": True, "field_count": 15, "has_bio": False, "products": 0, "socials": 1,
         "licenses": 0, "team": 1, "created_team": 0, "created_professional": False},
        {"ok": False, "shallow": True, "detail_url": "u1", "error": "gate"},
        {"ok": False, "detail_url": "u2", "error": "fetch 403"},
    ]
    s = dh.summarize(res)
    assert s["processed"] == 4 and s["parsed"] == 2 and s["shallow"] == 1 and s["failed"] == 1
    assert s["avg_fields"] == 12.5 and s["pct_with_bio"] == 50
    assert s["team_members_created"] == 2 and s["professionals_created"] == 1
    assert s["failures"] == [{"url": "u1", "shallow": True, "error": "gate"},
                             {"url": "u2", "shallow": False, "error": "fetch 403"}]
    assert dh.summarize([])["avg_fields"] == 0


def test_pending_rows_and_progress():
    def respond(q: str, p: list):
        if "any(%s)" in q:
            return [{"stage_id": "a", "detail_url": "u1", "payload": {}}]
        if "order by observed_at" in q:
            return [{"stage_id": "a", "detail_url": "u1", "payload": {}},
                    {"stage_id": "b", "detail_url": "u2", "payload": {}}]
        if "count(*)" in q:
            return [{"n": 10 if "field_tier' = 'deep'" in q else 3 if "shallow" in q else 20}]
        return []

    conn = FakeConn(respond)
    rows = dh.load_pending_staging_rows(conn, "gcid:x", 5, ["u1"])
    assert [r["stage_id"] for r in rows] == ["a", "b"]
    assert "payload->>'field_tier' is null or payload->>'field_tier' <> 'deep'" in conn.log[1][0]
    assert dh.hydration_progress(conn, "gcid:x") == {
        "gcid": "gcid:x", "total": 20, "deep": 10, "shallow": 3, "remaining": 7}


def test_fetch_agent_html(monkeypatch):
    class R:
        def __init__(self, code):
            self.status_code, self.text = code, "<html/>"

    calls = []
    monkeypatch.setattr(dh.httpx, "get", lambda url, **kw: calls.append(kw) or R(200))
    assert dh.fetch_agent_html("https://x") == "<html/>"
    assert calls[0]["headers"]["user-agent"] == dh.USER_AGENT
    monkeypatch.setattr(dh.httpx, "get", lambda url, **kw: R(403))
    with pytest.raises(Exception, match="fetch 403"):
        dh.fetch_agent_html("https://x")
