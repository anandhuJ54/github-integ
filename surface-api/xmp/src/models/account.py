"""`xmp.accounts`: an enterprise account.

Column names match the existing account data, so a data load maps 1:1. `vertical_id` is a foreign
key to `xmp.verticals`. References to tables no Surface owns yet (organizations, blueprints,
countries, ...) are plain bigints with no FK constraint.

Other Surfaces never import this class; they reference `xmp.accounts.id` through
`surfaces.xmp.exports.ACCOUNT_ID_FK`.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    false,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from surfaces.xmp.models.tier import Tier
    from surfaces.xmp.models.tier_agent import TierAgent

SCHEMA = "xmp"


class Account(IdMixin, TimestampMixin, Base):
    __tablename__ = "accounts"
    __table_args__ = ({"schema": SCHEMA},)

    # Belongs to a vertical.
    vertical_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.verticals.id"), nullable=False, index=True
    )
    # References to tables with no owner yet
    organization_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    blueprint_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    country_id: Mapped[int | None] = mapped_column(Integer)
    country_time_zone_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    primary_category_id: Mapped[int | None] = mapped_column(Integer)
    # Optional polymorphic link to the deactivation request (id + type).
    deactivated_request_id: Mapped[int | None] = mapped_column(BigInteger)
    deactivated_request_type: Mapped[str | None] = mapped_column(String(255))

    # Identity
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    uuid: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    slug: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    iden: Mapped[int | None] = mapped_column(Integer, index=True)

    # Lifecycle
    status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    previous_status: Mapped[int | None] = mapped_column(Integer)
    is_registration_complete: Mapped[int | None] = mapped_column(Integer)
    request_reason: Mapped[str | None] = mapped_column(Text)
    deactivate_request_reason: Mapped[str | None] = mapped_column(Text)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int | None] = mapped_column(Integer)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    # Flags: NOT NULL with a default; a data load coalesces NULL to the default.
    is_ingestion_proxy: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_exception: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_xmp: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_inspire_bundle: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)

    # Settings
    hierarchy: Mapped[Any | None] = mapped_column(JSONB)
    specialization_ids: Mapped[Any | None] = mapped_column(JSONB)
    service_ids: Mapped[Any | None] = mapped_column(JSONB)
    custom_date_format: Mapped[str | None] = mapped_column(String(255))
    app_date_format: Mapped[str | None] = mapped_column(String(255))

    # The account's tiers.
    tiers: Mapped[list["Tier"]] = relationship(back_populates="account")
    # The agents of all its tiers.
    tier_agents: Mapped[list["TierAgent"]] = relationship(
        secondary=f"{SCHEMA}.tiers",
        primaryjoin="Account.id == Tier.account_id",
        secondaryjoin="Tier.id == TierAgent.tier_id",
        viewonly=True,
    )
