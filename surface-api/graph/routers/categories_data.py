"""graph /categories pages data — replaces the direct supabase-js calls in
surface-ui/graph (categories index, category detail and its tabs, listings catalog)."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/graph/categories", tags=["graph"])
