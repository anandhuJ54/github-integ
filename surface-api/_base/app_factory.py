"""Shared FastAPI application factory.

A deployable `services/<name>` composes a subset of Surfaces by mounting each
Surface's router. This factory wires the cross-cutting concerns (CORS, auth,
error shape) once so every service is consistent.
"""
from __future__ import annotations

from collections.abc import Iterable

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware


def create_app(title: str, routers: Iterable[APIRouter]) -> FastAPI:
    """Build a FastAPI app for a deployable service from a set of Surface routers."""
    app = FastAPI(title=title)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # tighten per environment; SPA origin(s) only in prod
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for router in routers:
        app.include_router(router)

    @app.get("/healthz", tags=["meta"])
    def healthz() -> dict:
        return {"status": "ok", "service": title}

    return app
