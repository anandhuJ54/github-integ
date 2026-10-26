"""sales worklist actions (S3) — replaces the direct supabase-js RPC calls in
surface-ui/sales/src/lib/worklist-actions.ts.

One endpoint per allow-listed function (q.WORKLIST_RPCS), run as the signed-in user with the
page's arguments, exactly as the browser called it through PostgREST. The functions are
SECURITY DEFINER and audit-log the actor themselves; nothing is filled in by the server.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.sales.internal import UnknownRpc, _guard
from surfaces.sales.worklist import services as q
from surfaces.sales.worklist.schemas import (
    SalesWorklistRpcArgs,
)

router = APIRouter(prefix="/sales/worklist", tags=["sales"])


@router.post("/rpc/{name}")
def call_rpc(name: str, body: SalesWorklistRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """setClaimContact (exp_claim_set_contact), queueVerification (exp_claim_queue_verification),
    createOpportunity (exp_opp_create): the function's value, PostgREST-shaped."""
    try:
        q.rpc_sql(name, body.args)  # refuse before leasing a connection
    except UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args)
