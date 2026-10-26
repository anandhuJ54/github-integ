"""Helpers shared by two or more of the campaigns Surface's resource folders.

Private to campaigns, no endpoints.
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import psycopg

from surfaces.xmp.exports import AccountRef, get_accounts


def get_accounts_for(
    conn: psycopg.Connection, rows: Iterable[dict[str, Any]]
) -> dict[int, AccountRef]:
    """XMP accounts of many campaign or campaign transaction rows in one query, keyed by account id.

    Shared by the `campaign` and `campaign_transaction` resources (both belong to an XMP account).
    For a list: `accounts = get_accounts_for(conn, rows)`, then `accounts.get(row["account_id"])`;
    unknown and soft-deleted accounts are left out.
    """
    return get_accounts(conn, {row["account_id"] for row in rows})
