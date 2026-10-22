"""Dev entry point for the backend.

Each Surface is a top-level Python package inside this project and exposes ONE aggregate
router (`<surface>/router.py`). The app mounts those per-Surface aggregates only — never a
Surface's internal sub-routers. A deployable service composes whichever Surfaces it ships;
this dev app mounts them all. Run from inside surface-api/:

    uv run uvicorn app:app --reload
"""
from __future__ import annotations

from _base.app_factory import create_app
from admin.router import router as admin_router
from campaigns.router import router as campaigns_router
from conversion_agents.router import router as conversion_agents_router
from etl.router import router as etl_router
from graph.router import router as graph_router
from marketing.router import router as marketing_router
from nora_os.router import router as nora_os_router
from ops.router import router as ops_router
from sales.router import router as sales_router
from search.router import router as search_router
from skills.router import router as skills_router
from srp.router import router as srp_router
from xmp.router import router as xmp_router

app = create_app(
    "api",
    routers=[
        sales_router,
        marketing_router,
        search_router,
        srp_router,
        xmp_router,
        campaigns_router,
        etl_router,
        graph_router,
        nora_os_router,
        skills_router,
        conversion_agents_router,
        admin_router,
        ops_router,
    ],
)
