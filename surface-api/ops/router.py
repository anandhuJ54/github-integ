"""Aggregate router for the ops Surface.

The app mounts only this. Include new ops sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from ops.routers.dev_weekly import router as dev_weekly_router
from ops.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
router.include_router(dev_weekly_router)
