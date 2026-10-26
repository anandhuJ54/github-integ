"""Aggregate router for the etl Surface.

The app mounts only this. Include each resource's router here (no endpoints), not in app.py.

The disco worker routes (`/public/disco-*`, `/public/etl-deep-hydrate`,
`/public/export-prompt-bundles`) are the ports of the legacy `/api/public/*` handlers that
DB-side schedulers call over HTTP. Mounting them schedules nothing.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.etl.console.router import router as console_router
from surfaces.etl.deep_hydrate.router import router as deep_hydrate_router
from surfaces.etl.disco_agent_mapper.router import router as disco_agent_mapper_router
from surfaces.etl.disco_agent_probe.router import router as disco_agent_probe_router
from surfaces.etl.disco_ai_worker.router import router as disco_ai_worker_router
from surfaces.etl.disco_detail_api_worker.router import router as disco_detail_api_worker_router
from surfaces.etl.disco_harvest_worker.router import router as disco_harvest_worker_router
from surfaces.etl.disco_list_worker.router import router as disco_list_worker_router
from surfaces.etl.disco_staging_backfill.router import router as disco_staging_backfill_router
from surfaces.etl.disco_webscraper_worker.router import router as disco_webscraper_worker_router
from surfaces.etl.export_prompt_bundle.router import router as export_prompt_bundle_router
from surfaces.etl.health.router import router as health_router
from surfaces.etl.platform.router import router as platform_router
from surfaces.etl.run_monitor.router import router as run_monitor_router
from surfaces.etl.site_proposal.router import router as site_proposal_router

router = APIRouter()
router.include_router(health_router)
router.include_router(disco_agent_mapper_router)
router.include_router(disco_agent_probe_router)
router.include_router(disco_ai_worker_router)
router.include_router(disco_list_worker_router)
router.include_router(disco_detail_api_worker_router)
router.include_router(disco_harvest_worker_router)
router.include_router(disco_staging_backfill_router)
router.include_router(disco_webscraper_worker_router)
router.include_router(deep_hydrate_router)
router.include_router(export_prompt_bundle_router)
router.include_router(console_router)
router.include_router(platform_router)
router.include_router(run_monitor_router)
router.include_router(site_proposal_router)
