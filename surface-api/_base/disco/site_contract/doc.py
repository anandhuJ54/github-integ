"""Parsed pages: each sample page is parsed ONCE per run (Fix 6, 2026-09-25)."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from bs4 import BeautifulSoup

from . import _dom
from .jsonld import collect_json_ld_objects, order_by_page_tie, safe


@dataclass
class ParsedDoc:
    """A pre-parsed page: the document (cheerio ``$``) + collected JSON-LD objects.

    Supports ``doc.soup`` / ``doc.objs`` and the TS-shaped ``doc["$"]`` / ``doc["objs"]``.
    """

    soup: BeautifulSoup | None = None
    objs: list[dict[str, Any]] = field(default_factory=list)

    def __getitem__(self, key: str) -> Any:
        if key in ("$", "soup"):
            return self.soup
        if key == "objs":
            return self.objs
        raise KeyError(key)

    def get(self, key: str, default: Any = None) -> Any:
        try:
            return self[key]
        except KeyError:
            return default


def as_parsed_doc(d: Any) -> ParsedDoc:
    """A ParsedDoc from a ParsedDoc or a ``{"$": soup, "objs": [...]}`` dict."""
    if isinstance(d, ParsedDoc):
        return d
    if isinstance(d, dict):
        soup = d.get("$", d.get("soup"))
        return ParsedDoc(soup=soup, objs=d.get("objs") or [])
    return ParsedDoc()


def is_parsed_doc(x: Any) -> bool:
    return isinstance(x, ParsedDoc) or (isinstance(x, dict) and "objs" in x)


def parse_document(html: str, page_url: str = "", primary: str | None = None) -> ParsedDoc:
    return ParsedDoc(
        soup=safe(lambda: _dom.parse_html(html), None),
        # Fix (profile-page check, 2026-10-06): the page's own entity first (orderByPageTie).
        objs=safe(
            lambda: order_by_page_tie(collect_json_ld_objects(html), html, page_url, primary), []
        ),
    )


# ---------------------------------------------------------------------------
# Samples: {url, html, primary?} dicts (or objects with those attributes)
# ---------------------------------------------------------------------------
def sample_get(s: Any, key: str, default: Any = None) -> Any:
    if isinstance(s, dict):
        return s.get(key, default)
    return getattr(s, key, default)


_DOC_CACHE: OrderedDict[int, tuple[Any, ParsedDoc]] = OrderedDict()
_DOC_CACHE_MAX = 512


def doc_of(s: Any) -> ParsedDoc:
    """Parsed document for a sample, cached per sample object (identity)."""
    key = id(s)
    hit = _DOC_CACHE.get(key)
    if hit is not None and hit[0] is s:
        _DOC_CACHE.move_to_end(key)
        return hit[1]
    d = parse_document(
        sample_get(s, "html") or "", sample_get(s, "url") or "", sample_get(s, "primary")
    )
    # The sample itself is held so its id() cannot be reused while cached.
    _DOC_CACHE[key] = (s, d)
    while len(_DOC_CACHE) > _DOC_CACHE_MAX:
        _DOC_CACHE.popitem(last=False)
    return d
