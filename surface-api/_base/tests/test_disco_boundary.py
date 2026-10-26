"""Tests for _base.disco.boundary (fake connection; the model is a stub `ask`)."""
from __future__ import annotations

from contextlib import contextmanager

import pytest

from _base.disco import boundary as b


class FakeConn:
    """Answers SELECTs by table; records every statement."""

    def __init__(self, existing=None, cat=None, cats=()):
        self.existing = existing
        self.cat = cat
        self.cats = list(cats)
        self.log: list[tuple[str, tuple]] = []

    @contextmanager
    def cursor(self):
        conn = self

        class Cur:
            _rows: tuple = ()

            def execute(self, sql, params=None):
                conn.log.append((sql, params))
                if "from exp_category_boundary" in sql:
                    self._rows = [conn.existing] if conn.existing else []
                elif "display_name, entity_type" in sql:
                    self._rows = [conn.cat] if conn.cat else []
                elif "from gbp_categories" in sql:
                    self._rows = conn.cats
                else:
                    self._rows = []

            def fetchone(self):
                return self._rows[0] if self._rows else None

            def fetchall(self):
                return self._rows

        yield Cur()


CATS = [
    {"gcid": "gcid:tax_preparation_service", "display_name": "Tax preparation service"},
    {"gcid": "gcid:bookkeeping_service", "display_name": "Bookkeeping service"},
    {"gcid": "gcid:certified_public_accountant", "display_name": "Certified public accountant"},
    {"gcid": "gcid:software_company", "display_name": "Software company"},
]
ANSWER = {
    "definition": "An individual accountant who prepares and audits financial records "
    "(e.g. Deloitte, PwC).",
    "includes": ["staff accountants", "senior accountants (such as Big Four alumni)", "xy"],
    "subtypes": [{"name": "Tax Accountant!", "criteria": "focuses on tax"}, "junk"],
    "excludes": [
        {"type": "Bookkeepers", "goes_to": "Bookkeeping services"},
        {"type": "Accounting software vendors", "goes_to": "not a source"},
        "Tax preparers -> tax preparation service",
        {"type": "Payroll firms", "goes_to": "Payroll agency"},
        {"type": "Software makers", "goes_to": "gcid:software company"},
    ],
}


def test_tokens_and_stem():
    assert b._tokens("Certified public accountant") == ["certified", "public", "account"]
    assert b._tokens("Tax preparation service") == ["tax", "preparation"]


def test_strip_examples():
    assert b.strip_examples("Firms (e.g. Deloitte, PwC) and others") == "Firms and others"
    assert b.strip_examples("Firms (such as small ones)") == "Firms (such as small ones)"
    assert b.strip_examples("Accountants, such as Deloitte staff") == "Accountants"
    assert b.strip_examples("Accountants such as staff and seniors") == (
        "Accountants such as staff and seniors")


def test_as_list():
    assert b.as_list('["a", "b"]') == ["a", "b"]
    assert b.as_list("- one\n* two; three") == ["one", "two", "three"]
    assert b.as_list(None) == []
    assert b.as_list([1]) == [1]


def test_authored_boundary_is_kept():
    existing = {"definition": "d", "includes": [], "excludes": [], "subtypes": [],
                "source": "authored"}
    conn = FakeConn(existing=existing)
    out = b.generate_category_boundary(conn, "m", "gcid:accountant", lambda p, t: {},
                                       regenerate=True)
    assert out == {"boundary": existing, "saved": False, "reason": "authored boundary kept"}


def test_generated_boundary_not_regenerated_by_default():
    existing = {"definition": "d", "source": "generated:m"}
    out = b.generate_category_boundary(FakeConn(existing=existing), "m", "g", lambda p, t: {})
    assert out["reason"] == "generated boundary already exists" and not out["saved"]


def test_unknown_category():
    with pytest.raises(ValueError, match="unknown category gcid:nope"):
        b.generate_category_boundary(FakeConn(), "m", "gcid:nope", lambda p, t: {})


def test_generate_and_insert():
    conn = FakeConn(cat={"display_name": "Accountant", "entity_type": "professional"}, cats=CATS)
    seen: dict = {}

    def ask(prompt, tool):
        seen["prompt"], seen["tool"] = prompt, tool
        return ANSWER

    out = b.generate_category_boundary(conn, "claude-sonnet-5", "gcid:accountant", ask)
    assert seen["tool"]["name"] == "define_category_boundary"
    assert "ONE PROFILE IS: an individual professional (a person)." in seen["prompt"]
    # only categories sharing a stemmed word are offered
    assert "RELATED CATEGORIES (real categories in our list; use these exact names in goes_to):\n"\
        "Certified public accountant" in seen["prompt"]
    assert out["saved"] and out["reason"] == "generated"
    bd = out["boundary"]
    assert bd["definition"] == (
        "An individual accountant who prepares and audits financial records.")
    assert bd["includes"] == ["staff accountants", "senior accountants"]
    assert bd["subtypes"] == [{"name": "tax_accountant", "criteria": "focuses on tax"}]
    assert bd["excludes"] == [
        {"type": "Bookkeepers", "goes_to": "gcid:bookkeeping_service"},
        {"type": "Accounting software vendors", "goes_to": "not a source"},
        {"type": "Tax preparers", "goes_to": "gcid:tax_preparation_service"},
        {"type": "Payroll firms", "goes_to": "adjacent: Payroll agency"},
        {"type": "Software makers", "goes_to": "gcid:software_company"},
    ]
    sql, params = conn.log[-1]
    assert sql.startswith("insert into exp_category_boundary")
    assert params[0] == "gcid:accountant" and params[5] == "generated:claude-sonnet-5"
    assert params[2].obj == bd["includes"]


def test_regenerate_updates_only_generated_row():
    conn = FakeConn(existing={"definition": "old", "source": "generated:x"},
                    cat={"display_name": "Accountant", "entity_type": "location"}, cats=CATS)
    out = b.generate_category_boundary(conn, "m", "gcid:accountant", lambda p, t: ANSWER,
                                       regenerate=True)
    assert out["reason"] == "regenerated"
    sql, params = conn.log[-1]
    assert sql.startswith("update exp_category_boundary")
    assert "source like 'generated%%'" in sql and params[-1] == "gcid:accountant"


def test_refused_answer_saves_nothing():
    conn = FakeConn(cat={"display_name": "Accountant", "entity_type": "professional"}, cats=[])
    with pytest.raises(ValueError) as e:
        b.generate_category_boundary(conn, "m", "g", lambda p, t: {"definition": "short",
                                                                   "includes": "", "excludes": 3})
    assert str(e.value) == (
        "boundary answer refused: definition 5 characters (received text (5 chars)); "
        "includes empty (received text (0 chars)); belongs-elsewhere empty (received number)"
    )
    assert not any(s.startswith(("insert", "update")) for s, _ in conn.log)
