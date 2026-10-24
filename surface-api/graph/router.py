"""Aggregate router for the graph Surface.

The app mounts only this. Include new graph sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from graph.routers.categories_data import router as categories_data_router
from graph.routers.category_boundary_fn import router as category_boundary_fn_router
from graph.routers.category_brief_fn import router as category_brief_fn_router
from graph.routers.entities_data import router as entities_data_router
from graph.routers.expertise_schema_fn import router as expertise_schema_fn_router
from graph.routers.health import router as health_router
from graph.routers.schema_cache_fn import router as schema_cache_fn_router

router = APIRouter()
router.include_router(health_router)
router.include_router(category_boundary_fn_router)
router.include_router(category_brief_fn_router)
router.include_router(expertise_schema_fn_router)
router.include_router(schema_cache_fn_router)
router.include_router(categories_data_router)
router.include_router(entities_data_router)
