"""`campaigns.campaign_drafts`: the unpublished edit of a campaign.

Belongs to a campaign, which has at most one (`Campaign.campaign_draft`) and deletes it with itself.

Columns follow the "Migration Input" sheet of "Models and Associations".
"""

from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.campaigns.models.campaign import SCHEMA

if TYPE_CHECKING:
    from surfaces.campaigns.models.campaign import Campaign


class CampaignDraft(IdMixin, TimestampMixin, Base):
    __tablename__ = "campaign_drafts"
    __table_args__ = ({"schema": SCHEMA},)

    campaign_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(f"{SCHEMA}.campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    draft: Mapped[Any | None] = mapped_column(JSONB)
    status: Mapped[int | None] = mapped_column(Integer)

    campaign: Mapped["Campaign"] = relationship(back_populates="campaign_draft")
