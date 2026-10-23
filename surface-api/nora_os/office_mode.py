"""OFFICE MODE — the single-professional office rule's result type, parser and loader (port of
lib/office-mode.ts).

The rule is decided in ONE place: the DB function exp_office_mode. This module does NOT
re-implement the decision (AGENTS.md: never re-decide it in application code).
"""
from __future__ import annotations

import math
from typing import Any

from nora_os.db import Db

KINDS = ("single_pro", "multi_pro", "location_only", "professional_only", "not_found")


def _s(v: Any) -> str | None:
    return v if isinstance(v, str) and v else None


def parse_office_mode(raw: Any) -> dict | None:
    """Parse the jsonb the DB function returns; anything malformed → None.

    Returns {mode, professionalId, locationId, proCount, gcid, supportsSingleProOffice, reason}.
    """
    if not raw or not isinstance(raw, dict):
        return None
    mode = raw.get("mode")
    if mode not in KINDS:
        return None
    try:
        pro_count = float(raw.get("pro_count") if raw.get("pro_count") is not None else 0)
    except (TypeError, ValueError):
        pro_count = 0
    if math.isnan(pro_count):  # NaN → 0, as `Number(x) || 0`
        pro_count = 0
    return {
        "mode": mode,
        "professionalId": _s(raw.get("professional_id")),
        "locationId": _s(raw.get("location_id")),
        "proCount": int(pro_count) if float(pro_count).is_integer() else pro_count,
        "gcid": _s(raw.get("gcid")),
        "supportsSingleProOffice": raw.get("supports_single_pro_office") is True,
        "reason": _s(raw.get("reason")),
    }


def is_single_pro(m: dict | None) -> bool:
    return bool(m) and m["mode"] == "single_pro" and bool(m["professionalId"]) and bool(
        m["locationId"]
    )


def load_office_mode(db: Db, entity_type: str, entity_id: str) -> dict | None:
    """Call exp_office_mode. None when the function is missing or errors — callers then keep
    today's behaviour (the record as itself)."""
    try:
        data = db.rpc(
            "exp_office_mode",
            {"p_entity_type": entity_type, "p_entity_id": entity_id},
            casts={"p_entity_id": "uuid"},
        )
    except Exception:  # noqa: BLE001
        return None
    return parse_office_mode(data)
