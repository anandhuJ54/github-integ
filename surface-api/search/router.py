"""Aggregate router for the search Surface.

The app mounts only this. Include new search sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from search.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
