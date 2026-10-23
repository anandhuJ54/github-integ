"""conversion-agents endpoints that replaced the browser's direct Supabase calls (no live DB/auth)."""
from __future__ import annotations

from contextlib import contextmanager

import psycopg
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from _base.core import db as core_db
from _base.core.auth import current_user
from conversion_agents.router import router

CLAIMS = {"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}


class Diag:
    def __init__(self, msg):
        self.message_primary = msg


class DbErr(psycopg.Error):
    def __init__(self, msg):
        super().__init__(msg)
        self._msg = msg

    @property
    def diag(self):  # psycopg.Error.diag is read-only; fake it
        return Diag(self._msg)


class FakeConn:
    def __init__(self, log, answer, role, write):
        self.log, self.answer, self.role, self.write = log, answer, role, write

    @contextmanager
    def transaction(self):
        yield

    def cursor(self):
        conn = self

        class Cur:
            description = None

            def execute(self, sql, params=None):
                conn.log.append((conn.role, conn.write, sql, params))
                rows = conn.answer(sql, params or {})
                if isinstance(rows, Exception):
                    raise rows
                self._rows = rows or []
                self.description = [("x",)] if rows is not None else None

            def fetchall(self):
                return self._rows

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return Cur()


@pytest.fixture
def dbfake(monkeypatch):
    log: list = []
    state = {"answer": lambda sql, params: []}

    @contextmanager
    def fake_role_connection(role, claims=None, *, write=False, fresh=False):
        assert role == "authenticated" and claims == CLAIMS  # always as the signed-in user
        yield FakeConn(log, lambda s, p: state["answer"](s, p), role, write)

    monkeypatch.setattr(core_db, "role_connection", fake_role_connection)
    return log, state


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[current_user] = lambda: CLAIMS
    return TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("get", "/conversion-agents/claims/stats"),
    ("get", "/conversion-agents/claims"),
    ("get", "/conversion-agents/plg-rules"),
    ("get", "/conversion-agents/claim-profile/x"),
    ("delete", "/conversion-agents/plg-rules/r1"),
])
def test_every_endpoint_needs_a_signed_in_user(method, path):
    app = FastAPI()
    app.include_router(router)
    assert getattr(TestClient(app), method)(path).status_code == 403


# --- /claims ---------------------------------------------------------------------------------

def test_stats_one_query_four_filters(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"pending": 1, "approved": 2, "manual": 3, "conflict": 4}]
    r = client().get("/conversion-agents/claims/stats")
    assert r.json() == {"pending": 1, "approved": 2, "manual": 3, "conflict": 4}
    (_, write, sql, params), = log
    assert not write and sql.count("FILTER") == 4 and "FROM public.claim_queue" in sql
    assert sorted(v for k, v in params.items() if k.startswith("status")) == sorted(
        ["pending", "auto_approved", "approved", "manual_review", "conflict"])


@pytest.mark.parametrize("tab,statuses", [
    ("pending", ["pending"]),
    ("auto_approved", ["auto_approved", "approved"]),
    ("all", []),
])
def test_list_filters_by_tab_newest_first_200(dbfake, tab, statuses):
    log, state = dbfake
    row = {"id": "c1", "entity_type": "professional", "entity_id": "p1", "claimant_user_id": None,
           "claimant_email": "a@b.c", "claimant_name": None, "confidence_score": 90,
           "confidence_signals": None, "match_method": "email", "status": "pending",
           "review_notes": None, "created_at": "2026-10-23T00:00:00+00:00", "trust_tier": 2}
    state["answer"] = lambda s, p: [row]
    r = client().get("/conversion-agents/claims", params={"tab": tab})
    assert r.status_code == 200 and r.json()[0]["trust_tier"] == 2  # select * passes through
    sql, params = log[0][2], log[0][3]
    assert "ORDER BY public.claim_queue.created_at DESC" in sql and "LIMIT" in sql
    assert params["param_1"] == 200
    assert sorted(v for k, v in params.items() if k.startswith("status")) == sorted(statuses)


def test_list_rejects_an_unknown_tab(dbfake):
    assert client().get("/conversion-agents/claims", params={"tab": "x"}).status_code == 422


