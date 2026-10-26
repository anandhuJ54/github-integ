"""Public contract signing — port of the two supabase-js RPCs in
surface-ui/sales/src/routes/sign.$token.tsx: m4_signer_fetch (a pure read of the signature row
and its contract) and m4_record_signature (records the signature; may complete the contract).

Both are SECURITY DEFINER functions keyed by the signing token, which is the only credential:
they run as `anon` (the signer has no account), only through the public sign router. Nothing
else is callable there (SIGN_RPCS).
"""
from __future__ import annotations

from typing import Any

import psycopg
from surfaces.sales.queries.contracts import call, rpc_call

SIGN_RPCS: dict[str, list[tuple[str, str]]] = {
    "m4_signer_fetch": [("p_token", "text")],
    "m4_record_signature": [("p_token", "text"), ("p_type", "text"), ("p_data", "text"),
                            ("p_identity", "text"), ("p_ip", "text"), ("p_ua", "text")],
}


def signer_fetch_sql(token: str) -> tuple[str, dict[str, Any]]:
    return rpc_call(SIGN_RPCS, "m4_signer_fetch", {"p_token": token})


def record_signature_sql(args: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    return rpc_call(SIGN_RPCS, "m4_record_signature", args)


def signer_fetch(conn: psycopg.Connection, token: str) -> Any:
    """{signer, contract}, or {error: "invalid"} for an unknown token."""
    return call(conn, *signer_fetch_sql(token))


def record_signature(conn: psycopg.Connection, args: dict[str, Any]) -> Any:
    """{ok, remaining} / {ok, already} / {error: "invalid"}."""
    return call(conn, *record_signature_sql(args))
