"""Pydantic response models for the survey_template resource."""
from __future__ import annotations

from pydantic import BaseModel


class SurveyTemplateSummaryOut(BaseModel):
    """One survey template in a list: the fields a picker needs, without the heavy JSON settings."""

    id: int
    name: str
    description: str | None
    video_link: str | None
