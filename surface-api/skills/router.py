"""Aggregate router for the skills Surface.

The app mounts only this. Include new skills sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from skills.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
