"""Shared FastAPI application factory.

A deployable `services/<name>` composes a subset of Surfaces by mounting each
Surface's router. This factory wires the cross-cutting concerns (CORS, auth,
error shape, liveness/readiness) once so every service is consistent.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import APIRouter, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from _base.core.config import get_settings
from _base.core.db import close_pools


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
        from _base.core.db import read_connection

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
