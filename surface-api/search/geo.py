"""Coarse visitor location and nearby-city lookups (legacy `geo.server.ts` + `nearbyFor`).

City level only: hosting geo headers first, then one IP lookup as a fallback. The raw IP is
never stored; results are cached under a one-way hash of it for 30 minutes. Precise
geolocation is opt-in in the UI and never requested here.
"""
from __future__ import annotations

import hashlib
import logging
import math
import time
from collections.abc import Mapping
from typing import Any
from urllib.parse import quote, unquote

import httpx

from _base.core.db import role_connection
from srp.pg import rpc_args, safe

log = logging.getLogger(__name__)

_TTL_S = 30 * 60
_ip_cache: dict[str, tuple[float, dict | None]] = {}


def _cache_key(ip: str) -> str:
    return hashlib.sha256(ip.encode()).hexdigest()[:24]


def area_label(city: str, region: str | None) -> str:
    return f"{city}, {region}" if region else city


def _finite(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def lookup_by_ip(ip: str) -> dict | None:
    """City-level lookup for one IP via ipapi.co (cached under a hash of the IP)."""
    key = _cache_key(ip)
    cached = _ip_cache.get(key)
    if cached and time.monotonic() - cached[0] < _TTL_S:
        return cached[1]
    area: dict | None = None
    try:
        res = httpx.get(
            f"https://ipapi.co/{quote(ip, safe='')}/json/",
            headers={"accept": "application/json"},
        )
        if res.is_success:
            body = res.json()
            city = str(body.get("city") or "").strip()
            region = str(body.get("region_code") or body.get("region") or "").strip() or None
            timezone = str(body.get("timezone") or "").strip() or None
            if city:
                lat = body.get("latitude")
                lng = body.get("longitude")
                area = {
                    "city": city,
                    "region": region,
                    "label": area_label(city, region),
                    "timezone": timezone,
                    "latitude": _finite(lat) if isinstance(lat, (int, float)) else None,
                    "longitude": _finite(lng) if isinstance(lng, (int, float)) else None,
                }
    except Exception as exc:  # noqa: BLE001 — any failure means "unknown area"
        log.info("ip lookup failed: %s", type(exc).__name__)
        area = None
    _ip_cache[key] = (time.monotonic(), area)
    return area


def detect_area(headers: Mapping[str, str] | None) -> dict | None:
    """Detected area from request headers (case-insensitive mapping, e.g. `request.headers`)."""
    if headers is None:
        return None

    def get(*names: str) -> str | None:
        for name in names:
            value = headers.get(name)
            if value is not None:
                return value
        return None

    header_city = get("cf-ipcity", "x-vercel-ip-city", "x-geo-city")
    header_region = get("cf-region-code", "x-vercel-ip-country-region", "x-geo-region")
    header_zone = get("cf-timezone", "x-vercel-ip-timezone", "x-geo-timezone")
    header_lat = get("cf-iplatitude", "x-vercel-ip-latitude", "x-geo-latitude")
    header_lng = get("cf-iplongitude", "x-vercel-ip-longitude", "x-geo-longitude")

    def num(v: str | None) -> float | None:
        return _finite(v) if v else None

    if header_city:
        city = unquote(header_city).strip()
        region = (unquote(header_region).strip() or None) if header_region else None
        timezone = (unquote(header_zone).strip() or None) if header_zone else None
        if city:
            return {
                "city": city,
                "region": region,
                "label": area_label(city, region),
                "timezone": timezone,
                "latitude": num(header_lat),
                "longitude": num(header_lng),
            }

    fwd = get("x-forwarded-for", "cf-connecting-ip", "x-real-ip") or ""
    ip = fwd.split(",")[0].strip()
    if not ip or ip.startswith(("127.", "::1", "10.", "192.168.")):
        return None
    return lookup_by_ip(ip)


def detect_area_safe(headers: Mapping[str, str] | None) -> dict | None:
    """`detectAreaFromRequest().catch(() => null)`."""
    try:
        return detect_area(headers)
    except Exception:  # noqa: BLE001
        return None


def _anchor_for(conn: Any, headers: Mapping[str, str] | None, city: str, region: str | None) -> dict:
    """Anchor coordinates: the visitor's coarse IP coordinates first, else the city centroid."""
    detected = detect_area_safe(headers)
    same_area = not city or (detected or {}).get("city", "").strip().lower() == city.strip().lower()
    lat = (detected or {}).get("latitude")
    lng = (detected or {}).get("longitude")
    if same_area and lat is not None and lng is not None:
        return {"lat": lat, "lng": lng}
    if city:
        found = safe(
            conn,
            "select lat, lng, state_abbr from exp_us_cities where city ilike %s "
            "order by population desc limit 5",
            [city],
            [],
        )
        row = next(
            (
                r
                for r in found
                if not region or str(r.get("state_abbr") or "").upper() == region.upper()
            ),
            found[0] if found else None,
        )
        if row:
            return {"lat": float(row["lat"]), "lng": float(row["lng"])}
    if lat is not None and lng is not None:
        return {"lat": lat, "lng": lng}
    return {"lat": None, "lng": None}


def nearby_for(
    headers: Mapping[str, str] | None, city: str, region: str | None, limit: int
) -> list[dict]:
    """Nearest cities that actually carry inventory, by haversine distance."""
    with role_connection("anon") as conn:
        anchor = _anchor_for(conn, headers, city, region)
        args, params = rpc_args(
            [
                ("p_lat", anchor["lat"], "double precision"),
                ("p_lng", anchor["lng"], "double precision"),
                ("p_limit", limit, "integer"),
                ("p_city", city or None, "text"),
                ("p_state", region or None, "text"),
            ]
        )
        found = safe(conn, f"select * from public.nearby_cities({args})", params, None) or []
    return [{"label": str(r.get("label")), "count": int(r.get("profile_count") or 0)} for r in found]


def resolve_area_label(lat: float, lng: float) -> str:
    """Nearest city with inventory for opt-in coordinates; only the label leaves the server."""
    with role_connection("anon") as conn:
        args, params = rpc_args(
            [
                ("p_lat", lat, "double precision"),
                ("p_lng", lng, "double precision"),
                ("p_limit", 1, "integer"),
            ]
        )
        found = safe(conn, f"select * from public.nearby_cities({args})", params, None) or []
    return str(found[0]["label"]) if found and found[0].get("label") else ""
