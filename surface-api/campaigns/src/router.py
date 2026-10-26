"""Aggregate router for the campaigns Surface.

Enterprise review campaigns (/enterprise/$orgSlug/campaigns) moved here from xmp, surface audit
2026-10-25.

The app mounts only this. Include new campaigns sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.campaigns.health.router import router as health_router
from surfaces.campaigns.review_campaign.router import router as review_campaigns_router

router = APIRouter()
router.include_router(health_router)
router.include_router(review_campaigns_router)
