"""Aggregate router for the xmp Surface.

Surface audit 2026-10-25: the seat, NORA interview and pro dashboard endpoints moved to srp, the
Demand engine (/website/*) to marketing and the enterprise review campaigns to campaigns. xmp
keeps the Enterprise console (/enterprise/*).

The app mounts only this. Include new xmp sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from xmp.routers.enterprise_data import router as enterprise_data_router
from xmp.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
router.include_router(enterprise_data_router)
