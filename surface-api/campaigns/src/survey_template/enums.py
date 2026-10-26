"""Enumerations of the survey template tables. Columns stay plain integers so existing data
loads as-is. Increment surface-spec/campaigns/campaigns-xmp-tables."""
from __future__ import annotations

from enum import IntEnum


class SurveyTemplateStatus(IntEnum):
    """`survey_templates.status`. Only the values whose meaning is known."""

    ACTIVE = 1  # offered in template lists
