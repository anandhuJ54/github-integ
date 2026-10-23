"""Aggregate router for the srp Surface.

The app mounts only this. Include new srp sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from srp.routers.city_home_fn import router as city_home_fn_router
from srp.routers.geo_fn import router as geo_fn_router
from srp.routers.health import router as health_router
from srp.routers.home_fn import router as home_fn_router
from srp.routers.public_profile import router as public_profile_router
from srp.routers.public_site_fn import router as public_site_fn_router
from srp.routers.reviews_fn import router as reviews_fn_router
from srp.routers.sitemap import router as sitemap_router

router = APIRouter()
router.include_router(health_router)
router.include_router(city_home_fn_router)
router.include_router(home_fn_router)
router.include_router(public_site_fn_router)
router.include_router(reviews_fn_router)
router.include_router(geo_fn_router)
router.include_router(sitemap_router)
router.include_router(public_profile_router)
