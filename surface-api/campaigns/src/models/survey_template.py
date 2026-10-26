"""`campaigns.survey_templates`: a reusable survey definition (questions, email/SMS setup, workflow, scoring).

Columns follow the survey_templates spec. Its `json` columns are stored as `JSONB`, like the other
campaigns tables.

Associations:
- Verticals: a template belongs to one or more verticals through `vertical_survey_templates`.
  Deleting a template deletes its links.
- Campaigns: `campaigns` has no `survey_template_id` column yet, so there is no link to campaigns.
"""

from typing import TYPE_CHECKING, Any

from sqlalchemy import Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.campaigns.models.campaign import SCHEMA

if TYPE_CHECKING:
    from surfaces.campaigns.models.vertical_survey_template import VerticalSurveyTemplate


class SurveyTemplate(IdMixin, TimestampMixin, Base):
    __tablename__ = "survey_templates"
    __table_args__ = ({"schema": SCHEMA},)

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    status: Mapped[int | None] = mapped_column(Integer)
    settings: Mapped[Any | None] = mapped_column(JSONB)
    primary_questions: Mapped[Any | None] = mapped_column(JSONB)
    email_setup: Mapped[Any | None] = mapped_column(JSONB)
    sms_setup: Mapped[Any | None] = mapped_column(JSONB)
    secondary_workflow: Mapped[Any | None] = mapped_column(JSONB)
    set_conditions: Mapped[Any | None] = mapped_column(JSONB)
    ranking_score: Mapped[Any | None] = mapped_column(JSONB)
    branch_questions: Mapped[Any | None] = mapped_column(JSONB)
    description: Mapped[str | None] = mapped_column(Text)
    video_link: Mapped[str | None] = mapped_column(Text)
    campaign_type: Mapped[str | None] = mapped_column(String(255), index=True)

    # Its vertical links. Includes soft-deleted links: filter `deleted_at IS NULL`
    # for the template's current verticals.
    vertical_survey_templates: Mapped[list["VerticalSurveyTemplate"]] = relationship(
        back_populates="survey_template", cascade="all, delete-orphan", passive_deletes=True
    )
