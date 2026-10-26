"""`campaigns.campaign_transactions`: one survey request of a campaign to one customer.

Columns, types, defaults and indexes follow the "Migration Input" sheet of "Models and Associations"
(column order kept, so the model can be checked against the sheet row by row).

Associations:
- `CampaignTransaction.campaign`: belongs to a campaign (deleted with it).
- `survey_source_id` -> the shared setup table `public.survey_sources` (`_base.models.SurveySource`); a source
  in use cannot be deleted. One-way `CampaignTransaction.survey_source`: the transactions of a source are
  a query, because shared core never refers to a Surface.
- `account_id` / `tier_id` / `tier_agent_id` -> XMP's `xmp.accounts` / `xmp.tiers` / `xmp.tier_agents` through
  `surfaces.xmp.exports`. No ORM relationship crosses Surfaces; read them with `surfaces.xmp.exports.get_*`.
- `follow_up_campaign_transaction_id` is set on a follow-up transaction and holds the id of the original
  transaction it follows up (read back as the "source transaction").
  A plain self foreign key with no ORM relationship; deleting the original sets it to NULL on its follow-ups.
- `ingested_transaction_id` -> plain bigint until ingested transactions have an owner.
"""

from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
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

# Imported at runtime, not only for type checking: the `survey_source` relationship needs the class
# registered with SQLAlchemy, and nothing else in the running app imports `_base.models`.
from _base.models import SurveySource
from surfaces.campaigns.models.campaign import SCHEMA
from surfaces.xmp.exports import ACCOUNT_ID_FK, TIER_AGENT_ID_FK, TIER_ID_FK

if TYPE_CHECKING:
    from surfaces.campaigns.models.campaign import Campaign


class CampaignTransaction(IdMixin, TimestampMixin, Base):
    __tablename__ = "campaign_transactions"
    __table_args__ = (
        Index(
            "ix_ct_account_id_campaign_id_status_is_retake",
            "account_id",
            "campaign_id",
            "status",
            "is_retake",
        ),
        Index(
            "ix_ct_account_id_campaign_id_first_email_sent",
            "account_id",
            "campaign_id",
            "first_email_sent_on",
        ),
        Index("ix_ct_customer_email", "customer_email"),
        Index("ix_ct_customer_first_name", "customer_first_name"),
        Index("ix_ct_customer_last_name", "customer_last_name"),
        Index("ix_ct_email_next_processing_date", "email_next_processing_date"),
        Index("ix_ct_transactions_on_participant_type", "participant_type"),
        Index("ix_ct_transactions_on_sms_next_processing_date", "sms_next_processing_date"),
        {"schema": SCHEMA},
    )

    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"), default=1)
    campaign_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Reference to a table with no owner yet
    ingested_transaction_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    survey_source_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("survey_sources.id"), nullable=False, index=True
    )
    account_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(ACCOUNT_ID_FK), nullable=False)
    tier_id: Mapped[int] = mapped_column(BigInteger, ForeignKey(TIER_ID_FK), nullable=False, index=True)
    tier_agent_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey(TIER_AGENT_ID_FK), index=True)
    agent_name: Mapped[str | None] = mapped_column(String(255))
    agent_email: Mapped[str | None] = mapped_column(String(255))
    customer_first_name: Mapped[str | None] = mapped_column(String(255))
    customer_last_name: Mapped[str | None] = mapped_column(String(255))
    customer_email: Mapped[str | None] = mapped_column(String(255))
    customer_contact_number: Mapped[str | None] = mapped_column(String(255))
    participant_type: Mapped[str | None] = mapped_column(String(255))
    engagement_closed_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(255))
    property_address: Mapped[str | None] = mapped_column(String(255))
    loan_processor_name: Mapped[str | None] = mapped_column(String(255))
    loan_processor_email: Mapped[str | None] = mapped_column(String(255))
    transaction_type: Mapped[str | None] = mapped_column(String(255))
    transaction_state: Mapped[str | None] = mapped_column(String(255))
    custom_fields: Mapped[Any | None] = mapped_column(JSONB)
    survey_start_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    survey_end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)
    is_retake: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false(), default=False)
    retake_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)
    zip_code: Mapped[str | None] = mapped_column(String(255))
    close_date_satisfaction: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    survey_completion_source_type: Mapped[str | None] = mapped_column(String(255))
    sms_status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    is_anonymous: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false(), default=False)
    source_transaction_id: Mapped[int | None] = mapped_column(Integer)
    transaction_initiated_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ipro_source_transaction_id: Mapped[str | None] = mapped_column(String(255))
    customer_image: Mapped[str | None] = mapped_column(Text)
    customer_square_image: Mapped[str | None] = mapped_column(Text)
    customer_rectangle_image: Mapped[str | None] = mapped_column(Text)
    processed_image: Mapped[Any | None] = mapped_column(JSONB)
    is_ranking_score_disabled: Mapped[bool | None] = mapped_column(
        Boolean, server_default=false(), default=False
    )
    sms_queue_status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    email_queue_status: Mapped[int | None] = mapped_column(Integer, server_default=text("0"), default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_email_sent_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Days, not timestamps: the email / SMS queue processes a transaction on that date.
    email_next_processing_date: Mapped[date | None] = mapped_column(Date)
    sms_next_processing_date: Mapped[date | None] = mapped_column(Date)
    # Named explicitly: the naming convention's name is longer than Postgres's 63-character limit.
    follow_up_campaign_transaction_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            f"{SCHEMA}.campaign_transactions.id",
            ondelete="SET NULL",
            name="fk_ct_follow_up_campaign_transaction_id",
        ),
        index=True,
    )
    last_survey_sent_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    email_reminder_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    sms_reminder_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    survey_url: Mapped[str | None] = mapped_column(Text)
    last_email_reminder_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sms_reminder_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_initial_sms_enabled: Mapped[bool | None] = mapped_column(
        Boolean, server_default=false(), default=False
    )
    request_retake_survey_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    secondary_workflow_click_rate: Mapped[Any | None] = mapped_column(JSONB)
    first_sms_sent_on: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[Any | None] = mapped_column(JSONB)
    error: Mapped[Any | None] = mapped_column(JSONB)

    # Belongs to a campaign.
    campaign: Mapped["Campaign"] = relationship(back_populates="campaign_transactions")
    # Belongs to a survey source (shared setup table; no reverse side: shared core never refers to a
    # Surface)
    survey_source: Mapped[SurveySource] = relationship()
