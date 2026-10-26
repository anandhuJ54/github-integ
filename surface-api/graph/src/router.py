"""Aggregate router for the graph Surface.

getCachedSchema / cacheSchema and the profile page reads moved to search, surface audit 2026-10-25.

The app mounts only this. Include new graph sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.graph.routers.categories_data import router as categories_data_router
from surfaces.graph.routers.category_boundary_fn import router as category_boundary_fn_router
from surfaces.graph.routers.category_brief_fn import router as category_brief_fn_router
from surfaces.graph.routers.entities_data import router as entities_data_router
from surfaces.graph.routers.expertise_schema_fn import router as expertise_schema_fn_router
from surfaces.graph.routers.health import router as health_router

router = APIRouter()
router.include_router(health_router)
router.include_router(category_boundary_fn_router)
router.include_router(category_brief_fn_router)
router.include_router(expertise_schema_fn_router)
router.include_router(categories_data_router)
router.include_router(entities_data_router)
