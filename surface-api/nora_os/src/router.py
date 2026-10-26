"""Aggregate router for the nora_os Surface.

The app mounts only this. Include new nora_os sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.nora_os.claim.router import router as claim_router
from surfaces.nora_os.health.router import router as health_router
from surfaces.nora_os.nora_runner.router import router as nora_runner_router

router = APIRouter()
router.include_router(health_router)
router.include_router(nora_runner_router)
router.include_router(claim_router)
