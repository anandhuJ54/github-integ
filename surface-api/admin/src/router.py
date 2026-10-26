"""Aggregate router for the admin Surface.

The app mounts only this. Include new admin resource routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.admin.account.router import router as accounts_data_router
from surfaces.admin.claim.router import router as claims_router
from surfaces.admin.console_home.router import router as console_home_router
from surfaces.admin.console_page.router import router as console_pages_router
from surfaces.admin.control_claim.router import router as control_claims_router
from surfaces.admin.health.router import router as health_router
from surfaces.admin.integration.google_oauth_callback_router import (
    router as google_oauth_callback_router,
)
from surfaces.admin.integration.google_workspace_router import router as google_workspace_fn_router
from surfaces.admin.integration.router import router as integrations_fn_router
from surfaces.admin.me.router import router as me_router
from surfaces.admin.plg_rule.router import router as plg_rules_router
from surfaces.admin.search_console.router import router as search_console_router
from surfaces.admin.site_indexing.router import router as site_indexing_fn_router
from surfaces.admin.staging_key.router import router as staging_keys_fn_router

router = APIRouter()
router.include_router(health_router)
router.include_router(google_workspace_fn_router)
router.include_router(integrations_fn_router)
router.include_router(staging_keys_fn_router)
router.include_router(google_oauth_callback_router)
router.include_router(console_pages_router)
router.include_router(me_router)
router.include_router(claims_router)
router.include_router(plg_rules_router)
router.include_router(search_console_router)
router.include_router(site_indexing_fn_router)
router.include_router(console_home_router)
router.include_router(control_claims_router)
router.include_router(accounts_data_router)  # moved from sales, surface audit 2026-10-25
