"""ORM classes of the tables this Surface owns, in its own schema `campaigns` (AGENTS.md §4).

The campaign models (increment surface-spec/campaigns/campaigns-xmp-tables), on the shared
`_base.db.base.Base`. They match `db/migrations/ec94892239fd_campaigns_tables.py`:
change a class only together with a new migration. Not in the live database until the migration
is applied (a human-approved step, after the O11 ruling). `SurveySource` is shared core's
(`_base.models`, in `public`).

Queries built from these classes run on the caller's psycopg connection (`_base.db.sql`); its
grants decide. Setup tables (survey_templates, vertical_survey_templates) are readable by any signed-in
user; campaigns, campaign_drafts and campaign_transactions only by the service role.
Foreign keys into xmp use `surfaces.xmp.exports.*_ID_FK`; no ORM relationship crosses Surfaces.
`review_campaigns` and every other table are still in `_base/db/tables.py`, in `public`.
"""
from __future__ import annotations

from surfaces.campaigns.models.campaign import SCHEMA, Campaign
from surfaces.campaigns.models.campaign_draft import CampaignDraft
from surfaces.campaigns.models.campaign_transaction import CampaignTransaction
from surfaces.campaigns.models.survey_template import SurveyTemplate
from surfaces.campaigns.models.vertical_survey_template import VerticalSurveyTemplate

__all__ = [
    "SCHEMA",
    "Campaign",
    "CampaignDraft",
    "CampaignTransaction",
    "SurveyTemplate",
    "VerticalSurveyTemplate",
]
