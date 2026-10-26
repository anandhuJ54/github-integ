"""`xmp.tiers`: one level of an account's private hierarchy (HQ / Region / Branch).

The hierarchy is an adjacency list: `parent` is the parent tier id, and `ROOT_TIER_PARENT` (0) for
the account's root tier, so it cannot be a foreign key.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.xmp.models.account import SCHEMA

if TYPE_CHECKING:
    from surfaces.xmp.models.account import Account
    from surfaces.xmp.models.tier_agent import TierAgent


class Tier(IdMixin, TimestampMixin, Base):
    __tablename__ = "tiers"
    __table_args__ = (
        # one store id per account
        UniqueConstraint("account_id", "store_id"),
        {"schema": SCHEMA},
    )

    # Belongs to an account.
    account_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.accounts.id"), nullable=False, index=True
    )
    # `tier_categories` has no owner yet (see enums.TierCategory), so this is a plain bigint.
    tier_category_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)

    # Identity
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    iden: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    uuid: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    slug: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    label: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    store_id: Mapped[str | None] = mapped_column(String(255))

    # Hierarchy
    parent: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    depth: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    child_count: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    ordering: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)
    users_count: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))

    # Lifecycle
    status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    previous_status: Mapped[int | None] = mapped_column(Integer)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    account: Mapped["Account"] = relationship(back_populates="tiers")
    # Agents whose home tier is this one (`tier_agents.tier_id`). Agents mapped to several tiers
    # (`agent_mappings`) are not covered: that table has no owner yet.
    tier_agents: Mapped[list["TierAgent"]] = relationship(back_populates="tier")
