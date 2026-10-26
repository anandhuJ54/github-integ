"""`xmp.account_users`: a user's membership of an account.

A user belongs to accounts through this table. An active row (`status = 1`) is a live membership.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    UniqueConstraint,
    false,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.xmp.models.account import SCHEMA

if TYPE_CHECKING:
    from surfaces.xmp.models.account import Account
    from surfaces.xmp.models.user import User


class AccountUser(IdMixin, TimestampMixin, Base):
    __tablename__ = "account_users"
    __table_args__ = (
        UniqueConstraint(
            "account_id", "user_id"
        ),  # one membership per (account, user)
        {"schema": SCHEMA},
    )

    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.users.id"), nullable=False, index=True
    )
    account_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.accounts.id"), nullable=False, index=True
    )
    is_manager: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    is_primary_manager: Mapped[bool] = mapped_column(Boolean, server_default=false(), default=False)
    status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    previous_status: Mapped[int | None] = mapped_column(Integer)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped["User"] = relationship(back_populates="account_users")
    account: Mapped["Account"] = relationship()
