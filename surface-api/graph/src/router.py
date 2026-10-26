"""Aggregate router for the graph Surface.

getCachedSchema / cacheSchema and the profile page reads moved to search, surface audit 2026-10-25.

The app mounts only this. Include new graph sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.graph.category.router import router as categories_data_router
from surfaces.graph.category_boundary.router import router as category_boundary_fn_router
from surfaces.graph.category_brief.router import router as category_brief_fn_router
from surfaces.graph.entity.router import router as entities_data_router
from surfaces.graph.expertise_schema.router import router as expertise_schema_fn_router
from surfaces.graph.health.router import router as health_router

router = APIRouter()
router.include_router(health_router)
router.include_router(category_boundary_fn_router)
router.include_router(category_brief_fn_router)
router.include_router(expertise_schema_fn_router)
router.include_router(categories_data_router)
router.include_router(entities_data_router)
