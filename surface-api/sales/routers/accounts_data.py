"""sales accounts (S2) — replaces the direct supabase-js calls in surface-ui/sales/src/lib/accounts.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
page still builds the hierarchy, the summaries and the tree from the rows (unchanged).
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import Field

from _base.core.auth import current_user
from sales.queries import accounts as q
from sales.routers.cpq_data import _Body, _read_with, _write_with

router = APIRouter(prefix="/sales/accounts", tags=["sales"])


@router.get("/list-rows")
def list_rows(claims: dict = Depends(current_user)) -> dict:
    """loadAccounts' reads: `{ orgs, pros, contracts }` (orgs and pros cut to 1000 rows, as
    PostgREST cut the page's limit(5000); follow-up 1j)."""
    return _read_with(claims, q.list_rows)


@router.get("/tree-rows")
def tree_rows(claims: dict = Depends(current_user)) -> dict:
    """loadAccount's reads: `{ orgs, pros, contracts }` (as above, more contract columns)."""
    return _read_with(claims, q.tree_rows)


class SalesAccountsNames(_Body):
    # one per root organization of at most 1000 organizations (the reads above are capped)
    names: list[str] = Field(max_length=1000)


@router.post("/discovered-counts")
def discovered_counts(body: SalesAccountsNames, claims: dict = Depends(current_user)) -> list:
    """The exp_entity display_name ilike %name% exact count for each name, in order (null when a
    count failed). A read; POST so the list fits."""
    return _read_with(claims, q.discovered_counts, body.names)


@router.get("/{account_id}/entitlements")
def entitlements(account_id: str, claims: dict = Depends(current_user)) -> dict:
    """loadEntitlements' rows: `{ products, entitlements }` (one round trip)."""
    return _read_with(claims, q.entitlements_bundle, account_id)


class SalesAccountsEntitlement(_Body):
    state: str
    tokens_included: int | None = None  # sent only when the page passes tokens


@router.put("/{account_id}/entitlements/{product_key}")
def set_entitlement(account_id: str, product_key: str, body: SalesAccountsEntitlement,
                    claims: dict = Depends(current_user)) -> dict:
    """setEntitlement: the organization's upsert, source "console"."""
    return _write_with(claims, q.set_entitlement, account_id, product_key, body.sent())


class SalesAccountsLoginAs(_Body):
    node_type: Literal["organization", "professional"]
    node_id: str
    node_name: str
    account_id: str


@router.post("/login-as")
def record_login_as(body: SalesAccountsLoginAs, claims: dict = Depends(current_user)) -> dict:
    """recordLoginAs: the audit_log row; actor_email is the signed-in user's, from the verified
    token (every caller passed the signed-in user's email). An insert error reaches the page,
    which threw it before."""
    return _write_with(claims, q.record_login_as, claims.get("email"), body.node_type,
                       body.node_id, body.node_name, body.account_id)
