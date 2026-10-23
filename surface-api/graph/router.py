"""Aggregate router for the graph Surface.

The app mounts only this. Include new graph sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from graph.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
