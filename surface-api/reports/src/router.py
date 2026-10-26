"""Aggregate router for the reports Surface.

The app mounts only this (`app/routes.py`). Include each resource's router here, once.
Scaffold only (2026-10-26): just the health router so far.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.reports.health.router import router as health_router

router = APIRouter()
router.include_router(health_router)
