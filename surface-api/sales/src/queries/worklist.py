"""sales worklist actions (S3) — port of the supabase-js calls in
surface-ui/sales/src/lib/worklist-actions.ts: three governed RPCs (exp_claim_set_contact,
exp_claim_queue_verification, exp_opp_create), nothing else.

Each runs as the signed-in user, exactly as the browser called it: same function, same named
arguments, each cast to the function's own parameter type (pg_proc), the value PostgREST-shaped.
All three are SECURITY DEFINER and audit-log the actor themselves. `p_owner` of exp_opp_create
stays a request argument: the one caller passes the page's `ownerId`, not `auth.getUser()`.
"""
from __future__ import annotations

from typing import Any

import psycopg
from surfaces.sales.queries.contracts import call, rpc_call

# name → [(param, db type)], in the function's order (pg_get_function_identity_arguments, read
# at port time). All SECURITY DEFINER, search_path pinned to public.
WORKLIST_RPCS: dict[str, list[tuple[str, str]]] = {
    # p_claimed_override has DEFAULT false; the browser always sends it
    "exp_claim_set_contact": [("p_event", "uuid"), ("p_phone", "text"), ("p_email", "text"),
                              ("p_claimed_override", "boolean")],
    # enqueues pending rows in exp_verification_requests; nothing is sent
    "exp_claim_queue_verification": [("p_events", "uuid[]")],
    # one open opportunity per logo: the existing open one or a new one
    "exp_opp_create": [("p_org_id", "uuid"), ("p_account_id", "uuid"), ("p_owner", "text"),
                       ("p_source", "text")],
}


def rpc_sql(name: str, args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """A WORKLIST_RPCS call with the page's arguments (no server-filled ones)."""
    return rpc_call(WORKLIST_RPCS, name, args)


def call_rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    sql, params = rpc_sql(name, args)
    return call(conn, sql, params)
