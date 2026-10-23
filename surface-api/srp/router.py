"""Aggregate router for the srp Surface.

The app mounts only this. Include new srp sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from srp.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
