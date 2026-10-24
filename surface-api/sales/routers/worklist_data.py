"""sales worklist actions (S3) — replaces the direct supabase-js RPC calls in
surface-ui/sales/src/lib/worklist-actions.ts.

One endpoint per allow-listed function (q.WORKLIST_RPCS), run as the signed-in user with the
page's arguments, exactly as the browser called it through PostgREST. The functions are
SECURITY DEFINER and audit-log the actor themselves; nothing is filled in by the server.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field

from _base.core import db
from _base.core.auth import current_user
from sales.queries import worklist as q
from sales.queries.contracts import UnknownRpc
from sales.routers.cpq_data import _Body, _guard

router = APIRouter(prefix="/sales/worklist", tags=["sales"])


class SalesWorklistRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


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
