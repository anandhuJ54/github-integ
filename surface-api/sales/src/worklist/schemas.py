"""Request models for the sales worklist endpoints (moved out of worklist/router.py)."""
from __future__ import annotations

from typing import Any

from pydantic import Field

from surfaces.sales.internal import _Body


class SalesWorklistRpcArgs(_Body):
    args: dict[str, Any] = Field(default_factory=dict)
