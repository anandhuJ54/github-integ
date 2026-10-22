"""Dev entry point for the backend.

Surfaces are now proper Python packages (`api.sales`, `api.campaigns`, ...), so routers
import cleanly — no path hacks. A service composes whichever Surfaces it ships; this dev
app mounts them all. Run from the repo root:

    uv run uvicorn app:app --reload
"""
from __future__ import annotations

from _base.app_factory import create_app
from sales.routers.health import router as sales_router

app = create_app(
    "api",
    routers=[
        sales_router,
        # add more as Surfaces grow, e.g.
        # from campaigns.routers.auto_reply import router as campaigns_router
    ],
)
