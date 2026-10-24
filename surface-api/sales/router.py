"""Aggregate router for the sales Surface.

The app mounts only this. Include new sales sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from sales.routers.accounts_data import router as accounts_data_router
from sales.routers.alerts_data import router as alerts_data_router
from sales.routers.boards_data import router as boards_data_router
from sales.routers.catalog_data import router as catalog_data_router
from sales.routers.category_groups_data import router as category_groups_data_router
from sales.routers.contracts_data import router as contracts_data_router
from sales.routers.core_data import router as core_data_router
from sales.routers.cpq_data import router as cpq_data_router
from sales.routers.csm_data import router as csm_data_router
from sales.routers.health import router as health_router
from sales.routers.nav_data import router as nav_data_router
from sales.routers.opportunity_data import router as opportunity_data_router
from sales.routers.seller_setup_data import router as seller_setup_data_router
from sales.routers.sign_public import router as sign_public_router
from sales.routers.spine_data import router as spine_data_router
from sales.routers.sre_data import router as sre_data_router
from sales.routers.teams_data import router as teams_data_router
from sales.routers.territories_data import router as territories_data_router
from sales.routers.worklist_data import router as worklist_data_router

router = APIRouter()
router.include_router(health_router)
router.include_router(catalog_data_router)
router.include_router(cpq_data_router)
router.include_router(core_data_router)
router.include_router(accounts_data_router)
router.include_router(contracts_data_router)
router.include_router(csm_data_router)
router.include_router(sign_public_router)
router.include_router(worklist_data_router)
router.include_router(sre_data_router)
router.include_router(alerts_data_router)
router.include_router(opportunity_data_router)
router.include_router(teams_data_router)
router.include_router(seller_setup_data_router)
router.include_router(territories_data_router)
router.include_router(category_groups_data_router)
router.include_router(boards_data_router)
router.include_router(nav_data_router)
router.include_router(spine_data_router)
