"""ORM classes of the shared-core tables in the `public` schema (on `_base.db.base.Base`).

Classes here leave `schema` unset, so the table lives in `public` (AGENTS.md §4: shared-core tables
stay in `public`). Their migrations are `_base/db/migrations/` revisions. Surfaces point a foreign
key at them (`ForeignKey("survey_sources.id")`) and keep any relationship on their own side: shared
core never refers to a Surface. Increment surface-spec/campaigns/campaigns-xmp-tables.
"""
from __future__ import annotations

from _base.models.survey_source import SurveySource

__all__ = ["SurveySource"]
