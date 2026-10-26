"""Apply a site contract to one page: CSS / label tier, JSON-LD tier, derived, alias, classifier."""

from __future__ import annotations

import functools
import math
import re
from collections.abc import Callable
from typing import Any

from bs4 import BeautifulSoup

from . import _dom
from ._js import is_num, js_str, json_stringify, parse_float_prefix, trim, try_url
from .doc import ParsedDoc, as_parsed_doc, is_parsed_doc
from .jsonld import (
    classify_subject,
    collect_json_ld_objects,
    extract_json_ld,
    order_by_page_tie,
    safe,
    to_raw,
    types_of,
    walk_raw,
)
from .keys import (
    TAX_PREFIX,
    is_alias,
    is_classifier,
    is_derived,
    is_extra_id,
    is_tax_id,
    key_of,
)
from .opts import norm_opts
from .values import (
    PART_SEP_RE,
    clean_text,
    derive_address_part,
    join_parts,
    norm_lines,
    norm_val,
    strip_trailing_separator,
    validate_value,
)

_WS = re.compile(r"\s+")


def _strip_prefix(s: str) -> str:
    return trim(re.sub(r"^\s*(tel:|mailto:)", "", s, count=1, flags=re.IGNORECASE))


def split_multi(s: str) -> list[str]:
    return [x for x in (trim(y) for y in re.split(r"[,;\n]", s)) if x]


# Fix 5: <br> and block boundaries inside the matched element become newlines.
BLOCK_TAGS = {"p", "div", "li", "dd", "td", "tr"}


def _walk_text(el: Any, skip: Callable[[Any], bool] | None = None) -> str:
    out: list[str] = []

    def walk(n: Any) -> None:
        if n is None:
            return
        if _dom.is_text(n):
            out.append(str(n))
            return
        if not (_dom.is_tag(n) or isinstance(n, BeautifulSoup)):
            return
        if skip is not None and _dom.is_tag(n) and skip(n):
            return
        name = _dom.tag_name(n)
        if name == "br":
            out.append("\n")
            return
        block = name in BLOCK_TAGS
        if block:
            out.append("\n")
        for c in n.children:
            walk(c)
        if block:
            out.append("\n")

    walk(el)
    return norm_lines("".join(out))


def block_text(el: Any) -> str:
    return _walk_text(el)


# C14b: extra text ignores superscripts, hidden and screen-reader-only elements.
SR_ONLY_RE = re.compile(r"sr-only|visually-hidden|visuallyhidden|screen-reader", re.IGNORECASE)


def _is_noise_el(n: Any) -> bool:
    if _dom.tag_name(n) == "sup":
        return True
    a = _dom.attrs(n)
    if "hidden" in a:
        return True
    if js_str(a.get("aria-hidden") if a.get("aria-hidden") is not None else "").lower() == "true":
        return True
    return bool(SR_ONLY_RE.search(js_str(a.get("class") or ""))
                or SR_ONLY_RE.search(js_str(a.get("id") or "")))


def extra_text(el: Any) -> str:
    return _walk_text(el, _is_noise_el)


def _strip_leading_separator(s: str) -> str:
    """C14b: strip leading separators (spaces , ; : | • · - – —)."""
    return trim(re.sub(r"^[\s,;:|•·\-–—]+", "", js_str("" if s is None else s), count=1))


def group_by_parent(lst: list[Any]) -> tuple[list[Any], list[list[Any]]]:
    """C14b: matched elements grouped by their parent element (document order)."""
    parents: list[Any] = []
    groups: list[list[Any]] = []
    for el in lst:
        p = getattr(el, "parent", None)
        i = next((k for k, x in enumerate(parents) if x is p), -1)
        if i < 0:
            parents.append(p)
            groups.append([el])
        else:
            groups[i].append(el)
    return parents, groups


HEADING_TAG_RE = re.compile(r"^h[1-6]$")


def _is_heading_el(n: Any) -> bool:
    return _dom.is_tag(n) and (
        bool(HEADING_TAG_RE.match(_dom.tag_name(n))) or js_str(_dom.attr(n, "role") or "")
        == "heading"
    )


def norm_heading(s: str) -> str:
    t = js_str("" if s is None else s).lower()
    out: list[str] = []
    in_run = False
    for ch in t:
        if ch.isalnum() or ch.isspace() or _is_ln(ch):
            out.append(ch)
            in_run = False
        elif not in_run:
            out.append(" ")
            in_run = True
    return trim(_WS.sub(" ", "".join(out)))


def _is_ln(ch: str) -> bool:
    import unicodedata

    return unicodedata.category(ch)[0] in ("L", "N")


def nearest_heading(soup: Any, el: Any) -> str:
    """C14b: normalised text of a container's nearest heading ('' when none)."""
    lbl = trim(js_str(_dom.attr(el, "aria-labelledby") or ""))
    if lbl:
        for hid in re.split(r"\s+", lbl):
            t = norm_heading(_dom.text(_dom.select_first(soup, f'[id="{hid.replace(chr(34), "")}"]')))
            if t:
                return t
    cur = el
    depth = 0
    while cur is not None and depth < 10:
        sib = cur.previous_sibling
        while sib is not None:
            if _is_heading_el(sib):
                t = norm_heading(_dom.text(sib))
                if t:
                    return t
            if _dom.is_tag(sib):
                inner = _dom.select(sib, "h1,h2,h3,h4,h5,h6,[role=heading]")
                if inner:
                    t = norm_heading(_dom.text(inner[-1]))
                    if t:
                        return t
            sib = sib.previous_sibling
        cur = cur.parent
        if not _dom.is_tag(cur):
            break
        depth += 1
    return ""


