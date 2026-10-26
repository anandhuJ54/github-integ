"""Aggregate router for the search Surface.

The search console router, setSiteIndexing and the VOCE boost write moved to admin,
surface audit 2026-10-25. Public profiles, geo, sitemaps / robots.txt and the Trust Center
reads moved here from srp, same audit. The long-form profile page's reads (/graph/profile*) and
getCachedSchema / cacheSchema moved here from graph, same audit.

The app mounts only this. Include each resource folder's router here (one include per
router), not in app.py. No endpoints here.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.search.engagement.router import router as engagement_fn_router
from surfaces.search.geo.fn_router import router as geo_fn_router
from surfaces.search.geo.router import router as geo_router
from surfaces.search.health.router import router as health_router
from surfaces.search.profile_page.router import router as profile_page_router
from surfaces.search.public_profile.router import router as public_profile_router
from surfaces.search.public_search.router import router as public_search_router
from surfaces.search.public_site.router import router as public_site_fn_router
from surfaces.search.schema_cache.router import router as schema_cache_fn_router
from surfaces.search.search_assistant.router import router as search_assistant_router
from surfaces.search.search_presentation.router import router as search_presentation_fn_router
from surfaces.search.site_indexing.router import router as site_indexing_fn_router
from surfaces.search.sitemap.router import router as sitemap_router
from surfaces.search.voce.router import router as voce_router

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
