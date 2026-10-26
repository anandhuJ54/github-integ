"""sales contracts (Module 4, S2) — replaces the direct supabase-js calls in
surface-ui/sales/src/lib/contracts.ts and the exp_contracts read in
routes/_authenticated/sales.quotes.$quoteId.tsx.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. A
function that made several reads gets them in one response, raw, and the browser still joins
them. Lifecycle writes go through the allow-listed m4_* functions (q.CONTRACT_RPCS); the actor
those functions record is the caller's email from the verified token (the browser sent its own
`auth.getUser()` email), never a request field. The two direct writes (special terms, marking a
notification read) are the browser's statements, `read_at` stamped by the server's clock.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import Field
from surfaces.sales.queries import contracts as q
from surfaces.sales.routers.cpq_data import _Body, _guard, _read_with, _write_with

from _base.auth import current_user
from _base.db import session as db

router = APIRouter(prefix="/sales/contracts", tags=["sales"])

# Static paths first: /{contract_id} would otherwise match them.


@router.get("")
def list_contracts(claims: dict = Depends(current_user)) -> dict:
    """listContracts: {contracts, orgs, activity, renewals} (the browser joins them)."""
    return _read_with(claims, q.list_contracts)


@router.get("/renewals")
def load_renewals(claims: dict = Depends(current_user)) -> dict:
    """loadRenewals: {renewals, contracts} (the browser joins them)."""
    return _read_with(claims, q.load_renewals)


@router.get("/by-quote/{quote_id}")
def quote_contract(quote_id: str, claims: dict = Depends(current_user)) -> list:
    """sales.quotes.$quoteId.tsx: [{id}] of the quote's latest contract, or []."""
    return _read_with(claims, q.quote_contract, quote_id)


@router.get("/notifications")
def load_notifications(limit: int = Query(20, ge=0), claims: dict = Depends(current_user)) -> list:
    """loadNotifications(limit)."""
    return _read_with(claims, q.load_notifications, limit)


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, claims: dict = Depends(current_user)) -> dict:
    """markNotificationRead: read_at = now (server clock)."""
    return _write_with(claims, q.mark_notification_read, notification_id)


@router.get("/skus")
def load_skus(claims: dict = Depends(current_user)) -> list:
    """loadSkus: the active order SKUs."""
    return _read_with(claims, q.load_skus)


class SalesContractsRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)


@router.post("/rpc/{name}")
def call_rpc(name: str, body: SalesContractsRpcArgs, claims: dict = Depends(current_user)) -> Any:
    """An allow-listed m4_* function (q.CONTRACT_RPCS) with the page's arguments; the actor
    parameter (q.ACTOR_PARAMS) is the caller's email."""
    actor = claims.get("email")
    try:
        q.rpc_sql(name, body.args, actor)  # refuse before leasing a connection
    except q.UnknownRpc as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    with db.role_connection("authenticated", claims, write=True) as conn:
        return _guard(q.call_rpc, conn, name, body.args, actor)


@router.get("/{contract_id}")
def get_contract(contract_id: str, claims: dict = Depends(current_user)) -> dict | None:
    """getContract: {contract, orgs, lineItems, versions, recipients, approvals, signatures,
    activity, documents, renewals}, or null when there is no such contract."""
    return _read_with(claims, q.get_contract, contract_id)


class SalesContractsSpecialTerms(_Body):
    special_terms: str | None


@router.patch("/{contract_id}")
def update_special_terms(contract_id: str, body: SalesContractsSpecialTerms,
                         claims: dict = Depends(current_user)) -> dict:
    """updateSpecialTerms: update({ special_terms }).eq("id", id)."""
    return _write_with(claims, q.update_special_terms, contract_id, body.special_terms)


@router.get("/{contract_id}/invoices")
def load_invoices(contract_id: str, claims: dict = Depends(current_user)) -> dict:
    """loadInvoices: {invoices, lines} (the browser attaches the lines)."""
    return _read_with(claims, q.load_invoices, contract_id)


@router.get("/{contract_id}/usage")
def load_usage(contract_id: str, claims: dict = Depends(current_user)) -> list:
    """loadUsage."""
    return _read_with(claims, q.load_usage, contract_id)
