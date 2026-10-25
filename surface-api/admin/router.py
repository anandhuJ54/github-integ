"""Aggregate router for the admin Surface.

The app mounts only this. Include new admin sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from admin.routers.claims import router as claims_router
from admin.routers.console_home import router as console_home_router
from admin.routers.console_pages import router as console_pages_router
from admin.routers.google_oauth_callback import router as google_oauth_callback_router
from admin.routers.google_workspace_fn import router as google_workspace_fn_router
from admin.routers.health import router as health_router
from admin.routers.integrations_fn import router as integrations_fn_router
from admin.routers.me import router as me_router
from admin.routers.plg_rules import router as plg_rules_router
from admin.routers.search_console import router as search_console_router
from admin.routers.site_indexing_fn import router as site_indexing_fn_router
from admin.routers.staging_keys_fn import router as staging_keys_fn_router

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
