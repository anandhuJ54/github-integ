"""gbp_lookup — find the entity's Google Business Profile listing through the Google Places API
(New), behind the integrations stub contract ("google_places") (port of
lib/nora/organize/gbp.ts). Ownership is proven elsewhere (gbp_list_locations via OAuth).
"""
from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

import httpx
from surfaces.nora_os import disco
from surfaces.nora_os.nora.organize.costs import UNIT_COST_USD
from surfaces.nora_os.nora.organize.integrations import with_integration
from surfaces.nora_os.nora.organize.web_sweep import token_share

FIELDS = [
    "id",
    "displayName",
    "formattedAddress",
    "internationalPhoneNumber",
    "websiteUri",
    "googleMapsUri",
    "location",
    "primaryType",
    "businessStatus",
]


def to_gbp_candidate(p: dict, q: dict) -> dict:
    """Places API place → candidate with match hints. `q` = {name, address?, phone?, placeId?}."""
    phone = disco.to_e164(p.get("internationalPhoneNumber") or "")
    want = disco.to_e164(q.get("phone") or "")
    display = (p.get("displayName") or {}).get("text")
    return {
        "place_id": str(p.get("id") if p.get("id") is not None else ""),
        "name": display,
        "address": p.get("formattedAddress"),
        "phone": phone,
        "website": p.get("websiteUri"),
        "maps_url": p.get("googleMapsUri"),
        "location": p.get("location"),
        "primary_type": p.get("primaryType"),
        "business_status": p.get("businessStatus"),
        "hints": {
            "name_match": token_share(q.get("name"), display or ""),
            "phone_match": bool(phone) and bool(want) and phone == want,
            "place_id_match": bool(q.get("placeId")) and p.get("id") == q.get("placeId"),
        },
    }


def gbp_lookup(q: dict) -> dict:
    def live(creds: dict) -> dict:
        secrets: dict[str, Any] = creds.get("secrets") or {}
        place_id = q.get("placeId")
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": secrets.get("apiKey"),
            "X-Goog-FieldMask": ",".join(FIELDS)
            if place_id
            else ",".join(f"places.{f}" for f in FIELDS),
        }
        cost = {
            "provider": "google_places",
            "requests": 1,
            "est_cost_usd": UNIT_COST_USD["google_places_text_search"],
        }
        if place_id:
            r = httpx.get(
                f"https://places.googleapis.com/v1/places/{quote(place_id, safe='')}",
                headers=headers,
            )
            if r.status_code >= 400:
                raise RuntimeError(f"Places details HTTP {r.status_code}")
            return {"mode": "details", "candidates": [to_gbp_candidate(r.json(), q)], "cost": cost}
        text_query = ", ".join(x for x in (q.get("name"), q.get("address")) if x)
        r = httpx.post(
            "https://places.googleapis.com/v1/places:searchText",
            headers=headers,
            content=json.dumps({"textQuery": text_query, "pageSize": 5}),
        )
        if r.status_code >= 400:
            raise RuntimeError(f"Places text search HTTP {r.status_code}")
        body = r.json()
        return {
            "mode": "text_search",
            "candidates": [to_gbp_candidate(p, q) for p in (body.get("places") or [])],
            "cost": cost,
        }

    return with_integration("google_places", live)
