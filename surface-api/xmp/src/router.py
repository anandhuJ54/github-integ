"""Aggregate router for the xmp Surface.

Surface audit 2026-10-25: the seat, NORA interview and pro dashboard endpoints moved to srp, the
Demand engine (/website/*) to marketing and the enterprise review campaigns to campaigns. xmp
keeps the Enterprise console (/enterprise/*).

The app mounts only this. Include new xmp sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.xmp.directory.router import router as directory_data_router
from surfaces.xmp.enterprise.router import router as enterprise_data_router
from surfaces.xmp.health.router import router as health_router

router = APIRouter()
router.include_router(health_router)
router.include_router(enterprise_data_router)
router.include_router(directory_data_router)  # sales Directory drill-down data, surface audit 2026-10-25
