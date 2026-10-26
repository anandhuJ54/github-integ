"""GET /etl/run-monitor — the console's live ETL run monitor (read-only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from _base.auth import current_user
from _base.db import session as db
from surfaces.etl.run_monitor.schemas import EtlMonitor
from surfaces.etl.run_monitor.services import load_etl_monitor

router = APIRouter(prefix="/etl", tags=["etl"])


@router.get("/run-monitor", response_model=EtlMonitor, response_model_by_alias=True)
def etl_monitor(claims: dict = Depends(current_user)) -> dict:
    with db.role_connection("authenticated", claims) as conn:
        return load_etl_monitor(conn)
