"""Aggregate router for the nora_os Surface.

The app mounts only this. Include new nora_os sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from nora_os.routers.claim_fn import router as claim_fn_router
from nora_os.routers.health import router as health_router
from nora_os.routers.nora_runner_fn import router as nora_runner_fn_router

router = APIRouter()
router.include_router(health_router)
router.include_router(nora_runner_fn_router)
router.include_router(claim_fn_router)
