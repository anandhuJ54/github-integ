"""srp directory data for the sales Directory drill-downs — the professional and organization
rows behind surface-ui/sales/src/lib/sales-nav.ts loadProfessional / loadOrg (used by the
/sales/professionals/$proId, /sales/locations/$orgId and /sales/brands/$orgId pages).

Moved from sales (/sales/nav/professionals/{id}, /sales/nav/organizations/{id}), surface audit
2026-10-25: the data owner publishes it, the pages stay in sales. Same SQL, roles and responses.
Runs as the signed-in user, so RLS decides exactly as it did for the browser. Read-only.
"""
from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.core import db
from _base.core.auth import current_user
from srp.queries import common
from srp.queries import directory as q

router = APIRouter(prefix="/srp/directory", tags=["srp"])


def _guard(fn, *args):
    try:
        return fn(*args)
    except common.MultipleRows as exc:  # PostgREST answered `.maybeSingle()` on 2+ rows with 406
        raise HTTPException(status.HTTP_406_NOT_ACCEPTABLE, str(exc)) from exc
    except psycopg.Error as exc:  # the database's message reaches the page (it threw it)
        msg = (exc.diag.message_primary if exc.diag else None) or str(exc) or "Request failed"
        refused = isinstance(exc, psycopg.errors.InsufficientPrivilege) or \
            "row-level security" in msg or "permission denied" in msg
        code = status.HTTP_403_FORBIDDEN if refused else status.HTTP_400_BAD_REQUEST
        raise HTTPException(code, msg) from exc


def _read_with(claims: dict, fn, *args):
    with db.role_connection("authenticated", claims) as conn:
        return _guard(fn, conn, *args)


@router.get("/organizations/{org_id}")
def load_org(org_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadOrg: the organization row, or null."""
    return _read_with(claims, q.load_org, org_id)


@router.get("/professionals/{pro_id}")
def load_professional(pro_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """loadProfessional: the professional row, or null."""
    return _read_with(claims, q.load_professional, pro_id)
