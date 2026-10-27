"""Aggregate router for the srp Surface.

Public serving pages (profiles, geo, sitemaps, Trust Center reads) moved to search and the
city home / home / CMS page reads moved to marketing, surface audit 2026-10-25. The seat, NORA
interview and pro dashboard endpoints moved here from xmp, same audit.

The app mounts only this. Include new srp sub-routers here, not in app.py.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.srp.auth.router import router as auth_router
from surfaces.srp.claim_profile.router import router as claim_profile_router
from surfaces.srp.directory.router import router as directory_data_router
from surfaces.srp.health.router import router as health_router
from surfaces.srp.review.router import router as reviews_fn_router
from surfaces.srp.seat.router import router as seat_data_router

router = APIRouter()
router.include_router(health_router)
router.include_router(auth_router)  # local sign-in, off unless LOCAL_AUTH_ENABLED (srp/local-login-srp-home)
router.include_router(reviews_fn_router)
router.include_router(claim_profile_router)
router.include_router(seat_data_router)
router.include_router(directory_data_router)  # sales Directory drill-down data, surface audit 2026-10-25
