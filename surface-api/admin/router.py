"""Aggregate router for the admin Surface.

The app mounts only this. Include new admin sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from admin.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
