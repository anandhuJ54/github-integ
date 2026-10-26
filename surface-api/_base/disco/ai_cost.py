"""ETL AI cost log (port of `-disco-ai-cost.ts`, 2026-10-22).

Every ETL AI call notes its token usage here; the rows are written to `exp_etl_cost_events`
once per worker request (batched inserts), so a failure to log never stops the work.

The request context (activity, category, site, request, job) is carried in a `ContextVar`
(the TS used AsyncLocalStorage), so overlapping worker requests never mix their rows. Each
FastAPI request runs in its own context. Work fanned out to a thread pool must run under
`contextvars.copy_context().run(...)` to keep noting into the same store (the store object is
shared, so rows noted there are written by the enclosing `with_cost_context`).

Dollars = tokens x the model's list price below (USD per million tokens); a model without a
price is logged with its tokens, cost 0 and `detail.unpriced = true`.
"""
from __future__ import annotations

import logging
import math
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, TypeVar

from psycopg.types.json import Jsonb

log = logging.getLogger(__name__)

T = TypeVar("T")

# USD per million tokens: input, cache read, cache write, output.
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-sonnet-5": (2.0, 0.2, 2.5, 10.0),
    "claude-sonnet-5-5": (2.0, 0.1, 2.5, 10.0),
    "claude-opus-5-5": (4.0, 0.2, 5.0, 20.0),
    "claude-sonnet-4-6": (3.0, 0.3, 3.75, 15.0),
}

# Tool names whose calls belong to their own activity, whatever request they run in.
ACTIVITY_BY_TOOL: dict[str, str] = {
    "return_extra_key_matches": "extra_match",
    "define_category_boundary": "boundary",
}

# Activity of a worker request by its tool.
ACTIVITY_BY_REQUEST_TOOL: dict[str, str] = {
    "discover_companies": "discovery",
    "classify_method": "method_check",
    "map_site": "map_contract",
}

_COLUMNS = (
    "activity", "model", "calls", "input_tokens", "cache_read_tokens", "cache_write_tokens",
    "output_tokens", "cost_usd", "gcid", "domain", "request_id", "job_id", "detail",
    "occurred_at",
)


def _js_round(x: float) -> int:
    """Math.round: half rounds up (towards +inf), unlike Python's banker's rounding."""
    return math.floor(x + 0.5)


def price_for(model: str | None) -> tuple[float, float, float, float] | None:
    """The price row for a model id; dated ids ("claude-sonnet-4-6-2026…") use their base name."""
    m = str(model if model is not None else "")
    if m in PRICES:
        return PRICES[m]
    for k in sorted(PRICES, key=len, reverse=True):
        if m.startswith(k):
            return PRICES[k]
    return None


def cost_of(model: str, usage: dict | None) -> float | None:
    """Dollar cost of one usage block, or None when the model has no price."""
    p = price_for(model)
    if not p:
        return None
    u = usage or {}
    return (
        (u.get("input_tokens") or 0) * p[0]
        + (u.get("cache_read_input_tokens") or 0) * p[1]
        + (u.get("cache_creation_input_tokens") or 0) * p[2]
        + (u.get("output_tokens") or 0) * p[3]
    ) / 1e6


@dataclass
class CostContext:
    """What every row noted inside `with_cost_context` is attributed to.

    `db` is a psycopg connection (service role, write) or a zero-arg callable returning a
    connection context manager (e.g. ``lambda: role_connection("service_role", write=True)``),
    used once at the end to insert the rows.
    """

    db: Any
    activity: str
    gcid: str | None = None
    domain: str | None = None
    request_id: int | None = None
    job_id: int | None = None


@dataclass
class _Store:
    ctx: CostContext
    pending: list[dict] = field(default_factory=list)


_store: ContextVar[_Store | None] = ContextVar("disco_ai_cost_store", default=None)


def note_ai_usage(
    *,
    model: str,
    usage: dict | None,
    tool: str | None = None,
    activity: str | None = None,
    step: str | None = None,
) -> None:
    """Note one AI call (written when the surrounding context ends). No context: not logged."""
    s = _store.get()
    if s is None:
        return
    try:
        u = usage or {}
        cost = cost_of(model, u)
        p = price_for(model)
        detail: dict[str, Any] = {}
        if tool:
            detail["tool"] = tool
        if step:
            detail["step"] = step
        if p:
            detail["price_per_mtok"] = {
                "input": p[0], "cache_read": p[1], "cache_write": p[2], "output": p[3],
            }
        else:
            detail["unpriced"] = True
        if not usage:
            detail["usage_missing"] = True
        c = s.ctx
        act = activity
        if act is None and tool:
            act = ACTIVITY_BY_TOOL.get(tool)
        if act is None:
            act = c.activity
        s.pending.append({
            "activity": act,
            "model": str(model or "unknown"),
            "calls": 1,
            "input_tokens": _js_round(u.get("input_tokens") or 0),
            "cache_read_tokens": _js_round(u.get("cache_read_input_tokens") or 0),
            "cache_write_tokens": _js_round(u.get("cache_creation_input_tokens") or 0),
            "output_tokens": _js_round(u.get("output_tokens") or 0),
            "cost_usd": _js_round((cost or 0) * 1e6) / 1e6,
            "gcid": c.gcid,
            "domain": c.domain,
            "request_id": c.request_id,
            "job_id": c.job_id,
            "detail": detail,
            "occurred_at": datetime.now(UTC),
        })
    except Exception:
        log.exception("ai cost note failed")


def _insert_rows(conn: Any, rows: list[dict]) -> None:
    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        one = "(" + ", ".join(["%s"] * len(_COLUMNS)) + ")"
        sql = (
            f"insert into exp_etl_cost_events ({', '.join(_COLUMNS)}) values "
            + ", ".join([one] * len(chunk))
        )
        params: list[Any] = []
        for r in chunk:
            params.extend(Jsonb(r[c]) if c == "detail" else r[c] for c in _COLUMNS)
        try:
            # savepoint: a failed batch does not abort the caller's transaction
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(sql, params)
        except Exception as e:  # noqa: BLE001
            log.error("ai cost log insert failed: %s", e)


def _flush(s: _Store) -> None:
    if not s.pending:
        return
    try:
        db = s.ctx.db
        if callable(db) and not hasattr(db, "cursor"):
            with db() as conn:
                _insert_rows(conn, s.pending)
        else:
            _insert_rows(db, s.pending)
    except Exception:
        log.exception("ai cost log failed")


@contextmanager
def cost_context(ctx: CostContext) -> Iterator[None]:
    """Context-manager form of `with_cost_context`."""
    s = _Store(ctx=ctx)
    token = _store.set(s)
    try:
        yield
    finally:
        _store.reset(token)
        _flush(s)


def with_cost_context(ctx: CostContext, fn: Callable[[], T]) -> T:
    """Run fn with a cost context; AI calls noted inside are written at the end."""
    with cost_context(ctx):
        return fn()


def pending_rows() -> list[dict] | None:
    """Rows noted so far in the current context (None outside one). For tests/diagnostics."""
    s = _store.get()
    return None if s is None else list(s.pending)
