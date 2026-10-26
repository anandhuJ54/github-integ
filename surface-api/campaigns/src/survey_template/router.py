"""Survey templates (GET /campaigns/survey-templates?vertical_id=); increment
surface-spec/campaigns/campaigns-xmp-tables.

Runs as the signed-in user (Supabase JWT), so the grants decide: survey templates and verticals are
readable by any signed-in user.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from _base.auth import current_user
from _base.db import session as db
from surfaces.campaigns.survey_template import services as svc
from surfaces.campaigns.survey_template.schemas import SurveyTemplateSummaryOut

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


@router.get("/survey-templates", response_model=list[SurveyTemplateSummaryOut])
def list_survey_templates(
    vertical_id: Annotated[
        int, Query(ge=1, description='Also returns templates of the "All" vertical.')
    ],
    claims: dict = Depends(current_user),
) -> list[dict]:
    """Active survey templates for a vertical and for "All", newest update first."""
    with db.role_connection("authenticated", claims) as conn:
        try:
            return svc.list_survey_templates_for_vertical(conn, vertical_id)
        except svc.VerticalNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
