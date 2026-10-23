"""POST /public/disco-agent-mapper — site mapper version 2 (AI agent), dry runs only.

Port of `routes/api/public/disco-agent-mapper.ts` (the edge strips `/api`). Header
`x-disco-worker-key` must equal DISCO_WORKER_KEY. Body: { dry_run: true, domain, category,
start_url?, model?, effort?, minutes?, budget?, max_fetches?, no_browser?, call_seconds?
(120-900, default 240), learn_fields?, state? }. Nothing is written to any table. The logic lives
in `etl.disco.agent_mapper.handle_request`; called by DB-side schedulers, never scheduled here.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from starlette.concurrency import run_in_threadpool

from etl.disco import agent_mapper

router = APIRouter(tags=["etl:disco"])


@router.post("/public/disco-agent-mapper")
async def disco_agent_mapper(request: Request) -> Response:
    raw = await request.body()
    status, body = await run_in_threadpool(
        agent_mapper.handle_request, raw, request.headers.get("x-disco-worker-key"),
        str(request.base_url),
    )
    if isinstance(body, str):
        return PlainTextResponse(body, status_code=status)
    return JSONResponse(body, status_code=status)
