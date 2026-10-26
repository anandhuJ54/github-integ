"""`xmp.users`: a person in an account.

Column names match the existing user data, so a data load maps 1:1. `password_digest` is a bcrypt
hash. References to tables no Surface owns yet (organizations, states, countries) are plain bigints.

Nothing signs in with it: Supabase sign-in is the auth boundary, and how a Supabase user maps to a
row here is not decided (identity registry). Other Surfaces never import this class.
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
    false,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.xmp.models.account import SCHEMA

if TYPE_CHECKING:
    from surfaces.xmp.models.account_user import AccountUser


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        # one live (not soft-deleted) user per email, case-insensitive
        Index(
            "uq_users_lower_email_live",
            func.lower(text("email")),
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": SCHEMA},
    )

    # References
    organization_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    account_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.accounts.id"), index=True
    )
    state_id: Mapped[int | None] = mapped_column(BigInteger, index=True)
    country_id: Mapped[int | None] = mapped_column(BigInteger, index=True)

    # Identity
    iden: Mapped[int | None] = mapped_column(BigInteger, index=True)
    uuid: Mapped[str | None] = mapped_column(String(255), server_default="", index=True)
    i5id: Mapped[str | None] = mapped_column(String(255))
    employee_id: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    last_name: Mapped[str | None] = mapped_column(String(255), index=True)
    label: Mapped[str | None] = mapped_column(String(255))
    profile_photo: Mapped[str | None] = mapped_column(String(255))
    resource: Mapped[int] = mapped_column(Integer, server_default=text("0"), default=0)
    resource_email: Mapped[str | None] = mapped_column(String(255))

    # Credentials and login
    password_digest: Mapped[str] = mapped_column(String(255), nullable=False)
    is_password_updated: Mapped[bool | None] = mapped_column(Boolean)
    force_password_sent: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    reset_password_token: Mapped[str | None] = mapped_column(String(255))
    reset_password_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    num_logins: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    num_logouts: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_logout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip_address: Mapped[str | None] = mapped_column(String(255))

    # Lifecycle
    status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    previous_status: Mapped[int | None] = mapped_column(Integer)
    is_manual_deactivated: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_xmp: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    license_agreement_checked: Mapped[int | None] = mapped_column(Integer)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    # Email verification
    unverified_email: Mapped[str | None] = mapped_column(String(255))
    verification_token: Mapped[str | None] = mapped_column(String(255))
    verification_token_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_link_clicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_verification_email_count: Mapped[int | None] = mapped_column(Integer)
    recovery_email: Mapped[str | None] = mapped_column(String(255))
    recovery_email_verification_status: Mapped[int | None] = mapped_column(Integer)
    recovery_email_verification_token: Mapped[str | None] = mapped_column(String(255))
    recovery_verification_token_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recovery_verification_link_clicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Contact
    phone_number: Mapped[str | None] = mapped_column(String(255))
    phone_number_extension: Mapped[str | None] = mapped_column(String(255))
    address_line_1: Mapped[str | None] = mapped_column(String(255))
    address_line_2: Mapped[str | None] = mapped_column(String(255))
    address_line_3: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(255))
    postal_index_code: Mapped[int | None] = mapped_column(Integer)
    opt_in: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=true(), default=True)

    # Roles cache: account / tier ids the user manages
    user_privilege: Mapped[Any | None] = mapped_column(JSONB)
    referral_requested_count: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    draft: Mapped[Any | None] = mapped_column(JSONB)

    # UI flags: NOT NULL with a default; a data load coalesces NULL to the default.
    hide_banner: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    take_tour: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    top_five: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    learning_center_blink: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    category_popup: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    voce_dashboard_popup: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    voce_ai_visibility_popup: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    social_posts_tour: Mapped[bool] = mapped_column(Boolean, server_default=true(), default=True)
    onboarding_popup: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    # The user's account memberships.
    account_users: Mapped[list["AccountUser"]] = relationship(back_populates="user")
