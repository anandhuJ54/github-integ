"""Aggregate router for the sales Surface.

The app mounts only this. Include new sales sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from sales.routers.catalog_data import router as catalog_data_router
from sales.routers.cpq_data import router as cpq_data_router
from sales.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
router.include_router(catalog_data_router)
router.include_router(cpq_data_router)
