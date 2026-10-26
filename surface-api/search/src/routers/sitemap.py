"""Public sitemap + robots.txt routes (legacy `routes/api/public/sitemap*.ts`, `robots[.]txt.ts`).

The edge strips `/api`, so `/api/public/sitemap.xml` is served here as `/public/sitemap.xml`.
The XML keeps the public `/api/...` URLs crawlers see.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse, Response

from _base.config import get_settings
from surfaces.search import site_indexing, sitemap
from surfaces.search.robots import robots_txt

router = APIRouter(tags=["search:public"])

_XML_HEADERS = {"cache-control": "public, max-age=900"}
_XML_TYPE = "application/xml; charset=utf-8"


def _origin(request: Request) -> str:
    """The public site's origin for the URLs listed: SITE_ORIGIN when set, else the address the
    request came in on (the UI's, when the site forwards /robots.txt and /public/sitemap* here)."""
    return get_settings().site_origin or f"{request.url.scheme}://{request.url.netloc}"


def _xml(xml: str) -> Response:
    return Response(content=xml, media_type=_XML_TYPE, headers=_XML_HEADERS)


@router.get("/public/sitemap.xml")
def sitemap_index(request: Request) -> Response:
    """Sitemap index; empty while the indexing switch is OFF."""
    enabled = site_indexing.load_site_indexing_enabled()
    partitions = sitemap.load_partitions() if enabled else []
    return _xml(sitemap.sitemap_index_xml(_origin(request), partitions, enabled))


@router.get("/public/sitemap/{partition}")
def sitemap_partition(partition: str, request: Request) -> Response:
    """Per-partition urlset. Accepts "priority-high" or "priority-high.xml"."""
    key = re.sub(r"\.xml$", "", partition, flags=re.IGNORECASE)
    if key not in sitemap.INDEXABLE_PARTITIONS:
        return PlainTextResponse("Not found", status_code=404)
    origin = _origin(request)
    if not site_indexing.load_site_indexing_enabled():
        empty = {
            "partition_key": key,
            "min_score": None,
            "max_score": None,
            "changefreq": None,
            "priority": None,
            "url_count": 0,
            "last_built_at": None,
        }
        return _xml(sitemap.url_set_xml(origin, empty, [], False))
    partitions = sitemap.load_partitions()
    row = next((p for p in partitions if p.get("partition_key") == key), None)
    if row is None:
        return PlainTextResponse("Not found", status_code=404)
    urls = sitemap.load_partition_urls(key, partitions)
    return _xml(sitemap.url_set_xml(origin, row, urls, True))


@router.get("/robots.txt")
def robots(request: Request) -> Response:
    """OFF (default): "Disallow: /" and no Sitemap line. ON: points at the sitemap index."""
    enabled = site_indexing.load_site_indexing_enabled()
    return Response(
        content=robots_txt(_origin(request), enabled),
        media_type="text/plain; charset=utf-8",
        headers={"cache-control": "public, max-age=3600" if enabled else "public, max-age=300"},
    )
