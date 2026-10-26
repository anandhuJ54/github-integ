"""admin accounts (S2) — replaces the direct supabase-js calls in surface-ui/admin/src/lib/accounts.ts.

Every endpoint runs as the signed-in user, so RLS decides exactly as it did for the browser. The
page still builds the hierarchy, the summaries and the tree from the rows (unchanged).

Moved from sales (/sales/accounts/*, sales/routers/accounts_data.py), surface audit 2026-10-25;
same SQL, roles and responses. The UI URLs (/accounts, /accounts/$accountId) are unchanged. The
request helpers below are copied from sales/routers/cpq_data.py (no cross-Surface import).
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.admin.account import services as q
from surfaces.admin.account.schemas import (
    AdminAccountsEntitlement,
    AdminAccountsLoginAs,
    AdminAccountsNames,
)

router = APIRouter(prefix="/admin/accounts", tags=["admin"])


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


def _write_with(claims: dict, fn, *args) -> Any:
    with db.role_connection("authenticated", claims, write=True) as conn:
        out = _guard(fn, conn, *args)
    return {"ok": True} if out is None else out


@router.get("/list-rows")
def list_rows(claims: dict = Depends(current_user)) -> dict:
    """loadAccounts' reads: `{ orgs, pros, contracts }` (orgs and pros cut to 1000 rows, as
    PostgREST cut the page's limit(5000); follow-up 1j)."""
    return _read_with(claims, q.list_rows)


@router.get("/tree-rows")
def tree_rows(claims: dict = Depends(current_user)) -> dict:
    """loadAccount's reads: `{ orgs, pros, contracts }` (as above, more contract columns)."""
    return _read_with(claims, q.tree_rows)


@router.post("/discovered-counts")
def discovered_counts(body: AdminAccountsNames, claims: dict = Depends(current_user)) -> list:
    """The exp_entity display_name ilike %name% exact count for each name, in order (null when a
    count failed). A read; POST so the list fits."""
    return _read_with(claims, q.discovered_counts, body.names)


@router.get("/{account_id}/entitlements")
def entitlements(account_id: str, claims: dict = Depends(current_user)) -> dict:
    """loadEntitlements' rows: `{ products, entitlements }` (one round trip)."""
    return _read_with(claims, q.entitlements_bundle, account_id)


@router.put("/{account_id}/entitlements/{product_key}")
def set_entitlement(account_id: str, product_key: str, body: AdminAccountsEntitlement,
                    claims: dict = Depends(current_user)) -> dict:
    """setEntitlement: the organization's upsert, source "console"."""
    return _write_with(claims, q.set_entitlement, account_id, product_key, body.sent())


@router.post("/login-as")
def record_login_as(body: AdminAccountsLoginAs, claims: dict = Depends(current_user)) -> dict:
    """recordLoginAs: the audit_log row; actor_email is the signed-in user's, from the verified
    token (every caller passed the signed-in user's email). An insert error reaches the page,
    which threw it before."""
    return _write_with(claims, q.record_login_as, claims.get("email"), body.node_type,
                       body.node_id, body.node_name, body.account_id)
