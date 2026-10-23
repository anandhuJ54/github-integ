"""Aggregate router for the campaigns Surface.

The app mounts only this. Include new campaigns sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from campaigns.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
