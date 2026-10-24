"""sales catalog & pricing (S1) — replaces the direct supabase-js calls in surface-ui/sales
catalog-admin, cpq-catalog, cpq-depth, comp and the money part of @v3/ui console-surfaces."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/sales/catalog", tags=["sales"])
