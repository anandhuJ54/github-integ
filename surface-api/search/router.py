"""Aggregate router for the search Surface.

The search console router, setSiteIndexing and the VOCE boost write moved to admin,
surface audit 2026-10-25. Public profiles, geo, sitemaps / robots.txt and the Trust Center
reads moved here from srp, same audit. The long-form profile page's reads (/graph/profile*) and
getCachedSchema / cacheSchema moved here from graph, same audit.

The app mounts only this. Include new search sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from search.routers.engagement_fn import router as engagement_fn_router
from search.routers.geo import router as geo_router
from search.routers.geo_fn import router as geo_fn_router
from search.routers.health import router as health_router
from search.routers.profile_page import router as profile_page_router
from search.routers.public_profile import router as public_profile_router
from search.routers.public_search import router as public_search_router
from search.routers.public_site_fn import router as public_site_fn_router
from search.routers.schema_cache_fn import router as schema_cache_fn_router
from search.routers.search_assistant import router as search_assistant_router
from search.routers.search_presentation_fn import router as search_presentation_fn_router
from search.routers.site_indexing_fn import router as site_indexing_fn_router
from search.routers.sitemap import router as sitemap_router
from search.routers.voce import router as voce_router

router = APIRouter()
router.include_router(health_router)
router.include_router(search_presentation_fn_router)
router.include_router(site_indexing_fn_router)
router.include_router(search_assistant_router)
router.include_router(public_search_router)
router.include_router(voce_router)
router.include_router(engagement_fn_router)
router.include_router(public_site_fn_router)
router.include_router(geo_fn_router)
router.include_router(sitemap_router)
router.include_router(public_profile_router)
router.include_router(geo_router)
router.include_router(profile_page_router)
router.include_router(schema_cache_fn_router)
