"""`campaigns.vertical_survey_templates`: links a survey template to one vertical.

A template belongs to one or more verticals; a link belongs to one vertical and one survey template
and is soft-deleted.

- `survey_template_id` -> `campaigns.survey_templates` (`ON DELETE CASCADE`: deleting a template removes
  its links).
- `vertical_id` -> XMP's `xmp.verticals` through `surfaces.xmp.exports.VERTICAL_ID_FK` (no ORM relationship
  across Surfaces; read it with `surfaces.xmp.exports.get_vertical`). A vertical in use cannot be deleted.
- Soft delete: `deleted_at`. A removed link keeps its row; reads must filter `deleted_at IS NULL`.
- At most one live link per (vertical, template), a partial unique index: check existing data for
  duplicates before loading it.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from _base.db.base import Base, IdMixin, TimestampMixin
from surfaces.campaigns.models.campaign import SCHEMA
from surfaces.xmp.exports import VERTICAL_ID_FK

if TYPE_CHECKING:
    from surfaces.campaigns.models.survey_template import SurveyTemplate


class VerticalSurveyTemplate(IdMixin, TimestampMixin, Base):
    __tablename__ = "vertical_survey_templates"
    __table_args__ = (
        Index(
            "uq_vst_vertical_id_survey_template_id_live",
            "vertical_id",
            "survey_template_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
        {"schema": SCHEMA},
    )

    vertical_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey(VERTICAL_ID_FK), nullable=False, index=True
    )
    # Named explicitly: the naming convention's name is longer than Postgres's 63-character limit.
    survey_template_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(f"{SCHEMA}.survey_templates.id", ondelete="CASCADE", name="fk_vst_survey_template_id"),
        nullable=False,
        index=True,
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Belongs to a survey template.
    survey_template: Mapped["SurveyTemplate"] = relationship(back_populates="vertical_survey_templates")
