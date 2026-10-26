"""Aggregate router for the sales Surface.

Accounts (/sales/accounts/*) moved to admin (/admin/accounts/*); the Directory drill-down data
moved to the owners: professional and organization rows to srp (/srp/directory/*), the brand
rollup to xmp (/xmp/directory/brands/*), surface audit 2026-10-25. Team Central moved in from xmp
(/xmp/team/* → /sales/team-central/*), same audit.

The app mounts only this. Each resource folder (<resource>/router.py) is included here once,
not in app.py; this module defines no endpoints.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.sales.alert.router import router as alert_router
from surfaces.sales.board.router import router as board_router
from surfaces.sales.catalog.router import router as catalog_router
from surfaces.sales.category_group.router import router as category_group_router
from surfaces.sales.contract.router import router as contract_router
from surfaces.sales.core.router import router as core_router
from surfaces.sales.cpq.router import router as cpq_router
from surfaces.sales.csm.router import router as csm_router
from surfaces.sales.google_workspace.router import router as google_workspace_router
from surfaces.sales.health.router import router as health_router
from surfaces.sales.nav.router import router as nav_router
from surfaces.sales.opportunity.router import router as opportunity_router
from surfaces.sales.seller_setup.router import router as seller_setup_router
from surfaces.sales.sign.router import router as sign_router
from surfaces.sales.spine.router import router as spine_router
from surfaces.sales.sre.router import router as sre_router
from surfaces.sales.team.router import router as team_router
from surfaces.sales.team_central.router import router as team_central_router
from surfaces.sales.territory.router import router as territory_router
from surfaces.sales.worklist.router import router as worklist_router

router = APIRouter()
router.include_router(health_router)
router.include_router(catalog_router)
router.include_router(cpq_router)
router.include_router(core_router)
router.include_router(contract_router)
router.include_router(csm_router)
router.include_router(sign_router)
router.include_router(worklist_router)
router.include_router(sre_router)
router.include_router(alert_router)
router.include_router(opportunity_router)
router.include_router(team_router)
router.include_router(team_central_router)
router.include_router(seller_setup_router)
router.include_router(territory_router)
router.include_router(category_group_router)
router.include_router(board_router)
router.include_router(nav_router)
router.include_router(spine_router)
router.include_router(google_workspace_router)
