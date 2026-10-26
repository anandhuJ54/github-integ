"""Aggregate router for the skills Surface.

The app mounts only this. Include new skills sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.skills.routers.health import router as health_router
from surfaces.skills.routers.registry import router as registry_router

router = APIRouter()
router.include_router(health_router)
router.include_router(registry_router)
