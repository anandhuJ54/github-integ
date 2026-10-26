"""Sitemap reads and XML rendering (port of legacy `lib/sitemap.server.ts`).

Held-below-floor and demo pages never appear. While the site-wide indexing switch is OFF the
index lists nothing and every urlset is empty.
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from _base.db.session import role_connection
from search.pg import safe

# Held-below-floor pages are never emitted into an indexable sitemap.
INDEXABLE_PARTITIONS: tuple[str, ...] = ("priority-high", "priority-mid", "priority-low")

_PARTITION_COLS = "partition_key, min_score, max_score, changefreq, priority, url_count, last_built_at"


def _n(value: Any) -> float:
    return float(value) if value is not None else 0.0


def band_ranges(
    partitions: Iterable[dict], indexable: Iterable[str]
) -> dict[str, dict[str, float | None]]:
    """Score band ranges from exp_sitemap_partition rows (legacy `bandRanges`).

    Bands are ordered by min_score; the top band is open above and the bottom band open below.
    """
    keys = set(indexable)
    bands = sorted(
        (p for p in partitions if p.get("partition_key") in keys),
        key=lambda p: _n(p.get("min_score")),
        reverse=True,
    )
    out: dict[str, dict[str, float | None]] = {}
    for i, p in enumerate(bands):
        higher = _n(bands[i - 1].get("min_score")) if i > 0 else None
        is_lowest = i == len(bands) - 1
        out[p["partition_key"]] = {
            "min": None if is_lowest else _n(p.get("min_score")),
            "maxExclusive": higher,
        }
    return out


def band_for_score(score: Any, partitions: list[dict], indexable: Iterable[str]) -> str | None:
    s = _n(score)
    for key, r in band_ranges(partitions, indexable).items():
        if (r["min"] is None or s >= r["min"]) and (r["maxExclusive"] is None or s < r["maxExclusive"]):
            return key
    return None


def load_partitions() -> list[dict]:
    """exp_sitemap_partition rows, highest band first (anon read; errors → [])."""
    with role_connection("anon") as conn:
        return safe(
            conn,
            f"select {_PARTITION_COLS} from exp_sitemap_partition order by min_score desc",
            None,
            [],
        )


def load_partition_urls(key: str, partitions: list[dict], limit: int = 45000) -> list[dict]:
    """URLs for one indexable partition; bands come from the partition rows, not constants."""
    rng = band_ranges(partitions, INDEXABLE_PARTITIONS).get(key)
    if rng is None:
        return []
    where = [
        "state <> 'held'",
        "(is_demo is null or is_demo = false)",
        "url is not null",
    ]
    params: list[Any] = []
    if rng["min"] is not None:
        where.append("score >= %s")
        params.append(Decimal(str(rng["min"])))
    if rng["maxExclusive"] is not None:
        where.append("score < %s")
        params.append(Decimal(str(rng["maxExclusive"])))
    params.append(limit)
    sql = (
        "select url, lastmod, submitted_at, created_at from exp_index_queue where "
        + " and ".join(where)
        + " order by thoroughness_pct desc nulls last limit %s"
    )
    with role_connection("anon") as conn:
        return safe(conn, sql, params, [])


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _abs(origin: str, url: str) -> str:
    return url if re.match(r"^https?:", url, re.IGNORECASE) else f"{origin}{url}"


def js_iso(value: Any) -> str:
    """JavaScript `new Date(value).toISOString()` (UTC, milliseconds, trailing Z)."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, date):
        dt = datetime(value.year, value.month, value.day)
    else:
        text = str(value).strip()
        dt = datetime.fromisoformat(text)
    dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _fixed1(value: Any) -> str:
    """JavaScript `Number(value).toFixed(1)` (half away from zero on the exact binary value)."""
    return str(Decimal(float(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def sitemap_index_xml(origin: str, partitions: list[dict], enabled: bool = False) -> str:
    entries = []
    for p in partitions if enabled else []:
        if p.get("partition_key") not in INDEXABLE_PARTITIONS:
            continue
        if _n(p.get("url_count")) <= 0:
            continue
        lastmod = f"<lastmod>{js_iso(p['last_built_at'])}</lastmod>" if p.get("last_built_at") else ""
        entries.append(
            f"  <sitemap><loc>{_esc(origin)}/api/public/sitemap/{_esc(p['partition_key'])}.xml</loc>"
            f"{lastmod}</sitemap>"
        )
    body = "\n".join(entries)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n</sitemapindex>\n"
    )


def url_set_xml(origin: str, partition: dict, url_rows: list[dict], enabled: bool = False) -> str:
    entries = []
    for r in url_rows if enabled else []:
        if not r.get("url"):
            continue
        lastmod = r.get("lastmod") or r.get("submitted_at") or r.get("created_at")
        out = f"  <url><loc>{_esc(_abs(origin, str(r['url'])))}</loc>"
        if lastmod:
            out += f"<lastmod>{js_iso(lastmod)}</lastmod>"
        if partition.get("changefreq"):
            out += f"<changefreq>{_esc(str(partition['changefreq']))}</changefreq>"
        if partition.get("priority") is not None:
            out += f"<priority>{_fixed1(partition['priority'])}</priority>"
        entries.append(out + "</url>")
    body = "\n".join(entries)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{body}\n</urlset>\n"
    )
