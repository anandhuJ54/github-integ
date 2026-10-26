"""Aggregate router for the conversion_agents Surface.

The app mounts only this. Include new conversion_agents sub-routers here, not in app.py.

Surface audit 2026-10-25: the claim page moved to srp, the claims queue and PLG rules to admin,
the engagement functions to search and the site-proposal functions to etl. Only the health
router is left, pending a decision on this Surface.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.conversion_agents.health.router import router as health_router

router = APIRouter()
router.include_router(health_router)
