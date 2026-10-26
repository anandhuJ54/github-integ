"""Server functions from legacy `lib/city-home.functions.ts`: city-scoped consumer home.

Every value is a live public (anon) read; empty data renders as an empty state. Graph and
search tables are only read here.
"""
from __future__ import annotations

import math
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Request

from _base.db.session import role_connection
from _base.server_fn import FnCall, fn_router
from surfaces.marketing import geo
from surfaces.marketing.pg import as_int_if_whole, js_number, num, safe
from surfaces.marketing.search_docs import (
    decode_name,
    empty_facets,
    search_docs,
    search_docs_count,
    search_docs_facets,
    with_coordinates,
)

router = fn_router("marketing")

CITY_PAGE_SIZE = 10

KEYWORDS: list[dict[str, Any]] = [
    {
        "key": "eat",
        "title": "Great Places to Eat Near You",
        "words": ["restaurant", "cafe", "coffee", "pizza", "bakery", "bar", "grill", "food", "deli"],
    },
    {
        "key": "home",
        "title": "Trusted Home Services",
        "words": [
            "plumb",
            "electric",
            "roof",
            "hvac",
            "heating",
            "landscap",
            "clean",
            "contractor",
            "handyman",
            "pest",
            "remodel",
            "garage",
        ],
    },
    {
        "key": "todo",
        "title": "Things to Do",
        "words": [
            "park",
            "museum",
            "attraction",
            "tour",
            "golf",
            "theat",
            "brewery",
            "gym",
            "bowling",
            "zoo",
        ],
    },
]

_SPONSORED_DOC_COLS = (
    "id, entity_type, entity_id, slug, gcid, name, title, city, state, zip, lat, lng, rating, "
    "review_count, claimed, rank_score, completeness_pct, photo_url"
)


def split_area(area: str) -> tuple[str, str | None]:
    parts = [p.strip() for p in area.split(",")]
    city = parts[0] if parts else ""
    state = parts[1] if len(parts) > 1 else ""
    return city, state or None


def weekend_in(timezone: str | None, now: datetime | None = None) -> bool:
    """Fri/Sat/Sun in the visitor's timezone (UTC weekday when the zone is unknown)."""
    now = now or datetime.now(UTC)
    try:
        local = now.astimezone(ZoneInfo(timezone)) if timezone else now.astimezone(UTC)
        return local.weekday() in (4, 5, 6)
    except Exception:  # noqa: BLE001 — invalid zone → UTC weekday (legacy fallback)
        return now.astimezone(UTC).weekday() in (4, 5, 6)


def _nearby_safe(headers: Mapping[str, str] | None, city: str, state: str | None, limit: int):
    try:
        return geo.nearby_for(headers, city, state, limit)
    except Exception:  # noqa: BLE001 — `.catch(() => [])`
        return []


def _scope(conn: Any, headers: Mapping[str, str] | None, city: str, state: str | None,
           area_label: str, nearby: list[dict] | None) -> tuple[str, str]:
    """Nearest city with inventory when the detected place has none of its own."""
    scope_city, scope_label = city, area_label
    if city:
        own = search_docs_count(conn, {"p_loc": city})
        if num(own) == 0:
            near = nearby if nearby is not None else _nearby_safe(headers, city, state, 1)
            if near:
                scope_label = near[0]["label"]
                scope_city = split_area(scope_label)[0]
    return scope_city, scope_label


def build_collections(category_labels: list[dict], facets: dict, is_weekend: bool) -> list[dict]:
    collections: list[dict] = []
    for group in KEYWORDS:
        hits = [c for c in category_labels if any(w in c["label"].lower() for w in group["words"])]
        if not hits:
            continue
        top = hits[0]
        if group["key"] == "todo":
            title = f"Things to Do This {'Weekend' if is_weekend else 'Week'}"
        else:
            title = group["title"]
        collections.append(
            {
                "key": group["key"],
                "title": title,
                "q": f"best {top['label'].lower()} near me" if group["key"] == "eat" else group["title"],
                "gcid": top["gcid"] if len(hits) == 1 else "",
                "count": as_int_if_whole(float(sum(h["count"] for h in hits))),
            }
        )
    professional = next(
        (k for k in facets.get("kinds") or [] if k.get("entity_type") == "professional"), None
    )
    professional_count = (professional or {}).get("count") or 0
    if professional_count and num(professional_count) > 0:
        collections.insert(
            1,
            {
                "key": "experts",
                "title": "Top-Rated Experts",
                "q": "highly rated experts near me",
                "gcid": "",
                "count": as_int_if_whole(num(professional_count)),
            },
        )
    return collections


