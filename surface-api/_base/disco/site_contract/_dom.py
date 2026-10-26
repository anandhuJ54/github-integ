"""cheerio work-alikes on top of BeautifulSoup (html.parser).

Documents are parsed with ``multi_valued_attributes=None`` so every attribute (``class``
included) is a plain string, as in cheerio. Text nodes are ``NavigableString`` instances that
are not comments / doctypes / CDATA (cheerio ``type === 'text'``).
"""

from __future__ import annotations

import re
import warnings
from collections.abc import Iterable, Iterator
from typing import Any

import soupsieve as sv
from bs4 import BeautifulSoup, NavigableString, Tag
from bs4.element import PreformattedString

_PARSE_CALLS = 0


def parse_call_count() -> int:
    """Number of document parses performed so far (for tests / diagnostics)."""
    return _PARSE_CALLS


def load(html: str | None) -> BeautifulSoup:
    """cheerio ``load`` (not counted)."""
    return BeautifulSoup(html or "", "html.parser", multi_valued_attributes=None)


def parse_html(html: str | None) -> BeautifulSoup:
    global _PARSE_CALLS
    _PARSE_CALLS += 1
    return load(html)


def is_text(n: Any) -> bool:
    return isinstance(n, NavigableString) and not isinstance(n, PreformattedString)


def is_comment(n: Any) -> bool:
    from bs4 import Comment

    return isinstance(n, Comment)


def is_tag(n: Any) -> bool:
    """cheerio ``n.type === 'tag'`` (script / style elements have their own type)."""
    return isinstance(n, Tag) and not isinstance(n, BeautifulSoup) and (
        (n.name or "").lower() not in ("script", "style")
    )


def is_element(n: Any) -> bool:
    """Any element (tag, script or style) — not the document root."""
    return isinstance(n, Tag) and not isinstance(n, BeautifulSoup)


def tag_name(n: Any) -> str:
    return (n.name or "").lower() if isinstance(n, Tag) else ""


def attr(el: Any, name: str) -> str | None:
    if not is_element(el):
        return None
    v = el.attrs.get(name)
    if v is None:
        return None
    if isinstance(v, list):
        return " ".join(v)
    return str(v)


def attrs(el: Any) -> dict[str, Any]:
    return el.attrs if is_element(el) else {}


def _sel(selector: str) -> str:
    return selector


def select(root: Any, selector: str) -> list[Tag]:
    """``$(selector)`` from the root, or ``$(el).find(selector)`` from an element.

    Raises on an invalid selector, like cheerio.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return list(sv.select(_sel(selector), root))


def select_first(root: Any, selector: str) -> Tag | None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return sv.select_one(_sel(selector), root)


def matches(el: Any, selector: str) -> bool:
    if not is_element(el):
        return False
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return sv.match(_sel(selector), el)


def closest(el: Any, selector: str) -> Tag | None:
    if not is_element(el):
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return sv.closest(_sel(selector), el)


def text(el: Any) -> str:
    """cheerio ``.text()``: every descendant text node (script / style text included)."""
    if el is None:
        return ""
    if is_text(el):
        return str(el)
    if not isinstance(el, Tag):
        return ""
    return "".join(str(d) for d in el.descendants if is_text(d))


def texts(els: Iterable[Any]) -> str:
    return "".join(text(e) for e in els)


def own_text(el: Any) -> str:
    """``$(el).contents().filter(text).text()``: direct text children only."""
    if not isinstance(el, Tag):
        return ""
    return "".join(str(c) for c in el.children if is_text(c))


def element_children(el: Any) -> list[Tag]:
    """cheerio ``.children()``."""
    if not isinstance(el, Tag):
        return []
    return [c for c in el.children if is_element(c)]


def next_element(el: Any) -> Tag | None:
    """cheerio ``.next()``."""
    n = el.next_sibling if el is not None else None
    while n is not None and not is_element(n):
        n = n.next_sibling
    return n


def next_all(el: Any, name: str) -> Tag | None:
    """``$(el).nextAll(name).first()``."""
    n = el.next_sibling if el is not None else None
    while n is not None:
        if is_element(n) and tag_name(n) == name:
            return n
        n = n.next_sibling
    return None


def parent_tag(el: Any) -> Tag | None:
    """The parent when it is an element (cheerio ``.parent()`` excludes the root)."""
    p = getattr(el, "parent", None)
    return p if is_element(p) else None


def contains(ancestor: Any, node: Any) -> bool:
    """``$(ancestor).find(node).length > 0``."""
    if node is None:
        return False
    p = getattr(node, "parent", None)
    while p is not None:
        if p is ancestor:
            return True
        p = p.parent
    return False


def iter_tags(root: Any) -> Iterator[Tag]:
    """``$('*')`` in document order."""
    if not isinstance(root, Tag):
        return iter(())
    return (d for d in root.descendants if is_element(d))


def outer_html(el: Any) -> str:
    return str(el)


def body_or_root(soup: BeautifulSoup) -> Tag:
    """parse5 always creates <body>; html.parser does not — fall back to the document."""
    return select_first(soup, "body") or soup


CHROME_WORDS = {"header", "footer", "nav", "navbar", "menu", "breadcrumb", "cookie", "skip"}


def is_chrome_by_name(el: Any) -> bool:
    a = attrs(el)
    words = re.split(r"[^a-z0-9]+", f"{a.get('id') or ''} {a.get('class') or ''}".lower())
    return any(w in CHROME_WORDS for w in words)