def test_entities_names_and_failed_read_is_empty(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "FROM public.professionals" in sql:
            return [
                {"id": "p1", "display_name": None, "first_name": "Ann", "last_name": None,
                 "gcid": "gcid:x", "photo_url": None},
                {"id": "p2", "display_name": "", "first_name": None, "last_name": None,
                 "gcid": None, "photo_url": "u"},
            ]
        return DbErr("permission denied for table organizations")

    state["answer"] = answer
    r = client().post("/conversion-agents/claims/entities",
                      json={"professionalIds": ["p1", "p2"], "organizationIds": ["o1"]})
    assert r.json() == {
        "p1": {"name": "Ann", "gcid": "gcid:x", "imageUrl": None, "kind": "professional"},
        "p2": {"name": "Unnamed", "gcid": None, "imageUrl": "u", "kind": "professional"},
    }


def test_entities_with_no_ids_makes_no_query(dbfake):
    log, _ = dbfake
    assert client().post("/conversion-agents/claims/entities", json={}).json() == {}
    assert log == []


def test_adjudicate_calls_the_governed_function_as_a_write(dbfake):
    log, _ = dbfake
    r = client().post("/conversion-agents/claims/q1/adjudicate", json={"approve": True, "note": ""})
    assert r.json() == {"ok": True}
    (_, write, sql, params), = log
    assert write and "exp_claim_queue_adjudicate(p_queue => %(q)s" in sql
    assert params == {"q": "q1", "a": True, "n": None}  # empty note → null, as `|| null` did


def test_adjudicate_error_message_reaches_the_page(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: DbErr("claim already adjudicated")
    r = client().post("/conversion-agents/claims/q1/adjudicate", json={"approve": False})
    assert r.status_code == 400 and r.json()["detail"] == "claim already adjudicated"


# --- /emp/plg-rules --------------------------------------------------------------------------

def test_rules_page_reads_rules_and_capped_event_stats(dbfake):
    log, state = dbfake
    rule = {"id": "r1", "gcid": None, "rule_name": "a", "rule_type": "banner",
            "trigger_condition": {}, "priority": 1, "headline": "h", "body": "b",
            "cta_text": "c", "cta_action": "x", "cta_url": None, "requires_upgrade": False,
            "upgrade_tier": None, "icon": None, "is_active": True,
            "created_at": "2026-10-23T00:00:00+00:00"}

    def answer(sql, params):
        if "FROM public.plg_rules" in sql:
            return [rule]
        return [{"rule_id": "r1", "fires": 3, "dismissals": 1, "conversions": 0}]

    state["answer"] = answer
    r = client().get("/conversion-agents/plg-rules")
    assert r.json() == {"rules": [rule],
                        "stats": [{"rule_id": "r1", "fires": 3, "dismissals": 1, "conversions": 0}]}
    rules_sql = log[0][2]
    assert "ORDER BY public.plg_rules.priority ASC, public.plg_rules.rule_name ASC" in rules_sql
    stats_sql, stats_params = log[1][2], log[1][3]
    assert "GROUP BY" in stats_sql and 50000 in stats_params.values()


def test_toggle_updates_then_audits_as_a_write(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: None
    r = client().patch("/conversion-agents/plg-rules/r1/active", json={"is_active": False})
    assert r.json() == {"ok": True}
    assert [w for _, w, _, _ in log] == [True, True]
    assert log[0][2].startswith("UPDATE public.plg_rules")
    audit = log[1]
    assert audit[2].startswith("INSERT INTO public.audit_log")
    assert "plg_rule.deactivate" in audit[3].values()


def test_a_refused_audit_row_keeps_the_change(dbfake):
    _, state = dbfake

    def answer(sql, params):
        if "audit_log" in sql:
            return DbErr("new row violates row-level security policy")
        return None

    state["answer"] = answer
    assert client().delete("/conversion-agents/plg-rules/r1").json() == {"ok": True}


def test_create_logs_the_new_rule_id(dbfake):
    log, state = dbfake

    def answer(sql, params):
        return [{"id": "new-1"}] if sql.startswith("INSERT INTO public.plg_rules") else None

    state["answer"] = answer
    r = client().post("/conversion-agents/plg-rules", json={"rule_name": "n", "rule_type": "toast"})
    assert r.json() == {"id": "new-1"}
    assert "new-1" in log[1][3].values()


def test_create_requires_name_and_type(dbfake):
    r = client().post("/conversion-agents/plg-rules", json={"rule_name": "", "rule_type": "toast"})
    assert r.status_code == 422


def test_save_error_message_reaches_the_page(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: DbErr("new row violates row-level security policy")
    r = client().put("/conversion-agents/plg-rules/r1", json={"rule_name": "n", "rule_type": "x"})
    assert r.status_code == 400 and "row-level security" in r.json()["detail"]


def test_duplicate_copies_inactive_with_suffix(dbfake):
    log, state = dbfake
    state["answer"] = lambda s, p: [{"id": "copy-1"}]
    assert client().post("/conversion-agents/plg-rules/r1/duplicate").json() == {"id": "copy-1"}
    sql, params = log[0][2], log[0][3]
    assert sql.startswith("INSERT INTO public.plg_rules") and "SELECT" in sql
    assert " (Copy)" in params.values() and False in params.values()


def test_duplicate_of_an_invisible_rule_is_404(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: []
    assert client().post("/conversion-agents/plg-rules/r1/duplicate").status_code == 404


# --- /claim/{slug} ---------------------------------------------------------------------------

def test_claim_profile_with_category_label(dbfake):
    _, state = dbfake
    prof = {"id": "p1", "slug": "s", "gcid": "gcid:insurance_agent"}

    def answer(sql, params):
        if "FROM public.professionals" in sql:
            return [prof]
        return [{"license_label": "Producer License"}]

    state["answer"] = answer
    r = client().get("/conversion-agents/claim-profile/s")
    assert r.json() == {"prof": prof, "licenseLabel": "Producer License"}


def test_claim_profile_default_label_and_404(dbfake):
    _, state = dbfake
    state["answer"] = lambda s, p: [{"id": "p1", "gcid": None}] if "professionals" in s else []
    assert client().get("/conversion-agents/claim-profile/s").json()["licenseLabel"] == "License Number"
    state["answer"] = lambda s, p: []
    assert client().get("/conversion-agents/claim-profile/s").status_code == 404
