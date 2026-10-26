"""POST /public/disco-ai-worker (port of the `/api/public/disco-ai-worker` route).

Worker-key auth (x-disco-worker-key = DISCO_WORKER_KEY). Drains pending disco_llm_requests
(one map_site per call) or runs a read-only dry run; see `surfaces.etl.disco.ai_worker`.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from surfaces.etl.disco import ai_worker
from surfaces.etl.disco.ai_worker_util import to_json

router = APIRouter(tags=["etl"])


@router.post("/public/disco-ai-worker")
async def disco_ai_worker(request: Request) -> Response:
    raw = await request.body()
    key = request.headers.get("x-disco-worker-key")
    status, body = await run_in_threadpool(ai_worker.handle_request, raw, key)
    if isinstance(body, str):
        return PlainTextResponse(body, status_code=status)
    return JSONResponse(to_json(body), status_code=status)