def _select_extra_container(soup: Any, lst: list[Any], loc: dict[str, Any]) -> list[Any] | None:
    """C14b: keep only one container's matches (by stored heading, else index)."""
    parents, groups = group_by_parent(lst)
    if len(groups) <= 1:
        return lst
    if loc.get("container_heading"):
        i = next((k for k, p in enumerate(parents)
                  if p is not None and nearest_heading(soup, p) == loc["container_heading"]), -1)
        return None if i < 0 else groups[i]
    ci = loc.get("container_index")
    if is_num(ci):
        return groups[int(ci)] if 0 <= ci < len(groups) and ci == int(ci) else None
    return lst


LABEL_SEL = "h1,h2,h3,h4,h5,h6,dt,th,strong,b,span,p,div,label"


def norm_label(s: str) -> str:
    return trim(_WS.sub(" ", s)).lower()


def _has_fax_hint(el: Any) -> bool:
    a = _dom.attrs(el)
    return any(re.search("fax", js_str(a.get(k) or ""), re.IGNORECASE)
               for k in ("id", "class", "aria-label", "title"))


def _is_fax_context(el: Any) -> bool:
    cur = el
    i = 0
    while i <= 2 and cur is not None and _dom.is_tag(cur):
        if _has_fax_hint(cur):
            return True
        cur = cur.parent
        i += 1
    if re.search(r"\bfax\b", _dom.text(el), re.IGNORECASE):
        return True
    prev = getattr(el, "previous_sibling", None)
    text = ""
    while prev is not None and len(text) < 40:
        text = (str(prev) if _dom.is_text(prev) else _dom.text(prev)) + text
        prev = prev.previous_sibling
    return bool(re.search("fax", text[-40:], re.IGNORECASE))


#: C8: attributes read (in order) for url-typed taxonomy rules without attr.
URL_ATTRS = ("href", "src", "content")


def _read_url_attr(el: Any) -> str:
    if el is None:
        return ""
    for a in URL_ATTRS:
        v = _dom.attr(el, a)
        if v and trim(v):
            return trim(v)
    inner = _dom.select_first(el, "[href],[src],[content]") if isinstance(el, _dom.Tag) else None
    if inner is not None:
        for a in URL_ATTRS:
            v = _dom.attr(inner, a)
            if v and trim(v):
                return trim(v)
    return ""


#: C13: explicit list breaks inside one text (never a bare comma).
LIST_BREAK_RE = re.compile(r"[\n•·;|]")


def _sibling_texts(el: Any) -> list[str]:
    out: list[str] = []
    n = getattr(el, "next_sibling", None)
    while n is not None and len(out) < 10:
        t = trim(_WS.sub(" ", str(n) if _dom.is_text(n) else _dom.text(n)))
        if t:
            out.append(t)
        n = n.next_sibling
    return out


def _continue_parts(first: str, sibs: list[str]) -> list[str]:
    parts = [first]
    for s in sibs:
        if len(parts) >= 10:
            break
        parts.append(s)
        if not PART_SEP_RE.search(s):
            break
    return parts


def _split_breaks(v: str) -> list[str] | str:
    split = [x for x in (trim(y) for y in LIST_BREAK_RE.split(v)) if x]
    return split if len(split) > 1 else v


def find_label_el(soup: Any, raw_label: str) -> Any:
    label = re.sub(r":$", "", norm_label(raw_label or ""), count=1)
    if not label:
        return None
    for el in _dom.select(soup, LABEL_SEL):
        txt = _dom.own_text(el)
        tl = re.sub(r":$", "", norm_label(
            txt or (_dom.text(el) if not _dom.element_children(el) else "")), count=1)
        if tl and (tl == label or tl.startswith(label)):
            return el
    return None


