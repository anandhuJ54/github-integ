"""Helpers shared by two or more etl resource folders (private to this Surface; no endpoints).

Shared plumbing for the disco worker routes (called by DB-side schedulers over HTTP).

The legacy TanStack handlers read `request.json()` themselves and checked the
`x-disco-worker-key` header against `DISCO_WORKER_KEY`; these helpers keep that behaviour
(raw body parsing, so an invalid body gives the worker's own 400 rather than FastAPI's 422).
"""
from __future__ import annotations

import json
import os
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from _base.disco.agent_engine import js_number

_INVALID = object()


def worker_key_ok(request: Request) -> bool:
    """`!workerKey || header !== workerKey` → unauthorized (an unset key never matches)."""
    key = os.environ.get("DISCO_WORKER_KEY")
    return bool(key) and request.headers.get("x-disco-worker-key") == key


async def read_json(request: Request) -> Any:
    """`await request.json()`; returns INVALID when the body is not JSON."""
    raw = await request.body()
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return _INVALID


def is_invalid(body: Any) -> bool:
    return body is _INVALID


def jresp(body: Any, status: int = 200) -> JSONResponse:
    """`Response.json(body, {status})`; keys whose value is the TS `undefined` are left out."""
    return JSONResponse(jsonable_encoder(body), status_code=status)


# --- detail-page workers (disco_harvest_worker, disco_detail_api_worker) ---

VALID_CRAWL_METHODS = ["server_crawl", "needs_proxy", "needs_js_api", "direct"]


def validate_body(body: Any) -> tuple[int, dict] | None:
    """The shared 400s of the detail-page workers (None when the body is usable)."""
    b = body if isinstance(body, dict) else {}
    if not b.get("url") or not b.get("domain") or not b.get("gcid") or not b.get("crawl_method"):
        return 400, {"error": "url, domain, gcid and crawl_method are required"}
    if b["crawl_method"] not in VALID_CRAWL_METHODS:
        return 400, {"error": f"crawl_method must be one of {', '.join(VALID_CRAWL_METHODS)}"}
    return None


def cr_num(v: Any) -> float:
    """`Number(v ?? 0)` (NaN compares false, like the TS `< 3`)."""
    return js_number(0 if v is None else v)
