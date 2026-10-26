"""Platform counters for the console surfaces — replaces the `countOf(...)` head counts and the
disco_jobs list in surface-ui/_base/src/lib/console-surfaces.ts (loadReportMetrics, loadNoraOs,
loadOrgStats). Runs as the signed-in user, so RLS decides what is counted, as it did for the
browser. Reads only."""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from surfaces.etl.queries import platform as q

from _base.auth import current_user
from _base.db import session as db

router = APIRouter(prefix="/etl/platform", tags=["etl"])


def _read(claims: dict, fn):
    with db.role_connection("authenticated", claims) as conn:
        try:
            return fn(conn)
        except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
            msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
            refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
                "permission denied" in msg or "row-level security" in msg
            code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
            raise HTTPException(code, msg) from exc


@router.get("/report-metrics")
def report_metrics(claims: dict = Depends(current_user)) -> dict:
    """loadReportMetrics: fourteen exact counts, keyed as the page returns them."""
    return _read(claims, q.report_metrics)


@router.get("/pipeline-health")
def nora_os(claims: dict = Depends(current_user)) -> dict:
    """loadNoraOs's reads: `{ jobs, counts: { proposals, llm, siteContracts, engineRequests,
    engineSnapshots, enginePrompts } }`. The page derives byStatus / byStep / lastTick."""
    return _read(claims, q.nora_os)


@router.get("/org-stats")
def org_stats(claims: dict = Depends(current_user)) -> dict:
    """loadOrgStats: six exact organizations counts."""
    return _read(claims, q.org_stats)
