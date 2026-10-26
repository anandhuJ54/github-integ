"""xmp directory data for the sales Directory brand drill-down — the brand rollup behind
surface-ui/sales/src/lib/sales-nav.ts loadBrandRollup (used by /sales/brands/$orgId, and by
/sales/locations/$orgId too).

Moved from sales (/sales/nav/organizations/{id}/brand-rollup), surface audit 2026-10-25: the
data owner publishes it, the pages stay in sales. Same SQL, roles and responses. Runs as the
signed-in user, so RLS decides exactly as it did for the browser. Read-only.
"""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from xmp.queries import directory as q

router = APIRouter(prefix="/xmp/directory", tags=["xmp"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


@router.get("/brands/{org_id}/rollup")
def load_brand_rollup(org_id: str, claims: dict = Depends(current_user)) -> dict:
    """loadBrandRollup's rows: `{ locations, childCount, directCount, viaOfficesCount, claims }`
    (a failed count is null)."""
    return _read_with(claims, q.load_brand_rollup, org_id)
