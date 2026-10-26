"""`campaigns.campaigns`: one survey campaign of an account.

Columns, types, defaults and indexes follow the "Migration Input" sheet of "Models and Associations".

Associations:
- `account_id` -> XMP's `xmp.accounts` through `surfaces.xmp.exports.ACCOUNT_ID_FK`. No ORM relationship
  crosses Surfaces; read the account with `surfaces.xmp.exports.get_account`.
- `campaign_group_id` -> plain bigint until campaign groups have an owner.
- `Campaign.campaign_draft`: at most one draft.
- `Campaign.campaign_transactions`: its survey requests.
  Both are deleted with the campaign: by the database (`ON DELETE CASCADE`) and, for loaded rows, by the ORM.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.xmp.exports import ACCOUNT_ID_FK

if TYPE_CHECKING:
    from surfaces.campaigns.models.campaign_draft import CampaignDraft
    from surfaces.campaigns.models.campaign_transaction import CampaignTransaction

SCHEMA = "campaigns"


class Campaign(IdMixin, TimestampMixin, Base):
    __tablename__ = "campaigns"
    __table_args__ = (
        Index("ix_campaigns_account_id_status", "account_id", "status"),
        Index("ix_campaigns_campaign_name", "campaign_name"),
        Index("ix_campaigns_campaign_type", "campaign_type"),
        {"schema": SCHEMA},
    )

    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ACCOUNT_ID_FK), nullable=False)
    campaign_name: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[int | None] = mapped_column(Integer)
    trigger_event: Mapped[Any | None] = mapped_column(JSONB)
    is_manual_survey_allowed: Mapped[bool | None] = mapped_column(Boolean)
    should_display_on_public_profile: Mapped[bool | None] = mapped_column(Boolean)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_default: Mapped[bool | None] = mapped_column(Boolean, server_default=false(), default=False)
    general_settings: Mapped[Any | None] = mapped_column(JSONB)
    delivery_settings: Mapped[Any | None] = mapped_column(JSONB)
    social_share_settings: Mapped[Any | None] = mapped_column(JSONB)
    complaint_resolution_settings: Mapped[Any | None] = mapped_column(JSONB)
    ranking_score: Mapped[Any | None] = mapped_column(JSONB)
    should_allow_anonymous_surveys: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    final_conclusion: Mapped[Any | None] = mapped_column(JSONB)
    survey_sent_on_behalf_of: Mapped[str | None] = mapped_column(String(255))
    external_campaign_name: Mapped[str | None] = mapped_column(String(255))
    # Reference to a table with no owner yet
    campaign_group_id: Mapped[int | None] = mapped_column(BigInteger)
    is_ranking_score_disabled: Mapped[bool | None] = mapped_column(
        Boolean, server_default=false(), default=False
    )
    review_settings: Mapped[Any | None] = mapped_column(JSONB)
    is_auto_review_reply_enabled: Mapped[bool | None] = mapped_column(
        Boolean, server_default=false(), default=False
    )
    has_unsaved_changes: Mapped[bool | None] = mapped_column(Boolean, server_default=false(), default=False)
    has_upload_question: Mapped[bool | None] = mapped_column(Boolean, server_default=false(), default=False)
    is_nps_enabled: Mapped[bool | None] = mapped_column(Boolean, server_default=false(), default=False)
    campaign_type: Mapped[str | None] = mapped_column(String(255))
    is_follow_up_enabled: Mapped[bool | None] = mapped_column(Boolean)
    email_notification_settings: Mapped[Any | None] = mapped_column(JSONB)
    sender_email: Mapped[str | None] = mapped_column(String(255))
    previous_trigger_event: Mapped[Any | None] = mapped_column(JSONB)
    qr_code_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    has_referral_question: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )
    has_skip_logic: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=false(), default=False
    )

    # At most one draft, deleted with the campaign.
    campaign_draft: Mapped["CampaignDraft | None"] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", passive_deletes=True
    )

    # Its transactions, deleted with the campaign.
    campaign_transactions: Mapped[list["CampaignTransaction"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", passive_deletes=True
    )
