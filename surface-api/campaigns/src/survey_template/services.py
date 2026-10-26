"""Survey templates for a vertical (increment surface-spec/campaigns/campaigns-xmp-tables).

Runs on the caller's connection (the signed-in user), so its grants decide; the vertical is read through
`surfaces.xmp.exports`.
"""
from __future__ import annotations

from typing import Any

import psycopg
from sqlalchemy import select

from _base.db.sql import fetch_all
from surfaces.campaigns.models import SurveyTemplate, VerticalSurveyTemplate
from surfaces.campaigns.survey_template.enums import SurveyTemplateStatus
from surfaces.xmp.exports import get_all_vertical, get_vertical


class VerticalNotFound(LookupError):
    """No vertical with that id."""


def list_survey_templates_for_vertical(
    conn: psycopg.Connection, vertical_id: int
) -> list[dict[str, Any]]:
    """Active templates linked to the vertical or to the "All" vertical, newest update first.

    Live links only (`deleted_at IS NULL`), `status = 1`. A template linked to both verticals is
    returned once. Only the summary columns are read. Raises VerticalNotFound for an unknown id.
    """
    if get_vertical(conn, vertical_id) is None:
        raise VerticalNotFound(f"Vertical '{vertical_id}' not found")
    vertical_ids = {vertical_id}
    if (all_vertical := get_all_vertical(conn)) is not None:
        vertical_ids.add(all_vertical.id)

    linked = (
        select(VerticalSurveyTemplate.id)
        .where(
            VerticalSurveyTemplate.survey_template_id == SurveyTemplate.id,
            VerticalSurveyTemplate.vertical_id.in_(sorted(vertical_ids)),
            VerticalSurveyTemplate.deleted_at.is_(None),
        )
        .exists()
    )
    stmt = (
        select(
            SurveyTemplate.id, SurveyTemplate.name, SurveyTemplate.description,
            SurveyTemplate.video_link,
        )
        .where(SurveyTemplate.status == int(SurveyTemplateStatus.ACTIVE), linked)
        .order_by(SurveyTemplate.updated_at.desc(), SurveyTemplate.id.desc())
    )
    return fetch_all(conn, stmt, max_rows=None)
