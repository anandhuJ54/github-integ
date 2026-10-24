"""Aggregate router for the sales Surface.

The app mounts only this. Include new sales sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from sales.routers.accounts_data import router as accounts_data_router
from sales.routers.catalog_data import router as catalog_data_router
from sales.routers.contracts_data import router as contracts_data_router
from sales.routers.core_data import router as core_data_router
from sales.routers.cpq_data import router as cpq_data_router
from sales.routers.csm_data import router as csm_data_router
from sales.routers.health import router as health_router
from sales.routers.sign_public import router as sign_public_router

router = APIRouter()
router.include_router(health_router)
router.include_router(catalog_data_router)
router.include_router(cpq_data_router)
router.include_router(core_data_router)
router.include_router(accounts_data_router)
router.include_router(contracts_data_router)
router.include_router(csm_data_router)
router.include_router(sign_public_router)
