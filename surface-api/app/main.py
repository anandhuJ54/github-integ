"""Where the app starts: the FastAPI application factory and the dev app built from it.

A deployable service composes a subset of Surfaces by mounting each Surface's router. This
factory wires the cross-cutting concerns (CORS, auth, error shape, liveness/readiness) once so
every service is consistent. The dev app below mounts every Surface (`app/routes.py`).
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager

import anyio.to_thread
import psycopg
from fastapi import APIRouter, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout

from _base.config import get_settings
from _base.db.session import close_pools
from app.routes import ROUTERS

_log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Pin the threadpool that runs sync routes to the DB pool size, so concurrent
    # DB-touching requests on this worker can't exceed the connections it can lease.
    anyio.to_thread.current_default_thread_limiter().total_tokens = (
        get_settings().effective_threadpool()
    )
    # Pools open lazily on first DB use; close them here so sockets are released on shutdown.
    yield
    close_pools()


def create_app(title: str, routers: Iterable[APIRouter]) -> FastAPI:
    """Build a FastAPI app for a deployable service from a set of Surface routers."""
    app = FastAPI(title=title, lifespan=_lifespan)

    origins, allow_credentials = get_settings().effective_cors()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,  # CORS_ALLOW_ORIGINS; "*" only valid without credentials
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(PoolTimeout)
    async def _pool_timeout(request: Request, exc: PoolTimeout) -> JSONResponse:
        # No connection within DB_POOL_TIMEOUT: the database (or the login's connection cap)
        # is saturated. Say so, instead of a bare 500 that reads like a code bug.
        _log.warning("pool timeout on %s %s: %s", request.method, request.url.path, exc)
        return JSONResponse({"detail": f"database busy: {exc}"}, status_code=503)

    @app.exception_handler(psycopg.OperationalError)
    async def _db_unavailable(request: Request, exc: psycopg.OperationalError) -> JSONResponse:
        # Connection lost / refused (e.g. the pooler closed it, VPN dropped). Not the caller's fault.
        _log.warning("database unavailable on %s %s: %s", request.method, request.url.path, exc)
        msg = exc.diag.message_primary if exc.diag and exc.diag.message_primary else str(exc)
        return JSONResponse({"detail": f"database unavailable: {msg}"}, status_code=503)

    for router in routers:
        app.include_router(router)

    @app.get("/healthz", tags=["meta"])
    def healthz() -> dict:
        """Liveness — process is up. Intentionally does NOT touch the DB, so a DB blip
        doesn't trigger a restart storm. Use /readyz for traffic-routing decisions."""
        return {"status": "ok", "service": title}

    @app.get("/readyz", tags=["meta"])
    def readyz() -> dict:
        """Readiness — can this worker actually serve a request (lease a connection and
        reach the DB)? Checks the read path, which falls back to the primary when no
        replica is configured. Returns 503 so an orchestrator holds traffic off a worker
        that can't serve yet."""
        from _base.db.session import read_connection

        try:
            with read_connection() as conn, conn.cursor() as cur:
                cur.execute("select 1")
                cur.fetchone()
        except Exception as exc:  # any failure to reach the DB means "not ready"
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="database unavailable",
            ) from exc
        return {"status": "ready", "service": title}

    return app


app = create_app("api", routers=ROUTERS)
