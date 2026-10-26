"""Global route table: each Surface's aggregate router (`<name>/src/router.py`), mounted once.

The app mounts those per-Surface aggregates only, never a Surface's resource routers. A deployable
service composes whichever Surfaces it ships; this dev app mounts them all.
"""
from __future__ import annotations

from surfaces.admin.router import router as admin
from surfaces.campaigns.router import router as campaigns
from surfaces.conversion_agents.router import router as conversion_agents
from surfaces.etl.router import router as etl
from surfaces.graph.router import router as graph
from surfaces.integrations.router import router as integrations
from surfaces.listings.router import router as listings
from surfaces.marketing.router import router as marketing
from surfaces.nora_os.router import router as nora_os
from surfaces.ops.router import router as ops
from surfaces.reports.router import router as reports
from surfaces.sales.router import router as sales
from surfaces.search.router import router as search
from surfaces.skills.router import router as skills
from surfaces.srp.router import router as srp
from surfaces.xmp.router import router as xmp

# Same order as app.surfaces.SURFACES.
ROUTERS = [
    sales,
    marketing,
    search,
    srp,
    xmp,
    campaigns,
    etl,
    graph,
    nora_os,
    skills,
    conversion_agents,
    admin,
    ops,
    integrations,
    reports,
    listings,
]
