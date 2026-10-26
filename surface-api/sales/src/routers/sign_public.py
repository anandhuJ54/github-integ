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
from pydantic import Field

from _base.db import session as db
from surfaces.sales.queries import sign as q
from surfaces.sales.routers.cpq_data import _Body, _guard

router = APIRouter(prefix="/sales/sign", tags=["sales"])


class SalesSignFetch(_Body):
    token: str = Field(min_length=1, max_length=512)


@router.post("/fetch")
def signer_fetch(body: SalesSignFetch) -> Any:
    """m4_signer_fetch(p_token): {signer, contract}, or {error: "invalid"}. A pure read."""
    with db.role_connection("anon") as conn:
        return _guard(q.signer_fetch, conn, body.token)


class SalesSignRecord(_Body):
    """m4_record_signature's arguments, as the page sent them."""
    token: str = Field(min_length=1, max_length=512)
    type: str | None = Field(max_length=100)
    data: str | None = Field(max_length=10_000)
    identity: str | None = Field(max_length=100)
    ip: str | None = Field(max_length=100)
    ua: str | None = Field(max_length=2_000)


@router.post("/record")
def record_signature(body: SalesSignRecord) -> Any:
    """m4_record_signature: {ok, remaining} / {ok, already} / {error: "invalid"}."""
    args = {"p_token": body.token, "p_type": body.type, "p_data": body.data,
            "p_identity": body.identity, "p_ip": body.ip, "p_ua": body.ua}
    with db.role_connection("anon", write=True) as conn:
        return _guard(q.record_signature, conn, args)
