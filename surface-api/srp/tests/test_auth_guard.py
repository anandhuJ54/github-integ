"""Source guard for the local sign-in (srp/local-login-srp-home, criterion 16): the new SRP code never
touches Supabase, the shared `public` tables, or the database roles that are not its own.

Checks code only (names, imports, string values), not comments or docstrings, which may explain why.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
GUARDED = sorted((SRC / "auth").glob("*.py")) + [SRC / "seat" / "local.py"]

FORBIDDEN = [
    ("Supabase", re.compile(r"supabase", re.IGNORECASE)),
    ("a table in `public`", re.compile(r"\bpublic\.", re.IGNORECASE)),
    ("the service_role", re.compile(r"service_role", re.IGNORECASE)),
    ("the authenticated/anon database role", re.compile(r"role_connection|set_config\(|\banon\b", re.IGNORECASE)),
    ("the Admin endpoints", re.compile(r"/admin/", re.IGNORECASE)),
]


def _code_text(source: str) -> list[str]:
    """Every name, attribute, import and non-docstring string in the source."""
    tree = ast.parse(source)
    docstrings: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            first = node.body[0] if node.body else None
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                docstrings.add(id(first.value))
    out: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            out.append(node.id)
        elif isinstance(node, ast.Attribute):
            out.append(node.attr)
        elif isinstance(node, ast.alias):
            out.append(node.name)
        elif isinstance(node, ast.ImportFrom):
            out.append(node.module or "")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            out.append(node.value)
        elif isinstance(node, ast.JoinedStr):
            out.extend(v.value for v in node.values if isinstance(v, ast.Constant) and isinstance(v.value, str))
    return out


def violations(source: str) -> list[str]:
    text = _code_text(source)
    return [label for label, rx in FORBIDDEN if any(rx.search(t) for t in text)]


def test_the_guard_covers_the_new_files():
    names = {p.name for p in GUARDED}
    assert {"router.py", "schemas.py", "services.py", "seed.py", "local.py"} <= names


@pytest.mark.parametrize("path", GUARDED, ids=lambda p: p.name)
def test_new_sign_in_code_stays_off_supabase_public_and_other_roles(path):
    assert violations(path.read_text()) == []


# --- the guard itself fails on a planted violation ----------------------------------------------


@pytest.mark.parametrize(
    "planted,label",
    [
        ("import supabase_client", "Supabase"),
        ("from x import y\nurl = 'https://abc.supabase.co'", "Supabase"),
        ("sql = 'select 1 from public.exp_accounts'", "a table in `public`"),
        ("role = 'service_role'", "the service_role"),
        ("with role_connection('authenticated', c): pass", "the authenticated/anon database role"),
        ("path = '/admin/me/grants'", "the Admin endpoints"),
    ],
)
def test_the_guard_catches_a_planted_violation(planted, label):
    assert label in violations(planted)


def test_the_guard_ignores_comments_and_docstrings():
    assert violations('"""Not Supabase; reads public.x."""\n# a Supabase token\nx = 1') == []
