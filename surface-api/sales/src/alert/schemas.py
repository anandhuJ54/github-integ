"""Request models for the sales alert endpoints (moved out of alert/router.py)."""
from __future__ import annotations

from typing import Any

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesAlertsFilter(_Body):
    """loadAlerts' filter. `opportunity_ids`: absent/null = no filter, [] = matches nothing."""
    opportunity_id: str | None = None
    owner_id: str | None = None
    opportunity_ids: list[str] | None = Field(default=None, max_length=1000)


class SalesAlertsDismiss(_Body):
    """The alert's opportunity and rule, recorded on the audit row (as the browser sent them)."""
    opportunity_id: str | None = None
    rule: str | None = None


class SalesAlertsRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)
