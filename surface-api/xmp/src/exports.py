"""Public interface of the xmp Surface: the ONLY module other Surfaces may import.

Only xmp reads and writes the tables in its schema; another Surface goes through the functions
here (AGENTS.md §2). Read functions, plain shapes and foreign-key targets for the XMP tables
(`surfaces.xmp.models`); increment surface-spec/campaigns/campaigns-xmp-tables.

Each function takes the caller's psycopg connection, so the caller's role and its grants apply:
`verticals` is readable by any signed-in user, the tenant tables (accounts, tiers, tier_agents) only
by the service role. Soft-deleted rows (`deleted_at` set) are not returned. Another Surface points
a foreign key at these tables with the `*_ID_FK` constants (its ORM class) and in its migration,
which declares `depends_on` this Surface's revision:

    from surfaces.xmp.exports import ACCOUNT_ID_FK
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ACCOUNT_ID_FK), nullable=False)

No sign-in or account-membership check here: Supabase sign-in is the auth boundary, and how a
Supabase user maps to an `xmp.users` row is not decided yet.
"""
from __future__ import annotations

from collections.abc import Iterable

import psycopg
from pydantic import BaseModel
from sqlalchemy import select

from _base.db.sql import fetch_all, fetch_one
from surfaces.xmp.models import Account, Tier, TierAgent, Vertical

__all__ = [
    "ACCOUNT_ID_FK",
    "ALL_VERTICALS_NAME",
    "TIER_AGENT_ID_FK",
    "TIER_ID_FK",
    "VERTICAL_ID_FK",
    "AccountRef",
    "TierAgentRef",
    "TierRef",
    "VerticalRef",
    "get_account",
    "get_accounts",
    "get_all_vertical",
    "get_tier",
    "get_tier_agent",
    "get_vertical",
]

ACCOUNT_ID_FK = "xmp.accounts.id"
TIER_ID_FK = "xmp.tiers.id"
TIER_AGENT_ID_FK = "xmp.tier_agents.id"
VERTICAL_ID_FK = "xmp.verticals.id"

# The vertical whose name is "All" stands for every vertical: something linked to it applies to
# all verticals.
ALL_VERTICALS_NAME = "All"


class AccountRef(BaseModel):
    id: int
    organization_id: int
    name: str
    slug: str | None
    status: int | None


class VerticalRef(BaseModel):
    id: int
    name: str
    status: int | None


class TierRef(BaseModel):
    id: int
    account_id: int
    name: str
    parent: int
    status: int | None


class TierAgentRef(BaseModel):
    id: int
    account_id: int | None
    tier_id: int
    user_id: int
    publish_name: str | None
    status: int | None


def _columns(model, ref: type[BaseModel]) -> list:
    """The model's columns the ref shape needs."""
    return [getattr(model, name) for name in ref.model_fields]


def get_account(conn: psycopg.Connection, account_id: int) -> AccountRef | None:
    row = fetch_one(conn, select(*_columns(Account, AccountRef))
                    .where(Account.id == account_id, Account.deleted_at.is_(None)))
    return AccountRef.model_validate(row) if row else None


def get_accounts(conn: psycopg.Connection, account_ids: Iterable[int]) -> dict[int, AccountRef]:
    """Batch `get_account` for a list: one query, keyed by id. Unknown and soft-deleted ids are
    left out."""
    ids = set(account_ids)
    if not ids:
        return {}
    rows = fetch_all(conn, select(*_columns(Account, AccountRef))
                     .where(Account.id.in_(ids), Account.deleted_at.is_(None)), max_rows=None)
    return {r["id"]: AccountRef.model_validate(r) for r in rows}


def get_vertical(conn: psycopg.Connection, vertical_id: int) -> VerticalRef | None:
    row = fetch_one(conn, select(*_columns(Vertical, VerticalRef))
                    .where(Vertical.id == vertical_id))
    return VerticalRef.model_validate(row) if row else None


def get_all_vertical(conn: psycopg.Connection) -> VerticalRef | None:
    """The "All" vertical (see `ALL_VERTICALS_NAME`), or None if there is none.

    If several are named "All", the lowest id wins.
    """
    row = fetch_one(conn, select(*_columns(Vertical, VerticalRef))
                    .where(Vertical.name == ALL_VERTICALS_NAME).order_by(Vertical.id).limit(1))
    return VerticalRef.model_validate(row) if row else None


def get_tier(conn: psycopg.Connection, tier_id: int) -> TierRef | None:
    row = fetch_one(conn, select(*_columns(Tier, TierRef))
                    .where(Tier.id == tier_id, Tier.deleted_at.is_(None)))
    return TierRef.model_validate(row) if row else None


def get_tier_agent(conn: psycopg.Connection, tier_agent_id: int) -> TierAgentRef | None:
    row = fetch_one(conn, select(*_columns(TierAgent, TierAgentRef))
                    .where(TierAgent.id == tier_agent_id, TierAgent.deleted_at.is_(None)))
    return TierAgentRef.model_validate(row) if row else None
