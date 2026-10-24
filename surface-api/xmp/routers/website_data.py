"""xmp /website CMS data — replaces the direct supabase-js calls in surface-ui/xmp/src/lib/website.ts."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/xmp/website", tags=["xmp"])
