"""xmp enterprise, seat and dashboard data — replaces the direct supabase-js calls in
surface-ui/xmp (enterprise-xmp, seat, insurance-team, interview data, office mode, dashboard and
enterprise route files)."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/xmp", tags=["xmp"])
