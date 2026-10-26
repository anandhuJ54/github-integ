"""disco-webscraper-worker route: POST /public/disco-webscraper-worker.

The handler logic is the shared library's (`_base.disco.webscraper.handle_webscraper_request`,
port of `disco-webscraper-worker.ts`); this module only wires it to the ETL Surface.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from _base.disco.webscraper import handle_webscraper_request
from surfaces.etl.routers._worker import jresp

router = APIRouter(tags=["etl:disco"])


@router.post("/public/disco-webscraper-worker")
async def disco_webscraper_worker(request: Request):
    raw = await request.body()
    status, body = await run_in_threadpool(
        handle_webscraper_request, raw, request.headers.get("x-disco-worker-key"), request.method
    )
    return jresp(body, status)
