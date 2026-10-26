"""The shared disco (ETL) library, as the NORA organize step uses it.

The TS imported these from routes/api/public/-disco-site-contract.ts, sameas-domain-classifier.ts,
credential-name-classifier.ts and disco-webscraper-worker.ts. Their Python ports live in
`_base.disco.*` (snake_case names, ported in parallel). This module resolves them lazily —
importing nora_os never requires them — and normalises their return shapes (dicts or objects) to
the TS shapes the NORA code reads. Tests monkeypatch the functions here.
"""
from __future__ import annotations

import importlib
import re
from typing import Any


def _module(name: str) -> Any:
    return importlib.import_module(f"_base.disco.{name}")


def _pick(module: str, *names: str) -> Any:
    mod = _module(module)
    for n in names:
        if hasattr(mod, n):
            return getattr(mod, n)
    raise AttributeError(f"_base.disco.{module} has none of {', '.join(names)}")


def _get(obj: Any, *keys: str, default: Any = None) -> Any:
    for k in keys:
        if isinstance(obj, dict) and k in obj:
            return obj[k]
        if not isinstance(obj, dict) and hasattr(obj, k):
            return getattr(obj, k)
    return default


def _plain(v: Any) -> Any:
    """dataclass / object → dict (TS object shape), dicts unchanged."""
    if v is None or isinstance(v, (dict, str, int, float, bool, list)):
        return v
    if hasattr(v, "__dataclass_fields__"):
        return {k: getattr(v, k) for k in v.__dataclass_fields__}
    if hasattr(v, "__dict__"):
        return dict(vars(v))
    return v


# ── -disco-site-contract.ts ────────────────────────────────────────────────


def to_e164(s: Any) -> str | None:
    return _pick("site_contract", "to_e164", "to_e_164")(s)


def to_place_id(url: str) -> str | None:
    return _pick("site_contract", "to_place_id")(url)


def to_credential(text: str, hint: str | None = None) -> dict | None:
    return _plain(_pick("site_contract", "to_credential")(text, hint))


def format_url(raw: str, page_url: str) -> str | None:
    return _pick("site_contract", "format_url")(raw, page_url)


def collect_all_same_as_urls(blocks: list) -> list[str]:
    fn = _pick(
        "site_contract", "collect_all_same_as_urls", "collect_all_sameas_urls", "collect_all_sameAs_urls"
    )
    return list(fn(blocks))


def collect_all_credential_texts(objs: list) -> list[str]:
    return list(_pick("site_contract", "collect_all_credential_texts")(objs))


def entity_type_re() -> re.Pattern:
    return _pick("site_contract", "ENTITY_TYPE_RE")


def extract_json_ld_blocks(html: str) -> list:
    return list(_pick("site_contract", "extract_json_ld_blocks", "extract_jsonld_blocks")(html))


def json_ld_types(obj: dict) -> list[str]:
    return list(_pick("site_contract", "json_ld_types", "jsonld_types")(obj))


def normalize_address(raw: Any) -> dict | None:
    return _plain(_pick("site_contract", "normalize_address")(raw))


def validate_value(type_: str, raw: Any, page_url: str) -> Any:
    return _pick("site_contract", "validate_value")(type_, raw, page_url)


def parse_document_objs(html: str, page_url: str) -> list[dict]:
    """`parseDocument(html, pageUrl).objs` — the page's JSON-LD objects, own entity first."""
    doc = _pick("site_contract", "parse_document")(html, page_url)
    if isinstance(doc, tuple):
        return list(doc[1] or [])
    return list(_get(doc, "objs", default=[]) or [])


# ── sameas-domain-classifier.ts / credential-name-classifier.ts ────────────


def same_as_platform_rules() -> list[tuple[str, re.Pattern]]:
    """SAMEAS_PLATFORM_RULES as (label, urlTest) pairs, in order."""
    rules = _pick("sameas_classifier", "SAMEAS_PLATFORM_RULES")
    return [(_get(r, "label"), _get(r, "url_test", "urlTest")) for r in rules]


def classify_credential(slug_or_name: str, candidate_texts: list[str]) -> dict:
    r = _pick("credential_classifier", "classify_credential")(slug_or_name, candidate_texts)
    return {
        "recognized": bool(_get(r, "recognized", default=False)),
        "value": _get(r, "value"),
        "label": _get(r, "label"),
    }


# ── disco-webscraper-worker.ts ─────────────────────────────────────────────


def looks_blocked(status: int | None, content: str | None) -> bool:
    return bool(_pick("webscraper", "looks_blocked")(status, content))


def scrape_website(request: dict) -> dict:
    """ScrapeResult as a dict with the TS keys (ok, url, resolved_url, crawl_method, rendered,
    attempted_render_fallback, status_code, content, error?, oxylabs?)."""
    r = _plain(_pick("webscraper", "scrape_website")(request))
    if isinstance(r, dict) and r.get("oxylabs") is not None:
        r["oxylabs"] = _plain(r["oxylabs"])
    return r


def oxylabs_raw(payload: dict, timeout_ms: int) -> dict:
    """{httpStatus, body} as the TS returned it."""
    r = _pick("webscraper", "oxylabs_raw")(payload, timeout_ms)
    if isinstance(r, tuple):
        return {"httpStatus": r[0], "body": r[1]}
    return {
        "httpStatus": _get(r, "httpStatus", "http_status", "status"),
        "body": _get(r, "body"),
    }
