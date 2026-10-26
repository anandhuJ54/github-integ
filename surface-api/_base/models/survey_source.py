"""`public.survey_sources`: where a survey response comes from (own survey, third-party review sites, ...).

Shared setup table, created by `_base/db/migrations/140d9efec771_base_survey_sources.py`; every signed-in user
may read it. Columns follow the "Migration Input" sheet of "Models and Associations". Surfaces point a
foreign key at it (`ForeignKey("survey_sources.id")`, e.g. `campaigns.campaign_transactions.survey_source_id`)
and keep any relationship on their own side: shared core never refers to a Surface.
"""
from __future__ import annotations

from sqlalchemy import Boolean, String, false, true
from sqlalchemy.orm import Mapped, mapped_column

from _base.db.base import Base, IdMixin, TimestampMixin


class SurveySource(IdMixin, TimestampMixin, Base):
    __tablename__ = "survey_sources"

    source_name: Mapped[str | None] = mapped_column(String(255))
    is_verified: Mapped[bool | None] = mapped_column(Boolean, server_default=true(), default=True)
    is_3rd_party: Mapped[bool | None] = mapped_column(Boolean, server_default=false(), default=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    source_icon: Mapped[str | None] = mapped_column(String(255))
    is_back_link: Mapped[bool | None] = mapped_column(Boolean, server_default=false(), default=False)
    reply_at_source: Mapped[bool | None] = mapped_column(Boolean, server_default=false(), default=False)
