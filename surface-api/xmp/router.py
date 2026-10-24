"""Aggregate router for the xmp Surface.

The app mounts only this. Include new xmp sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from xmp.routers.health import router as health_router
from xmp.routers.seat_data import router as seat_data_router
from xmp.routers.website_data import router as website_data_router

router = APIRouter()
router.include_router(health_router)
router.include_router(website_data_router)
router.include_router(seat_data_router)
