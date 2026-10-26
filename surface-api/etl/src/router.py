"""Aggregate router for the etl Surface.

The app mounts only this. Include new etl sub-routers here, not in app.py.

The disco worker routes (`/public/disco-*`, `/public/etl-deep-hydrate`,
`/public/export-prompt-bundles`) are the ports of the legacy `/api/public/*` handlers that
DB-side schedulers call over HTTP. Mounting them schedules nothing.
"""
from __future__ import annotations

from fastapi import APIRouter

from surfaces.etl.routers.console_data import router as console_data_router
from surfaces.etl.routers.disco_agent_mapper import router as disco_agent_mapper_router
from surfaces.etl.routers.disco_agent_probe import router as disco_agent_probe_router
from surfaces.etl.routers.disco_ai_worker import router as disco_ai_worker_router
from surfaces.etl.routers.disco_detail_api_worker import router as disco_detail_api_worker_router
from surfaces.etl.routers.disco_harvest_worker import router as disco_harvest_worker_router
from surfaces.etl.routers.disco_list_worker import router as disco_list_worker_router
from surfaces.etl.routers.disco_staging_backfill import router as disco_staging_backfill_router
from surfaces.etl.routers.disco_webscraper_worker import router as disco_webscraper_worker_router
from surfaces.etl.routers.etl_deep_hydrate import router as etl_deep_hydrate_router
from surfaces.etl.routers.export_prompt_bundles import router as export_prompt_bundles_router
from surfaces.etl.routers.health import router as health_router
from surfaces.etl.routers.platform import router as platform_router
from surfaces.etl.routers.run_monitor import router as run_monitor_router
from surfaces.etl.routers.site_proposal_fn import router as site_proposal_fn_router

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
router.include_router(etl_deep_hydrate_router)
router.include_router(export_prompt_bundles_router)
router.include_router(console_data_router)
router.include_router(platform_router)
router.include_router(run_monitor_router)
router.include_router(site_proposal_fn_router)
