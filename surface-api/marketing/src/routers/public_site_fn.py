"""Server functions from legacy `lib/public-site.functions.ts`: marketing CMS page reads.

getPublicPage and getPublicTrustDocs (Trust Center) are in the search Surface (surface audit
2026-10-25).

Anon role + the `published pages public` SELECT policy on exp_web_pages. DB errors surface
as 500 (the legacy code threw on them).
"""
from __future__ import annotations

from typing import Any

from surfaces.marketing.pg import rows

from _base.db.session import role_connection
from _base.server_fn import FnCall, fn_router

router = fn_router("marketing")

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


@router.post("/getPublicHome")
def get_public_home(call: FnCall) -> dict | None:
    """Home page = the newest published page with page_type='home'."""
    found = _query(
        f"select {COLUMNS} from exp_web_pages where page_type = 'home' and status = 'published' "
        "order by published_at desc limit 1",
        [],
    )
    return normalize(found[0] if found else None)


@router.post("/getPublicPageBySlug")
def get_public_page_by_slug(call: FnCall) -> dict | None:
    """Published CMS page by slug (canonical marketing routes)."""
    data = call.data if isinstance(call.data, dict) else {}
    slug = _js_string(data.get("slug"))[:200] if "slug" in data else "undefined"
    found = _query(
        f"select {COLUMNS} from exp_web_pages where slug = %s and status = 'published' limit 1",
        [slug],
    )
    return normalize(found[0] if found else None)
