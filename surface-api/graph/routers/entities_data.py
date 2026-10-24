"""graph entity pages data — replaces the direct supabase-js calls in surface-ui/graph for
/control-graph, the /:category/:city/:professional page and the public /p|o|c/:slug/graph pages."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/graph", tags=["graph"])
