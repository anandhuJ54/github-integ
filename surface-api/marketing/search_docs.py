"""Shared search-document helpers for the marketing public reads.

Ports `decodeName` / `EMPTY_FACETS` (legacy `lib/search.ts`), `withCoordinates`
(`lib/geo-coords.ts`) and the `search_docs*` RPC calls. Arguments the legacy code left
`undefined` are omitted so the function default applies.
"""
from __future__ import annotations

import copy
import re
from decimal import Decimal
from typing import Any

from marketing.pg import rpc_args, safe, safe_scalar

EMPTY_FACETS: dict = {
    "categories": [],
    "cities": [],
    "ratings": {"r45": 0, "r40": 0, "r30": 0},
    "claimed": {"yes": 0, "no": 0},
    "kinds": [],
}


def empty_facets() -> dict:
    return copy.deepcopy(EMPTY_FACETS)


def decode_name(value: str | None) -> str:
    """Decode the few HTML entities that leak into imported names."""
    if not value:
        return ""
    out = re.sub(r"&#0?34;|&quot;", '"', value)
    out = re.sub(r"&#0?39;|&apos;", "'", out)
    out = out.replace("&amp;", "&")
    out = re.sub(r"&#0?38;", "&", out)
    return out.replace("&lt;", "<").replace("&gt;", ">")


# (name, pg type) of every search_docs* argument, from migration 0023_search_projection.sql.
_TYPES = {
    "p_q": "text",
    "p_gcid": "text",
    "p_loc": "text",
    "p_min_rating": "numeric",
    "p_claimed": "boolean",
    "p_sort": "text",
    "p_limit": "integer",
    "p_offset": "integer",
}


def _args(base: dict[str, Any]) -> tuple[str, list[Any]]:
    present = []
    for name, value in base.items():
        if value is None:  # undefined in the legacy call → function default
            continue
        if isinstance(value, float):
            value = Decimal(str(value))
        present.append((name, value, _TYPES[name]))
    return rpc_args(present)


def search_docs(conn: Any, base: dict[str, Any], default: Any = None) -> list[dict]:
    args, params = _args(base)
    got = safe(conn, f"select * from public.search_docs({args})", params, default)
    return got if got is not None else []


def search_docs_count(conn: Any, base: dict[str, Any]) -> Any:
    args, params = _args(base)
    return safe_scalar(conn, f"select public.search_docs_count({args}) as n", params, 0)


def search_docs_facets(conn: Any, base: dict[str, Any]) -> Any:
    args, params = _args(base)
    return safe_scalar(conn, f"select public.search_docs_facets({args}) as f", params, None)


def _key(city: str | None, state: str | None) -> str:
    return f"{(city or '').strip().lower()}|{(state or '').strip().upper()}"


def _fnv_js(seed: str) -> int:
    """FNV-style hash exactly as the legacy JS computed it (double multiply, then >>> 0)."""
    h = 2166136261
    for unit in _utf16_units(seed):
        x = h ^ unit
        if x >= 2147483648:  # JS `^` yields a signed 32-bit int
            x -= 4294967296
        h = int(float(x) * 16777619.0) % 4294967296
    return h


def _utf16_units(s: str) -> list[int]:
    data = s.encode("utf-16-le")
    return [data[i] | (data[i + 1] << 8) for i in range(0, len(data), 2)]


def jitter(seed: str, salt: int) -> float:
    h = _fnv_js(seed)
    return (((h >> (salt * 8)) & 0xFF) / 255 - 0.5) * 0.02


def with_coordinates(conn: Any, docs: list[dict]) -> list[dict]:
    """Give every doc without lat/lng its city centroid (spread ~1km), flagged coord_approx."""
    missing = [d for d in docs if d.get("lat") is None or d.get("lng") is None]
    if not missing:
        return docs
    cities: list[str] = []
    for d in missing:
        if d.get("city") and d.get("state"):
            c = str(d["city"]).strip()
            if c and c not in cities:
                cities.append(c)
    cities = cities[:200]
    if not cities:
        return docs
    found = safe(
        conn,
        "select city, state_abbr, lat, lng from exp_us_cities where city = any(%s)",
        [cities],
        [],
    )
    centroids = {
        _key(r.get("city"), r.get("state_abbr")): (float(r["lat"]), float(r["lng"])) for r in found
    }
    if not centroids:
        return docs
    out = []
    for d in docs:
        if d.get("lat") is not None and d.get("lng") is not None:
            out.append(d)
            continue
        hit = centroids.get(_key(d.get("city"), d.get("state")))
        if not hit:
            out.append(d)
            continue
        out.append(
            {
                **d,
                "lat": hit[0] + jitter(str(d.get("id")), 0),
                "lng": hit[1] + jitter(str(d.get("id")), 1),
                "coord_approx": True,
            }
        )
    return out
