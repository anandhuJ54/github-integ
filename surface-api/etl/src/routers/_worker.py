"""Shared plumbing for the disco worker routes (called by DB-side schedulers over HTTP).

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