def apply_css(
    soup: Any,
    loc: dict[str, Any],
    fax_guard: bool = False,
    url_only: bool = False,
    text_join: bool = False,
    list_mode: bool = False,
    extra_mode: bool = False,
) -> Any:
    pair = loc.get("pair")
    if pair:
        # C9: geo — one rule per coordinate.
        def one(lc: dict[str, Any]) -> Any:
            x = apply_css(soup, lc)
            return x[0] if isinstance(x, list) else x

        la = one(pair["latitude"])
        lo = one(pair["longitude"])
        if la is None or lo is None:
            return None
        return {"latitude": trim(js_str(la)), "longitude": trim(js_str(lo))}
    attr_name = loc.get("attr")
    if loc.get("strategy") == "css":
        if not loc.get("css"):
            return None
        els = _dom.select(soup, loc["css"])
        if not els:
            return None

        def read(el: Any) -> str:
            if fax_guard and _is_fax_context(el):
                return ""
            if url_only:
                return trim(_dom.attr(el, attr_name) or "") if attr_name else _read_url_attr(el)
            if attr_name:
                v = _WS.sub(" ", _dom.attr(el, attr_name) or "")
            else:
                v = extra_text(el) if (extra_mode or list_mode) else block_text(el)
            return _strip_prefix(v)

        if loc.get("multi"):
            lst = els
            if extra_mode:
                sel = _select_extra_container(soup, lst, loc)
                if sel is None:
                    return None
                lst = sel
            vals = [v for v in (read(el) for el in lst) if v]
            return vals or None
        # C13: a list-typed key collects one item per matched element, or sibling parts after
        # a trailing separator, or explicit list breaks. Never split on commas alone.
        if list_mode and not attr_name:
            if len(els) > 1:
                vals = [v for v in (read(el) for el in els) if v]
                return vals or None
            v = read(els[0])
            if not v:
                return None
            if PART_SEP_RE.search(v):
                sibs = _sibling_texts(els[0])
                if sibs:
                    return _continue_parts(v, sibs)
            return _split_breaks(v)
        # C12: several elements whose first text ends with a separator are one value.
        if text_join and not attr_name:
            if len(els) > 1:
                parts = [v for v in (read(el) for el in els) if v]
                if len(parts) > 1 and PART_SEP_RE.search(parts[0]):
                    return join_parts(parts)
            v0 = read(els[0])
            if v0 and PART_SEP_RE.search(v0):
                sibs = _sibling_texts(els[0])
                if sibs:
                    parts = [p for p in (strip_trailing_separator(x)
                                         for x in _continue_parts(v0, sibs)) if p]
                    if len(parts) > 1:
                        return ", ".join(parts)
        v = read(els[0])
        return v or None
    # label strategy
    label = re.sub(r":$", "", norm_label(loc.get("label") or ""), count=1)
    if not label:
        return None
    if fax_guard and "fax" in label:
        return None
    found = None
    own = ""
    for el in _dom.select(soup, LABEL_SEL):
        txt = _dom.own_text(el)
        t = norm_label(txt or (_dom.text(el) if not _dom.element_children(el) else ""))
        tl = re.sub(r":$", "", t, count=1)
        if tl and (tl == label or tl.startswith(label)):
            found = el
            own = trim(_WS.sub(" ", txt))
            break
    if found is None:
        return None
    tag = _dom.tag_name(found)

    def target_of() -> Any:
        if tag == "dt":
            return _dom.next_all(found, "dd")
        if tag == "th":
            return _dom.next_all(found, "td")
        return _dom.next_element(found)

    if url_only:
        # C8: url keys take the value from an attribute, never element text.
        tgt = target_of()
        for el in (found, tgt):
            if el is None:
                continue
            v = trim(_dom.attr(el, attr_name) or "") if attr_name else _read_url_attr(el)
            if v:
                return [v] if loc.get("multi") else v
        return None
    remainder = trim(re.sub(r"^\s*[:\-–]\s*", "", own[len(label):], count=1))
    if remainder:
        if fax_guard and _is_fax_context(found):
            return None
        if loc.get("multi"):
            return split_multi(remainder)
        if list_mode:
            return _split_breaks(remainder)
        return remainder
    target = target_of()
    if target is None:
        return None
    if fax_guard and _is_fax_context(target):
        return None
    lis = _dom.select(target, "li")
    if lis:
        vals = [v for v in (trim(_WS.sub(" ", _dom.text(li))) for li in lis) if v]
        return vals or None
    v = block_text(target)
    if not v:
        return None
    if loc.get("multi"):
        return split_multi(v)
    if list_mode:
        return _split_breaks(v)
    return v


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------
def url_key(u: Any, base: str | None = None) -> str | None:
    """Fix 14: compare URLs with lowercased host, no query/fragment/trailing slash."""
    if not isinstance(u, str) or not u:
        return None
    x = try_url(u, base)
    if x is None:
        return None
    return f"{x.host.lower()}{re.sub(r'/+$', '', x.pathname, count=1)}"


def _word_text(s: str) -> str:
    return f" {trim(re.sub(r'[^a-z0-9]+', ' ', s.lower()))} "


def filter_items(raw: Any, words: list[str]) -> list[str]:
    items: list[str] = []
    for x in raw if isinstance(raw, list) else [raw]:
        if isinstance(x, str):
            items.extend(split_multi(x))
        elif is_num(x):
            items.append(js_str(x))
    uniq = list(dict.fromkeys(items))
    return [t for t in uniq if any(w in _word_text(t) for w in words)]


# ---- Fix 12a/b: candidate collectors ----
def collect_all_same_as_urls(blocks: list[Any]) -> list[str]:
    """Every sameAs URL anywhere across a page's JSON-LD."""
    urls: dict[str, None] = {}

    def walk(obj: Any) -> None:
        if obj is None:
            return
        if isinstance(obj, list):
            for x in obj:
                walk(x)
            return
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "sameAs":
                    if isinstance(v, str):
                        urls[v] = None
                    elif isinstance(v, list):
                        for item in v:
                            if isinstance(item, str):
                                urls[item] = None
                walk(v)

    for b in blocks:
        walk(b)
    return list(urls)


def collect_all_credential_texts(blocks: list[Any]) -> list[str]:
    """Every credential text under a hasCredential key (strings, name, credentialCategory,
    description)."""
    texts: dict[str, None] = {}

    def add(v: Any) -> None:
        if isinstance(v, str):
            texts[v] = None
        elif isinstance(v, list):
            for x in v:
                add(x)
        elif isinstance(v, dict):
            for k in ("name", "credentialCategory", "description"):
                if isinstance(v.get(k), str):
                    texts[v[k]] = None

    def walk(obj: Any) -> None:
        if obj is None:
            return
        if isinstance(obj, list):
            for x in obj:
                walk(x)
            return
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "hasCredential":
                    add(v)
                walk(v)

    for b in blocks:
        walk(b)
    return list(texts)


