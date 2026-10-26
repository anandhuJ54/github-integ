"""A scripted stand-in for surfaces.nora_os.db.Db: routes SQL (by substring) to canned rows."""
from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from surfaces.nora_os.db import DbError

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures"


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


Route = tuple[str, Any]


class FakeDb:
    """`routes`: [(substring, result)], first match wins; `result` may be a callable
    (sql, params) → rows, or an Exception instance to raise. RPCs match on "rpc:<fn>"."""

    def __init__(self, routes: list[Route] | None = None, role: str = "service_role") -> None:
        self.routes: list[Route] = list(routes or [])
        self.role = role
        self.calls: list[tuple[str, Any]] = []

    @property
    def is_service(self) -> bool:
        return self.role == "service_role"

    def _answer(self, key: str, params: Any) -> Any:
        self.calls.append((key, params))
        for pat, res in self.routes:
            if pat in key:
                if isinstance(res, Exception):
                    raise res
                return res(key, params) if callable(res) else res
        raise AssertionError(f"unexpected query: {key}")

    def rows(self, sql: str, params: Any = (), *, what: str) -> list[dict]:
        r = self._answer(sql, params)
        return list(r or [])

    def maybe_one(self, sql: str, params: Any = (), *, what: str) -> dict | None:
        r = self.rows(sql, params, what=what)
        if len(r) > 1:
            raise DbError(f"{what}: JSON object requested, multiple (or no) rows returned")
        return r[0] if r else None

    def write(self, sql: str, params: Any = (), *, what: str) -> list[dict]:
        return self.rows(sql, params, what=what)

    def rpc(self, fn: str, args: dict, *, casts: dict | None = None) -> Any:
        return self._answer(f"rpc:{fn}", args)

    def sql(self, needle: str) -> list[tuple[str, Any]]:
        return [c for c in self.calls if needle in c[0]]


def echo_insert(sql: str, params: Any) -> list[dict]:
    """exp_skill_run insert → the row back (jsonb params unwrapped), with id/created_at."""
    cols = sql.split("(", 1)[1].split(")", 1)[0].split(", ")
    row: dict[str, Any] = {"id": "run-1", "created_at": "2026-10-23T00:00:00+00:00"}
    for c, v in zip(cols, params, strict=True):
        row[c] = getattr(v, "obj", v)
    return [row]


Responder = Callable[[str, Any], Any]
