"""Aggregate router for the marketing Surface.

City home, home data and CMS page reads moved here from srp, surface audit 2026-10-25. The
Demand engine API (/website/* pages and the site navigation menus) moved here from xmp, same
audit.

The app mounts only this. Include new marketing sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.marketing.routers.city_home_fn import router as city_home_fn_router
from surfaces.marketing.routers.health import router as health_router
from surfaces.marketing.routers.home_fn import router as home_fn_router
from surfaces.marketing.routers.public_site_fn import router as public_site_fn_router
from surfaces.marketing.routers.website_data import router as website_data_router

router = APIRouter()
router.include_router(health_router)
router.include_router(city_home_fn_router)
router.include_router(home_fn_router)
router.include_router(public_site_fn_router)
router.include_router(website_data_router)
