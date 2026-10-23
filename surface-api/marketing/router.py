"""Aggregate router for the marketing Surface.

The app mounts only this. Include new marketing sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from marketing.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
