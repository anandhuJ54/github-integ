"""web_sweep — open-web search for the entity, "tap the ones that are you" (port of
lib/nora/organize/web-sweep.ts).

Source: Oxylabs Google Search (parsed), through the same Oxylabs client the ETL uses
(`oxylabs_raw`), behind the stub contract (`with_oxylabs` → NotConfigured when the credentials
are absent). The category is only a display name in the query — no per-category logic.
"""
from __future__ import annotations

import concurrent.futures
import re
from typing import Any

from nora_os import disco
from nora_os.jsutil import js_round
from nora_os.nora.organize.costs import UNIT_COST_USD
from nora_os.nora.organize.integrations import with_oxylabs
from nora_os.nora.organize.parse import _split, host_of, platform_of, registrable_domain

SWEEP_RESULTS_PER_QUERY = 10


def tokens(s: str | None) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", str(s if s is not None else "").lower()) if len(t) >= 2]


def token_share(needle: str | None, hay: str) -> float:
    n = list(dict.fromkeys(tokens(needle)))
    if not n:
        return 0
    h = set(tokens(hay))
    return js_round(len([t for t in n if t in h]) / len(n) * 100) / 100


def dedupe_key(url: str) -> str:
    u = _split(url)
    if u is None:
        return url.lower()
    host = re.sub(r"^www\.", "", (u.netloc.rsplit("@", 1)[-1]).lower())
    if u.port is not None and str(u.port) == {"http": "80", "https": "443"}.get(u.scheme.lower()):
        host = host.rsplit(":", 1)[0]
    path = re.sub(r"/+$", "", u.path or "/").lower()
    return f"{host}{path}"


def sweep_queries(*, category_name: str | None, entity_name: str, geo: str | None) -> list[str]:
    name = entity_name.strip()
    g = geo.strip() if geo else ""
    q = [f'"{name}" {g}'.strip()]
    if category_name and category_name.strip():
        q.append(f"{name} {category_name.strip()} {g}".strip())
    return q


def organic_rows(body: Any) -> list[dict]:
    """Oxylabs parsed google_search content → organic rows."""
    try:
        r = (body or {}).get("results", [None])[0]
        organic = (((r or {}).get("content") or {}).get("results") or {}).get("organic")
    except (AttributeError, IndexError, TypeError):
        return []
    return organic if isinstance(organic, list) else []


def _num(v: Any) -> float:
    try:
        return float(v if v is not None else 0)
    except (TypeError, ValueError):
        return float("nan")


def build_candidates(rows_by_query: list[dict], i: dict) -> list[dict]:
    """Rows from every query → candidates with dedupe hints, best first.

    `i` is the SweepInput: categoryName, entityName, geo, siteUrl?, phone?, knownUrls?.
    """
    site_url = i.get("siteUrl")
    site_reg = registrable_domain(host_of(site_url) or "") if site_url else None
    known = {dedupe_key(u) for u in (i.get("knownUrls") or [])}
    e164 = disco.to_e164(i.get("phone") or "")
    phone_digits = e164[-10:] if e164 else None
    geo_tokens = [t for t in tokens(i.get("geo")) if len(t) >= 3]
    out: list[dict] = []
    first_by_key: dict[str, int] = {}
    for group in rows_by_query:
        query = group["query"]
        for row in group["rows"]:
            url = row.get("url")
            if not url or not re.match(r"^https?://", url, re.IGNORECASE):
                continue
            title = str(row.get("title") if row.get("title") is not None else "")
            snippet = str(row.get("desc") if row.get("desc") is not None else "")
            text = f"{title} {snippet}"
            key = dedupe_key(url)
            host = host_of(url)
            name_match = token_share(i.get("entityName"), text)
            text_tokens = tokens(text)
            geo_match = len(geo_tokens) > 0 and any(t in text_tokens for t in geo_tokens)
            phone_match = bool(phone_digits) and phone_digits in re.sub(r"\D", "", text)
            same_site = bool(site_reg) and bool(host) and registrable_domain(host) == site_reg
            dup = first_by_key.get(key)
            score = js_round(
                (name_match * 2 + (1 if geo_match else 0) + (2 if phone_match else 0) + (1 if same_site else 0))
                * 100
            ) / 100
            hints = {
                "platform": platform_of(url),
                "dedupe_key": key,
                "duplicate_of": dup,
                "same_site": same_site,
                "already_known": key in known,
                "name_match": name_match,
                "geo_match": geo_match,
                "phone_match": phone_match,
                "score": score,
            }
            if dup is None:
                first_by_key[key] = len(out)
            out.append(
                {
                    "url": url,
                    "title": title,
                    "snippet": snippet,
                    "rank": _num(row.get("pos")),
                    "query": query,
                    "hints": hints,
                }
            )
    return out


def web_sweep(i: dict) -> dict:
    queries = sweep_queries(
        category_name=i.get("categoryName"), entity_name=i["entityName"], geo=i.get("geo")
    )

    def live() -> dict:
        def one(query: str) -> dict:
            payload = {
                "source": "google_search",
                "query": query,
                "parse": True,
                "limit": SWEEP_RESULTS_PER_QUERY,
            }
            # Geo rides in the query text; Oxylabs geo_location wants its own canonical format.
            res = disco.oxylabs_raw(payload, 12_000)
            if res["httpStatus"] >= 400:
                raise RuntimeError(f"Oxylabs google_search HTTP {res['httpStatus']}")
            return {"query": query, "rows": organic_rows(res["body"])}

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(queries))) as pool:
            rows_by_query = list(pool.map(one, queries))  # Promise.all: first error rejects
        return {
            "queries": queries,
            "candidates": build_candidates(rows_by_query, i),
            "cost": {
                "provider": "oxylabs",
                "requests": len(queries),
                "est_cost_usd": js_round(len(queries) * UNIT_COST_USD["oxylabs_google_search"] * 1e6)
                / 1e6,
            },
        }

    return with_oxylabs(live)
