"""Server functions from legacy `lib/public-site.functions.ts`: the Trust Center reads.

getPublicHome and getPublicPageBySlug are in the marketing Surface (surface audit 2026-10-25).

Anon role + the `published pages public` SELECT policy on exp_web_pages. DB errors surface
as 500 (the legacy code threw on them).
"""
from __future__ import annotations

from typing import Any

from _base.db.session import role_connection
from _base.server_fn import FnCall, fn_router
from surfaces.search.internal import rows

router = fn_router("search")

COLUMNS = (
    "id, slug, title, page_type, status, body, seo_title, seo_desc, published_at, updated_at, "
    "route_path, code_rendered"
)


def blocks_of(body: Any) -> list:
    """exp_web_pages.body may be a block list, `{ blocks: [...] }`, or `{ markdown }`."""
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        if isinstance(body.get("blocks"), list):
            return body["blocks"]
        if isinstance(body.get("markdown"), str):
            return [{"type": "rich_text", "markdown": body["markdown"]}]
    return []


def normalize(row: dict | None) -> dict | None:
    if not row:
        return None
    return {**row, "body": blocks_of(row.get("body"))}


def _js_string(value: Any) -> str:
    """JavaScript `String(value)` for JSON input values."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _query(sql: str, params: list[Any]) -> list[dict]:
    with role_connection("anon") as conn:
        return rows(conn, sql, params)


@router.post("/getPublicPage")
def get_public_page(call: FnCall) -> dict | None:
    data = call.data if isinstance(call.data, dict) else {}
    slug = _js_string(data.get("slug"))[:200] if "slug" in data else "undefined"
    page_type = _js_string(data.get("pageType"))[:40] if "pageType" in data else "undefined"
    found = _query(
        f"select {COLUMNS} from exp_web_pages where slug = %s and page_type = %s "
        "and status = 'published' limit 1",
        [slug, page_type],
    )
    return normalize(found[0] if found else None)


@router.post("/getPublicTrustDocs")
def get_public_trust_docs(call: FnCall) -> list[dict]:
    """All published Trust Center documents."""
    found = _query(
        f"select {COLUMNS} from exp_web_pages where page_type = 'trust' and status = 'published' "
        "order by title asc",
        [],
    )
    return [normalize(r) for r in found]  # type: ignore[misc]
