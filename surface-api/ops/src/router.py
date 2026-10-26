"""Aggregate router for the ops Surface.

The app mounts only this. Include new ops sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.ops.routers.console_data import router as console_data_router
from surfaces.ops.routers.dev_weekly import router as dev_weekly_router
from surfaces.ops.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
router.include_router(dev_weekly_router)
router.include_router(console_data_router)
