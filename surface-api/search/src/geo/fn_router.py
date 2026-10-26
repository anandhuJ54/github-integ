"""Server functions from legacy `lib/geo.functions.ts` (public, no auth)."""
from __future__ import annotations

import math

from fastapi import Request

from _base.server_fn import FnCall, fn_router
from surfaces.search.geo import geo
from surfaces.search.internal import js_number

router = fn_router("search")


@router.post("/getDetectedArea")
def get_detected_area(call: FnCall, request: Request) -> dict:
    """Coarse IP/edge city for the visitor; only the label ever reaches the client."""
    detected = geo.detect_area(request.headers)
    return {
        "label": (detected or {}).get("label") or "",
        "city": (detected or {}).get("city") or "",
        "region": (detected or {}).get("region"),
    }


@router.post("/getNearbyAreas")
def get_nearby_areas(call: FnCall, request: Request) -> list[dict]:
    """"Nearby" chips for the choose-area popover."""
    data = call.data if isinstance(call.data, dict) else {}
    city = str(data.get("city") or "").strip()
    region = str(data.get("region") or "").strip() or None
    return geo.nearby_for(request.headers, city, region, 6)


@router.post("/resolveAreaFromCoords")
def resolve_area_from_coords(call: FnCall) -> dict:
    """Opt-in precise location → nearest city label; no coordinate is returned."""
    data = call.data if isinstance(call.data, dict) else {}
    lat = js_number(data["lat"]) if "lat" in data else math.nan
    lng = js_number(data["lng"]) if "lng" in data else math.nan
    if not math.isfinite(lat) or not math.isfinite(lng):
        return {"label": ""}
    return {"label": geo.resolve_area_label(lat, lng)}
