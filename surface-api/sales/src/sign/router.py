"""Public contract signing (S2) — replaces the two supabase-js RPCs in
surface-ui/sales/src/routes/sign.$token.tsx.

No sign-in: the signer only has the link, and its token is the credential. Both endpoints run
as `anon` whatever the caller sends (a signed-in browser's token is ignored), and only the two
functions in q.SIGN_RPCS are reachable. The token travels in the JSON body, not the URL, so it
stays out of access logs. As in the browser, the database's message reaches the page.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from _base.db import session as db
from surfaces.sales.internal import _guard
from surfaces.sales.sign import services as q
from surfaces.sales.sign.schemas import (
    SalesSignFetch,
    SalesSignRecord,
)

router = APIRouter(prefix="/sales/sign", tags=["sales"])


@router.post("/fetch")
def signer_fetch(body: SalesSignFetch) -> Any:
    """m4_signer_fetch(p_token): {signer, contract}, or {error: "invalid"}. A pure read."""
    with db.role_connection("anon") as conn:
        return _guard(q.signer_fetch, conn, body.token)


@router.post("/record")
def record_signature(body: SalesSignRecord) -> Any:
    """m4_record_signature: {ok, remaining} / {ok, already} / {error: "invalid"}."""
    args = {"p_token": body.token, "p_type": body.type, "p_data": body.data,
            "p_identity": body.identity, "p_ip": body.ip, "p_ua": body.ua}
    with db.role_connection("anon", write=True) as conn:
        return _guard(q.record_signature, conn, args)
