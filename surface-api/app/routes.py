"""Global route table: each Surface's aggregate router (`<name>/src/router.py`), mounted once.

The app mounts those per-Surface aggregates only, never a Surface's resource routers. A deployable
service composes whichever Surfaces it ships; this dev app mounts them all.
"""
from __future__ import annotations

from admin.router import router as admin
from campaigns.router import router as campaigns
from conversion_agents.router import router as conversion_agents
from etl.router import router as etl
from graph.router import router as graph
from marketing.router import router as marketing
from nora_os.router import router as nora_os
from ops.router import router as ops
from sales.router import router as sales
from search.router import router as search
from skills.router import router as skills
from srp.router import router as srp
from xmp.router import router as xmp

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
]
