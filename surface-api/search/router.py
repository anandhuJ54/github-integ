"""Aggregate router for the search Surface.

The app mounts only this. Include new search sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from search.routers.console_data import router as console_data_router
from search.routers.engagement_fn import router as engagement_fn_router
from search.routers.health import router as health_router
from search.routers.public_search import router as public_search_router
from search.routers.search_assistant import router as search_assistant_router
from search.routers.search_presentation_fn import router as search_presentation_fn_router
from search.routers.site_indexing_fn import router as site_indexing_fn_router
from search.routers.voce import router as voce_router

router = APIRouter()
router.include_router(health_router)
router.include_router(search_presentation_fn_router)
router.include_router(site_indexing_fn_router)
router.include_router(search_assistant_router)
router.include_router(console_data_router)
router.include_router(public_search_router)
router.include_router(voce_router)
router.include_router(engagement_fn_router)
