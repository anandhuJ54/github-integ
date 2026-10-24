"""sales quotes, promo codes and price tiers (S1) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/sales-cpq.ts."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/sales/cpq", tags=["sales"])
