"""Aggregate router for the marketing Surface.

City home, home data and CMS page reads moved here from srp, surface audit 2026-10-25. The
Demand engine API (/website/* pages and the site navigation menus) moved here from xmp, same
audit.

The app mounts only this. Include each resource folder's router here (one include per
router), not in app.py. No endpoints here.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.marketing.city_home.router import router as city_home_fn_router
from surfaces.marketing.health.router import router as health_router
from surfaces.marketing.home.router import router as home_fn_router
from surfaces.marketing.public_site.router import router as public_site_fn_router
from surfaces.marketing.website.router import router as website_data_router

router = APIRouter()
router.include_router(health_router)
router.include_router(city_home_fn_router)
router.include_router(home_fn_router)
router.include_router(public_site_fn_router)
router.include_router(website_data_router)
