"""Aggregate router for the conversion_agents Surface.

The app mounts only this. Include new conversion_agents sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from conversion_agents.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
