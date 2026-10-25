"""Server function from legacy `lib/home.functions.ts`: the search-first home page.

Every value is a live public (anon) read; an empty table renders as an empty state.
"""
from __future__ import annotations

from fastapi import Request

from _base.core.db import role_connection
from _base.core.server_fn import FnCall, fn_router
from marketing import geo
from marketing.pg import as_int_if_whole, num, safe
from marketing.search_docs import decode_name, search_docs, search_docs_facets

router = fn_router("marketing")

SHORTCUT_GCIDS = [
    "gcid:restaurant",
    "gcid:coffee_shop",
    "gcid:plumber",
    "gcid:dentist",
    "gcid:auto_repair_shop",
    "gcid:tourist_attraction",
    "gcid:real_estate_agents",
    "gcid:veterinarian",
    "gcid:spa",
]


def build_home(
    facets: dict | None,
    shortcuts: list[dict],
    guide_rows: list[dict],
    topic_rows: list[dict],
    result_rows: list[dict],
    detected_location: str | None,
) -> dict:
    """Shape the HomeData payload from the raw reads (pure; legacy handler body)."""
    facets = facets if isinstance(facets, dict) else {}
    categories = [
        {"gcid": c["gcid"], "label": c["label"], "count": as_int_if_whole(num(c.get("count")))}
        for c in facets.get("categories") or []
        if c.get("gcid") and c.get("label")
    ]
    categories.sort(key=lambda c: c["count"], reverse=True)
    cities = [
        {
            "city": c["city"],
            "state": c.get("state"),
            "count": as_int_if_whole(num(c.get("count"))),
        }
        for c in facets.get("cities") or []
        if c.get("city")
    ]
    kinds: dict[str, float] = {}
    for k in facets.get("kinds") or []:
        kinds[k.get("entity_type")] = as_int_if_whole(num(k.get("count")))
    authority_count = as_int_if_whole(float(sum(kinds.values())))
    category_counts = {c["gcid"]: c["count"] for c in categories}
    shortcut_categories = [
        {
            "gcid": c["gcid"],
            "label": c["display_name"],
            "count": category_counts.get(c["gcid"], 0),
        }
        for c in shortcuts
        if c.get("gcid") and c.get("display_name")
    ]

    trending = []
    if categories:
        top = categories[0]
        for c in cities[:8]:
            loc = ", ".join(x for x in (c["city"], c["state"]) if x)
            trending.append(
                {
                    "label": f"{top['label']} in {loc}",
                    "gcid": top["gcid"],
                    "loc": loc,
                    "count": c["count"],
                }
            )

    return {
        "categories": categories,
        "shortcutCategories": shortcut_categories,
        "cities": cities[:8],
        "trending": trending,
        "guides": [
            {
                "id": str(r.get("id")),
                "title": str(r.get("title") or ""),
                "slug": r.get("slug"),
                "excerpt": r.get("excerpt"),
                "gcid": r.get("gcid"),
                "published_at": r.get("published_at"),
            }
            for r in guide_rows
        ],
        "topics": [
            {
                "id": str(r.get("id")),
                "title": str(r.get("title") or ""),
                "slug": r.get("slug"),
                "topic": r.get("topic"),
                "gcid": r.get("gcid"),
                "excerpt": r.get("body_excerpt"),
            }
            for r in topic_rows
        ],
        "detectedLocation": detected_location,
        "authorityCount": authority_count,
        "totals": {
            "professionals": kinds.get("professional", 0),
            "locations": kinds.get("location", 0),
            "brands": kinds.get("brand", 0),
        },
        "results": [{**r, "name": decode_name(str(r.get("name") or ""))} for r in result_rows],
    }


@router.post("/getHomeData")
def get_home_data(call: FnCall, request: Request) -> dict:
    detected = geo.detect_area(request.headers)
    detected_location = (detected or {}).get("label")

    with role_connection("anon") as conn:
        facets = search_docs_facets(conn, {})
        shortcuts = safe(
            conn,
            "select gcid, display_name from gbp_categories where gcid = any(%s)",
            [SHORTCUT_GCIDS],
            [],
        )
        guides = safe(
            conn,
            "select id, title, slug, excerpt, gcid, published_at from content_items "
            "where status = 'published' order by published_at desc limit 6",
            None,
            [],
        )
        topics = safe(
            conn,
            "select id, title, slug, topic, gcid, body_excerpt, published_on from exp_voce_article "
            "where published_on is not null order by published_on desc limit 6",
            None,
            [],
        )
        results = search_docs(
            conn,
            {"p_loc": detected_location or None, "p_sort": "rating", "p_limit": 8, "p_offset": 0},
            [],
        )

    return build_home(facets, shortcuts, guides, topics, results, detected_location)
