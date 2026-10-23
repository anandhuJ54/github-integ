"""Aggregate router for the conversion_agents Surface.

The app mounts only this. Include new conversion_agents sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from conversion_agents.routers.engagement_fn import router as engagement_fn_router
from conversion_agents.routers.health import router as health_router
from conversion_agents.routers.site_proposal_fn import router as site_proposal_fn_router

router = APIRouter()
router.include_router(health_router)
router.include_router(engagement_fn_router)
router.include_router(site_proposal_fn_router)
