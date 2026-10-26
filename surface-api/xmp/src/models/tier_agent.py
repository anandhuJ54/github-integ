"""`xmp.tier_agents`: a professional's profile inside an account's tier.

Column names match the existing profile data (including `specialties_backup` and
`listing_post_count`), so a data load maps 1:1. One live (not soft-deleted) profile per
(tier, user): a partial unique index.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.xmp.models.account import SCHEMA

if TYPE_CHECKING:
    from surfaces.xmp.models.account import Account
    from surfaces.xmp.models.tier import Tier


class TierAgent(IdMixin, TimestampMixin, Base):
    __tablename__ = "tier_agents"
    __table_args__ = (
        Index("ix_tier_agents_status_account_id", "status", "account_id"),
        Index(
            "uq_tier_agents_tier_id_user_id_live",
            "tier_id",
            "user_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": SCHEMA},
    )

    # Belongs to a tier.
    tier_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.tiers.id"), nullable=False, index=True
    )
    # Belongs to an account; older rows may have no account (NULL).
    account_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.accounts.id"), index=True
    )
    vertical_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.verticals.id"), index=True
    )
    # References to tables with no owner yet
    user_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    primary_category_id: Mapped[int | None] = mapped_column(Integer)

    # Identity
    uuid: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    iden: Mapped[str | None] = mapped_column(String(255), server_default="")
    slug: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    publish_name: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(255))
    salutation: Mapped[str | None] = mapped_column(String(255))
    suffix: Mapped[str | None] = mapped_column(String(255))
    tag_line: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    short_description: Mapped[str | None] = mapped_column(Text)
    year_started: Mapped[str | None] = mapped_column(String(255))
    npi: Mapped[str | None] = mapped_column(String(255))
    license: Mapped[str | None] = mapped_column(Text)
    legal_disclaimer: Mapped[str | None] = mapped_column(Text)
    zillow_nmls: Mapped[str | None] = mapped_column(Text)
    profile_type: Mapped[int | None] = mapped_column(Integer)  # enums.ProfileType

    # Lifecycle
    status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    previous_status: Mapped[int | None] = mapped_column(Integer)
    first_publish_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    # Flags: NOT NULL with a default; a data load coalesces NULL to the default.
    is_primary: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_manual_deactivated: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_swis_published: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    profile_url: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    have_pinned_partners: Mapped[bool | None] = mapped_column(Boolean)

    # Contact
    phone_number: Mapped[str | None] = mapped_column(String(255))
    phone_number_extension: Mapped[str | None] = mapped_column(String(255))
    phone_number_area_code: Mapped[str | None] = mapped_column(String(255))
    phone_number_country_code: Mapped[str | None] = mapped_column(String(255))
    mobile_number: Mapped[str | None] = mapped_column(String(255))
    mobile_number_extension: Mapped[str | None] = mapped_column(String(255))
    fax_number: Mapped[str | None] = mapped_column(String(255))
    fax_number_extension: Mapped[str | None] = mapped_column(String(255))
    custom_phone_number: Mapped[str | None] = mapped_column(String(255))
    custom_phone_number_extension: Mapped[str | None] = mapped_column(String(255))
    secondary_email: Mapped[str | None] = mapped_column(String(255))
    zipcode: Mapped[str | None] = mapped_column(String(255))
    local_time_zone: Mapped[str | None] = mapped_column(String(255))

    # Web
    website_url: Mapped[str | None] = mapped_column(Text)
    secondary_website_url: Mapped[str | None] = mapped_column(Text)
    custom_profile_link: Mapped[str | None] = mapped_column(Text)
    custom_website: Mapped[Any | None] = mapped_column(JSONB)

    # Media
    profile_photo: Mapped[str | None] = mapped_column(Text)
    logo_photo: Mapped[str | None] = mapped_column(Text)
    cover_photo: Mapped[str | None] = mapped_column(Text)
    gallery_photos: Mapped[Any | None] = mapped_column(JSONB)
    gallery_video: Mapped[Any | None] = mapped_column(JSONB)
    video: Mapped[Any | None] = mapped_column(JSONB)
    processed_image: Mapped[Any | None] = mapped_column(JSONB)

    # Profile content
    additional_category: Mapped[Any | None] = mapped_column(JSONB)
    position: Mapped[Any | None] = mapped_column(JSONB)
    hobbies: Mapped[Any | None] = mapped_column(JSONB)
    awards: Mapped[Any | None] = mapped_column(JSONB)
    memberships: Mapped[Any | None] = mapped_column(JSONB)
    achievements: Mapped[Any | None] = mapped_column(JSONB)
    specialties: Mapped[Any | None] = mapped_column(JSONB)
    specialties_backup: Mapped[Any | None] = mapped_column(JSONB)
    service_ids: Mapped[Any | None] = mapped_column(JSONB)
    payment_method: Mapped[Any | None] = mapped_column(JSONB)
    works_at: Mapped[Any | None] = mapped_column(JSONB)

    # Hours
    business_hours: Mapped[Any | None] = mapped_column(JSONB)
    special_hours: Mapped[Any | None] = mapped_column(JSONB)
    appointment_hours: Mapped[Any | None] = mapped_column(JSONB)
    drive_thru_hours: Mapped[Any | None] = mapped_column(JSONB)
    drive_thru_special_hours: Mapped[Any | None] = mapped_column(JSONB)

    # Settings and derived state
    extra_details: Mapped[Any | None] = mapped_column(JSONB)
    setting: Mapped[Any | None] = mapped_column(JSONB)
    inherited_details: Mapped[Any | None] = mapped_column(JSONB)
    onboarding_wizard: Mapped[Any | None] = mapped_column(JSONB)

    # Counters
    pinned_review_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), default=0)
    listing_post_count: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    post_write_ai_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), default=0)
    post_reply_ai_count: Mapped[int] = mapped_column(Integer, server_default=text("0"), default=0)

    tier: Mapped["Tier"] = relationship(back_populates="tier_agents")
    account: Mapped["Account | None"] = relationship()