def _strings(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [s for x in v for s in _strings(x)]
    return [js_str(v)] if isinstance(v, str) or is_num(v) else []


def _res(r: Any, key: str) -> Any:
    if isinstance(r, dict):
        return r.get(key)
    return getattr(r, key, None)


def classify_same_as(match_text: str, urls: list[str]) -> Any:
    from _base.disco import sameas_classifier as m

    fn = getattr(m, "classify_same_as", None) or m.classify_sameas
    return fn(match_text, urls)


def classify_credential(match_text: str, texts: list[str]) -> Any:
    from _base.disco import credential_classifier as m

    return m.classify_credential(match_text, texts)


def _classifier_value(loc: dict[str, Any], ctx: Ctx) -> str | None:
    objs = ctx.objs()
    vals = ctx.values or {}
    if loc.get("classifier") == "sameas":
        social = [s for fid, v in vals.items()
                  if not is_tax_id(fid) and key_of(fid) == "social_links" for s in _strings(v)]
        cands = list(dict.fromkeys([*collect_all_same_as_urls(objs), *social]))
        r = classify_same_as(loc.get("match_text") or "", cands)
        return _res(r, "url") if _res(r, "recognized") else None
    base = [*collect_all_credential_texts(objs), *_strings(vals.get("person.credentials")),
            *_strings(vals.get("person.licenses"))]
    cands = list(dict.fromkeys(x for t in base for x in [trim(t), *split_multi(t)] if x))
    return _res(classify_credential(loc.get("match_text") or "", cands), "value")


# ---------------------------------------------------------------------------
# Staging schema: call-to-action buttons / links ("label␟url" inside the mapper)
# ---------------------------------------------------------------------------
ACTION_SEP = "␟"


def encode_action(label: str, url: str) -> str:
    return f"{clean_text(label).replace(ACTION_SEP, ' ')}{ACTION_SEP}{trim(js_str(url))}"


def decode_action(s: str) -> dict[str, str] | None:
    s = js_str("" if s is None else s)
    i = s.find(ACTION_SEP)
    if i <= 0:
        return None
    label = trim(s[:i])
    url = trim(s[i + 1:])
    return {"label": label, "url": url} if label and url else None


def action_url(raw: str, page_url: str) -> str | None:
    """A usable action link: http(s) made absolute, or tel: / mailto: / sms:."""
    t = trim(js_str("" if raw is None else raw))
    if not t or t.startswith("#") or re.match(r"^javascript:", t, re.IGNORECASE):
        return None
    m = re.match(r"^(tel|mailto|sms):", t, re.IGNORECASE)
    if m:
        return m.group(0).lower() + t[m.end():]
    u = try_url(t, page_url)
    if u is None:
        return None
    return u.href if u.protocol in ("http:", "https:") else None


def _first_attr(el: Any, *names: str) -> str | None:
    for n in names:
        v = _dom.attr(el, n)
        if v is not None:
            return v
    return None


def _read_actions(soup: Any, loc: dict[str, Any], page_url: str) -> list[str] | None:
    if loc.get("strategy") != "css" or not loc.get("css"):
        return None
    out: list[str] = []
    seen: set[str] = set()
    for el in _dom.select(soup, loc["css"]):
        if len(out) >= 20:
            break
        if _dom.matches(el, "a,button,input,[data-href],[formaction]"):
            link = el
        else:
            link = _dom.select_first(el, "a[href],[data-href],button[formaction]")
        if link is None:
            continue
        raw = _first_attr(link, "href", "data-href", "formaction")
        if raw is None:
            form = _dom.closest(link, "form")
            raw = _dom.attr(form, "action") if form is not None else None
        url = action_url(raw if raw is not None else "", page_url)
        label = (clean_text(_dom.attr(link, "aria-label") or "")
                 or clean_text(_dom.text(link))
                 or clean_text(_dom.attr(link, "title") or "")
                 or clean_text(_dom.attr(link, "value") or ""))
        if not url or not label or len(label) > 80:
            continue
        k = f"{label.lower()}|{url}"
        if k in seen:
            continue
        seen.add(k)
        out.append(encode_action(label, url))
    return out or None


# ---------------------------------------------------------------------------
# Staging schema: videos and gallery images
# ---------------------------------------------------------------------------
def video_from_url(raw: str, page_url: str) -> dict[str, str] | None:
    """A known video link -> canonical URL and platform; direct video files keep their URL."""
    t = trim(js_str("" if raw is None else raw))
    if not t:
        return None
    u = try_url(f"https:{t}" if t.startswith("//") else t, page_url)
    if u is None:
        return None
    host = re.sub(r"^www\.", "", u.hostname.lower(), count=1)
    path = u.pathname
    if re.search(r"(^|\.)youtube(-nocookie)?\.com$", host):
        vid = u.search_param("v")
        if vid is None:
            m = re.match(r"^/(?:embed|shorts|live|v)/([\w-]{6,})", path)
            vid = m.group(1) if m else None
        if vid:
            return {"url": f"https://www.youtube.com/watch?v={vid}", "platform": "youtube"}
        return None
    if host == "youtu.be":
        m = re.match(r"^/([\w-]{6,})", path)
        if m:
            return {"url": f"https://www.youtube.com/watch?v={m.group(1)}", "platform": "youtube"}
    if re.search(r"(^|\.)vimeo\.com$", host):
        m = re.search(r"(?:^|/)(\d{5,})(?:/|$)", path)
        if m:
            return {"url": f"https://vimeo.com/{m.group(1)}", "platform": "vimeo"}
    if re.search(r"(^|\.)(wistia\.(com|net)|wi\.st)$", host):
        m = re.search(r"/(?:medias|iframe|embed/iframe)/(\w{6,})", path)
        if m:
            return {"url": f"https://fast.wistia.net/embed/iframe/{m.group(1)}",
                    "platform": "wistia"}
    if re.search(r"(^|\.)vidyard\.com$", host):
        m = re.search(r"/(?:watch/)?([\w-]{10,})", path)
        if m:
            return {"url": f"https://play.vidyard.com/{m.group(1)}", "platform": "vidyard"}
    if re.search(r"(^|\.)loom\.com$", host):
        m = re.search(r"/(?:share|embed)/(\w{10,})", path)
        if m:
            return {"url": f"https://www.loom.com/share/{m.group(1)}", "platform": "loom"}
    if re.search(r"\.(mp4|webm|mov|m3u8)$", path, re.IGNORECASE) and u.protocol in ("https:", "http:"):
        return {"url": re.sub(r"^http:", "https:", u.href, count=1), "platform": "file"}
    return None


VIDEO_EL_SEL = ("iframe, video, video source, lite-youtube, lite-vimeo, [data-video-id], "
                "[data-youtube-id], a[href]")


def _videos_in(els: list[Any], page_url: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()

    def take(el: Any) -> None:
        tag = _dom.tag_name(el)
        cands: list[str] = []
        for a in ("src", "data-src", "data-lazy-src", "href", "data-url", "data-video-url"):
            v = _dom.attr(el, a)
            if v:
                cands.append(v)
        yid = _first_attr(el, "videoid", "data-youtube-id")
        if yid is None and tag == "lite-youtube":
            yid = _dom.attr(el, "data-id")
        if yid:
            cands.append(f"https://www.youtube.com/watch?v={yid}")
        if tag == "lite-vimeo" and _dom.attr(el, "videoid"):
            cands.append(f"https://vimeo.com/{_dom.attr(el, 'videoid')}")
        for c in cands:
            v = video_from_url(c, page_url)
            if not v or v["url"] in seen:
                continue
            seen.add(v["url"])
            t_raw = _first_attr(el, "title", "aria-label")
            if t_raw is None:
                t_raw = _dom.text(el) if tag == "a" else ""
            title = clean_text(t_raw)
            out.append({**v, "title": title} if title and len(title) <= 200 else v)
            break

    for el in els:
        if len(out) >= 30:
            break
        take(el)
        for x in _dom.select(el, VIDEO_EL_SEL):
            if len(out) < 30:
                take(x)
    return out


def _read_videos(soup: Any, loc: dict[str, Any], page_url: str) -> list[dict[str, str]] | None:
    if loc.get("strategy") != "css" or not loc.get("css"):
        return None
    v = _videos_in(_dom.select(soup, loc["css"]), page_url)
    return v or None


_CHROME_CLOSEST = "header,nav,footer,aside,[role=banner],[role=navigation],[role=contentinfo]"


def _scan_videos(soup: Any, page_url: str) -> list[dict[str, str]] | None:
    """Generic scan of the main content (outside header / nav / footer / aside) for videos."""
    root = _dom.select_first(soup, "main,[role=main]") or _dom.body_or_root(soup)
    if root is None:
        return None
    els = [el for el in _dom.select(root, "iframe, video, lite-youtube, lite-vimeo, [data-youtube-id]")
           if _dom.closest(el, _CHROME_CLOSEST) is None]
    v = _videos_in(els, page_url)
    return v or None


def _srcset_cmp(a: list[str], b: list[str]) -> int:
    fa = parse_float_prefix(a[1] if len(a) > 1 else "0")
    fb = parse_float_prefix(b[1] if len(b) > 1 else "0")
    d = fb - fa
    if math.isnan(d) or d == 0:
        return 0
    return 1 if d > 0 else -1


def _read_images(soup: Any, loc: dict[str, Any], page_url: str) -> list[str] | None:
    """Gallery images: img src / lazy src / largest srcset entry, or links to image files."""
    if loc.get("strategy") != "css" or not loc.get("css"):
        return None
    out: list[str] = []
    seen: set[str] = set()

    def add(raw: str | None) -> None:
        if not raw:
            return
        u = try_url(trim(raw), page_url)
        if u is None or u.protocol not in ("https:", "http:"):
            return
        href = re.sub(r"^http:", "https:", u.href, count=1)
        if href in seen or len(href) > 300:
            return
        seen.add(href)
        out.append(href)

    def from_img(el: Any) -> None:
        srcset = _first_attr(el, "srcset", "data-srcset")
        if srcset:
            entries = [re.split(r"\s+", trim(x)) for x in srcset.split(",")]
            entries.sort(key=functools.cmp_to_key(_srcset_cmp))
            best = entries[0][0] if entries else None
            if best:
                add(best)
                return
        add(_first_attr(el, "data-src", "data-lazy-src", "src"))

    for el in _dom.select(soup, loc["css"]):
        if len(out) >= 50:
            break
        if _dom.matches(el, "img"):
            from_img(el)
        elif _dom.matches(el, "a[href]") and re.search(
            r"\.(jpe?g|png|webp|gif|avif)(\?|$)", _dom.attr(el, "href") or "", re.IGNORECASE
        ):
            add(_dom.attr(el, "href"))
        else:
            for im in _dom.select(el, "img"):
                if len(out) < 50:
                    from_img(im)
    return out or None


def _read_items(soup: Any, loc: dict[str, Any], page_url: str) -> list[dict[str, str]] | None:
    """Structured entries: each matched block -> { sub-key: value }."""
    if loc.get("strategy") != "css" or not loc.get("css") or loc.get("item_fields") is None:
        return None
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for el in _dom.select(soup, loc["css"]):
        if len(out) >= 50:
            break
        item: dict[str, str] = {}
        for k, sel in loc["item_fields"].items():
            try:
                sub = _dom.select_first(el, sel)
            except Exception:  # noqa: BLE001, S112 — TS catch-all
                continue
            if sub is None:
                continue
            if k == "url":
                href = _dom.attr(sub, "href")
                if href is None:
                    inner = _dom.select_first(sub, "a[href]")
                    href = _dom.attr(inner, "href") if inner is not None else None
                u = action_url(href if href is not None else "", page_url)
                if u and re.match(r"^https?:", u):
                    item["url"] = u
            else:
                t = clean_text(_dom.text(sub))
                if t and len(t) <= (2000 if k == "description" else 300):
                    item[k] = t
        if not any(k != "url" for k in item):
            continue
        sig = json_stringify(item).lower()
        if sig in seen:
            continue
        seen.add(sig)
        out.append(item)
    return out or None


# ---------------------------------------------------------------------------
# Locator application
# ---------------------------------------------------------------------------
class Ctx:
    """Per-page application context (lazy JSON-LD objects and document)."""

    def __init__(
        self,
        page_url: str,
        site_entity_names: set[str],
        opts: dict[str, Any],
        objs: Callable[[], list[dict[str, Any]]],
        soup: Callable[[], Any],
        values: dict[str, Any] | None = None,
    ) -> None:
        self.page_url = page_url
        self.site_entity_names = site_entity_names
        self.opts = opts
        self.objs = objs
        self.soup = soup
        self.values = values

    def with_values(self, values: dict[str, Any] | None) -> Ctx:
        return Ctx(self.page_url, self.site_entity_names, self.opts, self.objs, self.soup, values)


def ctx_for(input_: Any, page_url: str, site_entity_names: set[str], opts: dict[str, Any] | None
            ) -> Ctx:
    o = norm_opts(opts)
    if not isinstance(input_, str):
        d = as_parsed_doc(input_) if input_ is not None else ParsedDoc()
        return Ctx(page_url, site_entity_names, o, lambda: d.objs or [], lambda: d.soup)
    html = input_
    cache: dict[str, Any] = {}

    def objs() -> list[dict[str, Any]]:
        if "objs" not in cache:
            cache["objs"] = safe(
                lambda: order_by_page_tie(collect_json_ld_objects(html), html, page_url,
                                          o.get("primary")), [])
        return cache["objs"]

    def soup() -> Any:
        if "soup" not in cache:
            cache["soup"] = safe(lambda: _dom.parse_html(html or ""), None)
        return cache["soup"]

    return Ctx(page_url, site_entity_names, o, objs, soup)


def apply_locator(loc: dict[str, Any], type_: str, fid: str, ctx: Ctx) -> Any:
    v = _apply_locator_raw(loc, type_, fid, ctx)
    # Fix 14: a taxonomy url equal to the page's own URL is not a value (C2: own-page key exempt).
    own_key = ctx.opts.get("own_page_key")
    if (v is not None and type_ == "url" and is_tax_id(fid)
            and not (own_key and fid == TAX_PREFIX + own_key)):
        own = url_key(ctx.page_url)
        if own and url_key(v, ctx.page_url) == own:
            return None
    return v


def _apply_locator_raw(loc: dict[str, Any], type_: str, fid: str, ctx: Ctx) -> Any:
    action_ids = ctx.opts.get("action_ids")
    flags = {"action": bool(action_ids) and fid in action_ids}
    try:
        if is_alias(loc):
            return validate_value(type_, (ctx.values or {}).get(loc.get("from")), ctx.page_url,
                                  fid, flags)
        if is_classifier(loc):
            return validate_value(type_, _classifier_value(loc, ctx), ctx.page_url, fid, flags)
        if is_derived(loc):
            src = (ctx.values or {}).get(loc["derived_from"])
            return validate_value(type_, derive_address_part(src, loc.get("part")), ctx.page_url,
                                  fid, flags)
        if loc.get("tier") == "jsonld":
            objs = ctx.objs()
            if loc.get("prefer"):
                pref = {t.lower() for t in loc["prefer"]}

                def hit(o: dict[str, Any]) -> bool:
                    return any(t.lower() in pref for t in types_of(o))

                objs = [o for o in objs if hit(o)] + [o for o in objs if not hit(o)]
            for o in objs:
                if classify_subject(o, ctx.site_entity_names, ctx.opts) != loc.get("subject"):
                    continue
                if type_ in ("address", "geo"):
                    for r in walk_raw(o, loc.get("path") or []):
                        v = validate_value(type_, r, ctx.page_url, fid, flags)
                        if v is not None:
                            return v
                    continue
                vals: list[Any] = extract_json_ld(o, loc.get("path") or [])
                # Fix (shared-property item filter on single values, 2026-10-22).
                one_sep = (len(vals) == 1 and isinstance(vals[0], str)
                           and bool(re.search(r"[,;|]", vals[0])))
                words = loc.get("item_words")
                if words is not None and (type_ == "list" or len(vals) > 1 or one_sep):
                    vals = filter_items(vals, words) if words else []
                v = validate_value(type_, to_raw(type_, vals), ctx.page_url, fid, flags)
                if v is not None:
                    return v
            return None
        soup = ctx.soup()
        if soup is None:
            return None
        plain = not is_tax_id(fid) and not is_extra_id(fid)
        css_tier = loc.get("tier") == "css" and not is_derived(loc)
        # Staging schema: actions read every matched button / link as "label␟url".
        if plain and key_of(fid) == "actions" and css_tier:
            return validate_value(type_, _read_actions(soup, loc, ctx.page_url), ctx.page_url,
                                  fid, flags)
        # Staging schema: videos (objects) and gallery images (URLs).
        if plain and key_of(fid) == "videos" and css_tier:
            return _read_videos(soup, loc, ctx.page_url)
        if plain and key_of(fid) == "gallery" and css_tier:
            return _read_images(soup, loc, ctx.page_url)
        # Staging schema: structured entries (awards, education), one object per block.
        if plain and type_ == "list" and loc.get("item_fields") is not None:
            return _read_items(soup, loc, ctx.page_url)
        if type_ == "phone":
            fax_guard = not re.search("fax", fid, re.IGNORECASE) if is_tax_id(fid) else key_of(fid) != "fax"
        else:
            fax_guard = False
        extra_mode = is_extra_id(fid)
        raw = apply_css(soup, loc, fax_guard, type_ == "url" and is_tax_id(fid),
                        type_ == "text" and not loc.get("multi"), type_ == "list", extra_mode)
        words = loc.get("item_words")
        if words is not None and raw is not None:
            items = filter_items(raw, words) if words else []
            raw = (items if type_ == "list" else items[0]) if items else None
        # Staging schema: the locator call decided that comma-separated parts are separate.
        if loc.get("split_commas") and raw is not None and (type_ == "list" or extra_mode):
            parts: list[Any] = []
            for x in raw if isinstance(raw, list) else [raw]:
                if isinstance(x, str):
                    parts.extend(trim(p) for p in x.split(","))
                else:
                    parts.append(x)
            parts = [x for x in parts if x != "" and x is not None]
            raw = parts or None
        if extra_mode and raw is not None:
            # C14b: extras strip leading separators.
            if isinstance(raw, list):
                raw = [_strip_leading_separator(x) if isinstance(x, str) else x for x in raw]
                raw = [x for x in raw if x != ""]
            elif isinstance(raw, str):
                raw = _strip_leading_separator(raw)
            if (isinstance(raw, list) and not raw) or raw == "":
                raw = None
        return validate_value(type_, raw, ctx.page_url, fid, flags)
    except Exception:  # noqa: BLE001 — TS catch-all
        return None


def tax_subject_of(fid: str, f: dict[str, Any], opts: dict[str, Any]) -> str | None:
    """Subject of a taxonomy field: saved subject, else JSON-LD locator subject, else learning."""
    saved = f.get("subject")
    if saved:
        return saved
    loc = f.get("locator") or {}
    if loc.get("tier") == "jsonld":
        return loc.get("subject")
    return (opts.get("tax_subjects") or {}).get(fid)


def _contract_entries(contract: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    return [
        *[(fid, f) for fid, f in (contract.get("fields") or {}).items() if not is_extra_id(fid)],
        *[(TAX_PREFIX + slug, f) for slug, f in (contract.get("taxonomy_fields") or {}).items()],
    ]


_ADDR_PARTS = ("street", "city", "state", "postal_code")


def page_address_lines(values: dict[str, Any]) -> list[str]:
    """C8: normalised address lines of the page."""
    out: list[str] = []
    for subj in ("person", "location"):
        b = values.get(f"{subj}.address_block")
        if b is not None:
            n = norm_val(b)
            if n and n not in out:
                out.append(n)
        parts = [values.get(f"{subj}.{k}") for k in _ADDR_PARTS]
        if all(p is not None for p in parts):
            n = "".join(norm_val(p) for p in parts)
            if n and n not in out:
                out.append(n)
    return [n for n in out if len(n) >= 8]


def apply_site_contract(
    input_: Any,
    page_url: str,
    contract: dict[str, Any],
    site_entity_names: set[str],
    opts0: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Apply a contract to one page. ``input_`` is raw HTML or a pre-parsed document.

    Returns ``{values, missing, rejected, rejectedAddress, rejectedPhoto, firmRelabelled}``.
    """
    contract = contract or {}
    o0 = norm_opts(opts0)
    action_ids = set(o0.get("action_ids") or [])
    logo_ids = set(o0.get("logo_ids") or [])
    for slug, f in (contract.get("taxonomy_fields") or {}).items():
        if f.get("action"):
            action_ids.add(TAX_PREFIX + slug)
        if f.get("logo"):
            logo_ids.add(TAX_PREFIX + slug)
    opts = {
        **o0,
        "own_page_key": o0["own_page_key"] if o0.get("own_page_key") is not None
        else contract.get("own_page_key"),
        "action_ids": action_ids,
        "logo_ids": logo_ids,
        "primary": o0["primary"] if o0.get("primary") is not None
        else contract.get("primary_subject"),
    }
    values: dict[str, Any] = {}
    missing: list[str] = []
    rejected: list[str] = []
    ctx = ctx_for(input_, page_url, site_entity_names, opts).with_values(values)
    entries = _contract_entries(contract)
    # Pass 1 direct, pass 2 (Fix 8) derived, pass 3 (C1) aliases, pass 4 (Fix 12) classifiers.
    pending: list[tuple[str, dict[str, Any]]] = []
    aliases: list[tuple[str, dict[str, Any]]] = []
    classified: list[tuple[str, dict[str, Any]]] = []
    for fid, f in entries:
        loc = f.get("locator")
        if is_classifier(loc):
            classified.append((fid, f))
            continue
        if is_alias(loc):
            aliases.append((fid, f))
            continue
        if is_derived(loc):
            pending.append((fid, f))
            continue
        v = apply_locator(loc, f.get("type"), fid, ctx)
        if v is None and f.get("backup"):
            if is_derived(f["backup"]):
                pending.append((fid, f))
                continue
            v = apply_locator(f["backup"], f.get("type"), fid, ctx)
        if v is not None:
            values[fid] = v
    for fid, f in pending:
        loc = f["locator"] if is_derived(f.get("locator")) else f["backup"]
        v = apply_locator(loc, f.get("type"), fid, ctx)
        if v is not None:
            values[fid] = v
    for group in (aliases, classified):
        for fid, f in group:
            v = apply_locator(f["locator"], f.get("type"), fid, ctx)
            if v is not None:
                values[fid] = v
    # Fix (business name checked against page heading, 2026-10-22).
    biz = values.get("location.business_name")
    if isinstance(biz, str) and trim(biz):
        sh = ctx.soup()
        h1 = trim(_WS.sub(" ", clean_text(_dom.text(_dom.select_first(sh, "h1"))))) if sh else ""

        def squash(x: str) -> str:
            return re.sub(r"[^a-z0-9]+", "", x.lower())

        kh = squash(h1) if h1 else ""
        kb = squash(biz)
        if (len(kh) >= 3 and kh != kb and (kb.startswith(kh) or kb.endswith(kh))
                and len(kh) >= 0.6 * len(kb)):
            for fid, v in list(values.items()):
                if isinstance(v, str) and v == biz:
                    values[fid] = h1
    # Staging schema: embedded videos in the main content when no rule gave any.
    if contract.get("media_scan") and contract.get("primary_subject"):
        vid = f"{contract['primary_subject']}.videos"
        if values.get(vid) is None:
            sp = ctx.soup()
            v = _scan_videos(sp, page_url) if sp is not None else None
            if v:
                values[vid] = v
    # C1 safety net: a non-person taxonomy value equal to the page's person name.
    pn = norm_val(values["person.name"]) if values.get("person.name") is not None else ""
    if pn:
        for fid, f in entries:
            if not is_tax_id(fid) or values.get(fid) is None:
                continue
            subj = tax_subject_of(fid, f, opts)
            if subj and subj != "person" and norm_val(values[fid]) == pn:
                del values[fid]
                rejected.append(fid)
    # C8 address safety net.
    rejected_address: list[str] = []
    addr = page_address_lines(values)
    if addr:
        for fid, f in entries:
            if not is_tax_id(fid) or values.get(fid) is None or f.get("type") == "address":
                continue
            nv = norm_val(values[fid])
            if nv and any(nv == a or a in nv for a in addr):
                del values[fid]
                rejected.append(fid)
                rejected_address.append(fid)
    # C9 logo net: a logo value equal to the page's person photo is not a logo.
    rejected_photo: list[str] = []
    photo = url_key(values.get("person.photo_url"), page_url)
    if photo:
        for fid, _f in entries:
            if values.get(fid) is None:
                continue
            is_logo = fid in logo_ids if is_tax_id(fid) else key_of(fid) == "logo_url"
            if not is_logo or url_key(values[fid], page_url) != photo:
                continue
            del values[fid]
            if is_tax_id(fid):
                rejected.append(fid)
                rejected_photo.append(fid)
    # C9: fill missing address parts from the universal parts when consistent.
    for fid, f in entries:
        if not is_tax_id(fid) or f.get("type") != "address":
            continue
        v = values.get(fid)
        if not isinstance(v, dict):
            continue
        subj = tax_subject_of(fid, f, opts)
        if subj not in ("location", "person"):
            continue
        prefixes = ["person", "location"] if subj == "person" else ["location"]
        prefix = next((p for p in prefixes
                       if any(values.get(f"{p}.{k}") is not None for k in _ADDR_PARTS)), None)
        if not prefix:
            continue
        values[fid] = fill_address_parts(v, {
            "street": values.get(f"{prefix}.street"), "city": values.get(f"{prefix}.city"),
            "state": values.get(f"{prefix}.state"),
            "postal_code": values.get(f"{prefix}.postal_code"),
        })
    # C9: a person/branch taxonomy value equal to a firm_profile value belongs to the firm.
    firm_relabelled: list[str] = []
    fp_values = ((contract.get("firm_profile") or {}).get("values") or {})
    firm_vals = {n for n in (("" if x is None else norm_val(x)) for x in fp_values.values()) if n}
    if firm_vals:
        for fid, f in entries:
            if not is_tax_id(fid) or values.get(fid) is None:
                continue
            if tax_subject_of(fid, f, opts) == "firm":
                continue
            if norm_val(values[fid]) in firm_vals:
                firm_relabelled.append(fid)
    for fid, _f in entries:
        if values.get(fid) is None:
            missing.append(fid)
    return {
        "values": values, "missing": missing, "rejected": rejected,
        "rejectedAddress": rejected_address, "rejectedPhoto": rejected_photo,
        "firmRelabelled": firm_relabelled,
    }


def _same_postal(a: Any, b: Any) -> bool:
    def z(x: Any) -> str:
        m = re.search(r"\d{5}", "" if x is None else js_str(x))
        return m.group(0) if m else ""

    return bool(z(a)) and z(a) == z(b)


def fill_address_parts(a: dict[str, Any], u: dict[str, Any]) -> dict[str, Any]:
    """C9: fill missing parts only when the object agrees with the universal parts."""

    def s(x: Any) -> str:
        if isinstance(x, str) and trim(x):
            return trim(x)
        return js_str(x) if is_num(x) else ""

    if a.get("postalCode") and s(u.get("postal_code")) and not _same_postal(
            a["postalCode"], u.get("postal_code")):
        return a
    zip_ok = bool(a.get("postalCode")) and _same_postal(a["postalCode"], u.get("postal_code"))
    city_ok = (bool(a.get("addressLocality")) and bool(s(u.get("city")))
               and a["addressLocality"].lower() == s(u.get("city")).lower())
    if not zip_ok and not city_ok:
        return a
    out = dict(a)
    for ak, uk in (("streetAddress", "street"), ("addressLocality", "city"),
                   ("addressRegion", "state"), ("postalCode", "postal_code")):
        if not out.get(ak) and s(u.get(uk)):
            out[ak] = s(u.get(uk))
    return out


__all__ = [
    "ACTION_SEP", "Ctx", "apply_css", "apply_locator", "apply_site_contract", "block_text",
    "collect_all_credential_texts", "collect_all_same_as_urls", "ctx_for", "decode_action",
    "encode_action", "extra_text", "fill_address_parts", "find_label_el", "group_by_parent",
    "is_parsed_doc", "nearest_heading", "norm_label", "url_key", "video_from_url",
]