def pick_sponsored(slots: list[dict], docs: list[dict], label_by_gcid: dict[str, str]) -> list[dict]:
    out: list[dict] = []
    seen: set[Any] = set()
    for slot in slots:
        doc = next(
            (
                d
                for d in docs
                if d.get("gcid") == slot.get("gcid")
                and (
                    slot.get("geo_type") != "zip"
                    or not slot.get("geo_value")
                    or d.get("zip") == slot.get("geo_value")
                )
            ),
            None,
        )
        if doc is None or doc.get("id") in seen:
            continue
        seen.add(doc.get("id"))
        out.append(
            {
                **doc,
                "name": decode_name(doc.get("name")),
                "nodeCount": 0,
                "categoryLabel": label_by_gcid.get(doc["gcid"]) if doc.get("gcid") else None,
                "advertiserName": decode_name(slot["advertiser_name"])
                if slot.get("advertiser_name")
                else None,
            }
        )
    return out[:3]


def _active_on(slot: dict, today: str) -> bool:
    starts = str(slot["starts_on"])[:10] if slot.get("starts_on") else None
    ends = str(slot["ends_on"])[:10] if slot.get("ends_on") else None
    return (not starts or starts <= today) and (not ends or ends >= today)


@router.post("/getCityHome")
def get_city_home(call: FnCall, request: Request) -> dict:
    data = call.data if isinstance(call.data, dict) else {}
    headers = request.headers
    detected = geo.detect_area_safe(headers)
    area_label = str(data.get("area") or "").strip() or (detected or {}).get("label") or ""
    city, state = split_area(area_label)

    # Nearby is anchored on coarse coordinates, never on the detected place name.
    nearby = _nearby_safe(headers, city, state, 8) if city else []
    timezone = (detected or {}).get("timezone")

    page_n = js_number(data["page"]) if data.get("page") is not None else 1.0
    page = max(1, int(page_n)) if math.isfinite(page_n) else 1
    rating = data.get("rating")
    claimed = data.get("claimed")

    with role_connection("anon") as conn:
        scope_city, scope_label = _scope(conn, headers, city, state, area_label, nearby)
        is_weekend = weekend_in(timezone)
        context = {
            "city": city,
            "state": state,
            "label": area_label,
            "timezone": timezone,
            "isWeekend": is_weekend,
            "scopeCity": scope_city,
            "scopeLabel": scope_label,
        }
        base = {
            "p_loc": scope_city or None,
            "p_gcid": data.get("gcid") or None,
            "p_min_rating": rating
            if isinstance(rating, (int, float)) and not isinstance(rating, bool) and rating > 0
            else None,
            "p_claimed": None if not claimed or claimed == "any" else claimed == "yes",
        }
        raw_rows = search_docs(
            conn,
            {**base, "p_sort": "rank", "p_limit": CITY_PAGE_SIZE,
             "p_offset": (page - 1) * CITY_PAGE_SIZE},
            [],
        )
        total = search_docs_count(conn, base)
        facets = search_docs_facets(conn, base)
        map_rows_raw = search_docs(conn, {**base, "p_sort": "rank", "p_limit": 60, "p_offset": 0}, [])
        guides = safe(
            conn,
            "select id, title, slug, excerpt, published_at from content_items "
            "where status = 'published' order by published_at desc limit 5",
            None,
            [],
        )

        facets = facets if isinstance(facets, dict) else empty_facets()
        category_labels = [
            {"gcid": c.get("gcid"), "label": c.get("label"),
             "count": as_int_if_whole(num(c.get("count")))}
            for c in facets.get("categories") or []
        ]
        label_by_gcid = {c["gcid"]: c["label"] for c in category_labels}

        rows = [{**r, "name": decode_name(r.get("name"))} for r in raw_rows]
        map_rows = [
            {
                **r,
                "name": decode_name(r.get("name")),
                "categoryLabel": label_by_gcid.get(r["gcid"]) if r.get("gcid") else None,
            }
            for r in map_rows_raw
        ]

        # Node counts break Search Rank Score ties; read-only count from the graph.
        node_counts: dict[Any, int] = {}
        entity_ids = [r["entity_id"] for r in rows if r.get("entity_id")]
        if entity_ids:
            nodes = safe(
                conn,
                "select entity_id from graph_nodes where entity_id = any(%s) and is_active = true "
                "limit 5000",
                [[str(e) for e in entity_ids]],
                [],
            )
            for n in nodes:
                key = str(n["entity_id"])
                node_counts[key] = node_counts.get(key, 0) + 1

        results = [
            {
                **r,
                "nodeCount": node_counts.get(str(r.get("entity_id")), 0),
                "categoryLabel": label_by_gcid.get(r["gcid"]) if r.get("gcid") else None,
            }
            for r in rows
        ]
        results.sort(key=lambda r: (-(num(r.get("rank_score"))), -r["nodeCount"]))

        # Sponsored placements.
        sponsored: list[dict] = []
        today = datetime.now(UTC).date().isoformat()
        slots = safe(
            conn,
            "select gcid, geo_type, geo_value, position, advertiser_name, starts_on, ends_on "
            "from exp_sponsored_slots where status = 'active' order by position asc limit 50",
            None,
            [],
        )
        slots = [s for s in slots if _active_on(s, today)]
        if slots and scope_city:
            docs = safe(
                conn,
                f"select {_SPONSORED_DOC_COLS} from search_documents "
                "where city ilike %s and gcid = any(%s) limit 60",
                [scope_city, [s.get("gcid") for s in slots]],
                [],
            )
            sponsored = pick_sponsored(slots, docs, label_by_gcid)

        collections = build_collections(category_labels, facets, is_weekend)

        articles: list[dict] = []
        if map_rows:
            author_ids = [str(r["entity_id"]) for r in map_rows if r.get("entity_id")][:200]
            article_rows = safe(
                conn,
                "select id, title, slug, topic, body_excerpt, author_name, published_on "
                "from exp_voce_article where author_entity_id = any(%s) "
                "and published_on is not null order by published_on desc limit 6",
                [author_ids],
                [],
            )
            articles = [
                {
                    "id": str(r.get("id")),
                    "title": str(r.get("title") or ""),
                    "slug": r.get("slug"),
                    "topic": r.get("topic"),
                    "excerpt": r.get("body_excerpt"),
                    "authorName": r.get("author_name"),
                    "publishedOn": r.get("published_on"),
                }
                for r in article_rows
            ]

    popular = [
        f"best {c['label'].lower()} in {scope_city or 'your area'}" for c in category_labels[:6]
    ]

    return {
        "context": context,
        "page": page,
        "pageSize": CITY_PAGE_SIZE,
        "total": as_int_if_whole(num(total)),
        "results": results,
        "sponsored": sponsored,
        "facets": facets,
        "categoryLabels": category_labels,
        "collections": collections,
        "articles": articles,
        "guides": [
            {
                "id": str(r.get("id")),
                "title": str(r.get("title") or ""),
                "slug": r.get("slug"),
                "excerpt": r.get("excerpt"),
            }
            for r in guides
        ],
        "nearby": nearby,
        "popular": popular,
    }


@router.post("/getCityMapPins")
def get_city_map_pins(call: FnCall, request: Request) -> dict:
    """Coordinates for the map card, scoped to the same city as the list."""
    data = call.data if isinstance(call.data, dict) else {}
    city, state = split_area(str(data.get("area") or ""))
    with role_connection("anon") as conn:
        scope_city, _label = _scope(conn, request.headers, city, state, "", None)
        base = {"p_loc": scope_city or None, "p_gcid": data.get("gcid") or None}
        rows = search_docs(conn, {**base, "p_sort": "rank", "p_limit": 80, "p_offset": 0}, [])
        facets = search_docs_facets(conn, base)
        labels = {
            c.get("gcid"): c.get("label")
            for c in ((facets or {}).get("categories") or [] if isinstance(facets, dict) else [])
        }
        try:
            mapped = with_coordinates(conn, rows)
        except Exception:  # noqa: BLE001 — `.catch(() => rows)`
            mapped = rows
    return {
        "pins": [
            {
                **r,
                "name": decode_name(r.get("name")),
                "categoryLabel": labels.get(r["gcid"]) if r.get("gcid") else None,
            }
            for r in mapped
            if r.get("lat") is not None and r.get("lng") is not None
        ]
    }
