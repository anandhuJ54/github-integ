"""Account association: a campaign belongs to an XMP account (`account_id` -> `accounts.id`).

Increment surface-spec/campaigns/campaigns-xmp-tables. The account is read through `surfaces.xmp.exports` and comes back as an `AccountRef` (None when unknown or soft-deleted).
For a list of campaigns use `internal.get_accounts_for`. Tenant data: only the service role reads it.
"""
from __future__ import annotations

from typing import Any

import psycopg

from surfaces.xmp.exports import AccountRef, get_account


def get_campaign_account(conn: psycopg.Connection, campaign: dict[str, Any]) -> AccountRef | None:
    """The XMP account a campaign row belongs to."""
    return get_account(conn, campaign["account_id"])
