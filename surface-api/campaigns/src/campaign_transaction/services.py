"""Account association: a campaign transaction belongs to an XMP account (`account_id` ->
`accounts.id`).

Increment surface-spec/campaigns/campaigns-xmp-tables. Read through
`surfaces.xmp.exports`; for a list of transactions use `internal.get_accounts_for`. Tenant data:
only the service role reads it.
"""
from __future__ import annotations

from typing import Any

import psycopg

from surfaces.xmp.exports import AccountRef, get_account


def get_campaign_transaction_account(
    conn: psycopg.Connection, transaction: dict[str, Any]
) -> AccountRef | None:
    """The XMP account a campaign transaction row belongs to."""
    return get_account(conn, transaction["account_id"])
