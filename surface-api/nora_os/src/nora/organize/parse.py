"""Pure: HTML → CandidateFacts (port of lib/nora/organize/parse.ts). No network, no DB.

Every parse step is the shared ETL code (the disco site contract's JSON-LD reader + formats, the
sameAs / credential classifiers, via `surfaces.nora_os.internal.disco`); this file only arranges
their outputs into the interview's candidate shape. Nothing here is category-specific. cheerio → BeautifulSoup
(`html.parser`); element text keeps script/style text and drops comments, as cheerio's .text().
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from bs4 import BeautifulSoup, Comment, Declaration, Doctype, NavigableString, Tag
from bs4.element import ProcessingInstruction

from surfaces.nora_os.internal import disco
from surfaces.nora_os.internal.jsutil import iso_now

TEXT_BLOCK_CAP = 150
TEXT_CHAR_CAP = 20_000
LINK_CAP = 300
CRED_CAP = 50
# Credential-ish labels in visible text (license numbers, registry ids). Generic.
CRED_TEXT_RE = re.compile(r"\b(lic(?:en[cs]e)?\.?\s*(?:#|no\b|num(?:ber)?\b)|nmls|crd|npn)", re.IGNORECASE)
# Words that never identify an owner's domain on their own.
NAME_STOP = frozenset(
    {
        "the", "and", "for", "with", "inc", "llc", "ltd", "corp", "company", "group", "services",
        "official", "home", "site", "website", "online",
    }
)
_WS = re.compile(r"\s+")
_DEFAULT_PORT = {"http": "80", "https": "443"}
_SKIP_STRINGS = (Comment, Declaration, Doctype, ProcessingInstruction)


# ── URL helpers (WHATWG URL semantics for the parts the TS relied on) ─────


def _split(url: str):
    """`new URL(url)` → SplitResult, or None when it would throw (no scheme / bad port)."""
    try:
        u = urlsplit(str(url).strip())
        if not u.scheme or not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*$", u.scheme):
            return None
        _ = u.port  # raises on an invalid port, as URL() does
        return u
    except ValueError:
        return None


def _host(u) -> str:
    """URL.host: lowercase hostname, plus the port unless it is the scheme default."""
    host = (u.hostname or "").lower()
    port = u.port
    if port is not None and str(port) != _DEFAULT_PORT.get(u.scheme.lower()):
        host = f"{host}:{port}"
    return host


def host_of(url: str) -> str | None:
    """Host without "www."; None when the URL does not parse."""
    u = _split(url)
    if u is None:
        return None
    return re.sub(r"^www\.", "", _host(u))


def registrable_domain(host: str) -> str:
    """Registrable domain (naive eTLD+1, with the common two-level ccTLD suffixes)."""
    parts = host.split(".")
    if len(parts) <= 2:
        return host
    sld = parts[-2]
    tld = parts[-1]
    two_level = len(tld) == 2 and re.match(r"^(co|com|net|org|gov|edu|ac)$", sld) is not None
    return ".".join(parts[-3:] if two_level else parts[-2:])


def _url_string(u, *, drop_hash: bool) -> str:
    """URL.prototype.toString for a parsed http(s)-style URL."""
    scheme = u.scheme.lower()
    host = _host(u)
    auth = ""
    if u.username is not None:
        auth = u.username + (f":{u.password}" if u.password is not None else "") + "@"
    path = u.path or ("/" if host else "")
    frag = "" if drop_hash else u.fragment
    return urlunsplit((scheme, auth + host, path, u.query, frag))


def absolute_url(raw: str, page_url: str) -> str | None:
    """Absolute https URL; accepts scheme-less "www.example.com" values (common in sameAs)."""
    s = str(raw if raw is not None else "").strip()
    if not s or s.startswith("#") or re.match(r"^(javascript|mailto|tel|sms):", s, re.IGNORECASE):
        return None
    with_scheme = f"https://{s}" if re.match(r"^(www\.|[a-z0-9-]+\.[a-z]{2,}(/|$))", s, re.IGNORECASE) else s
    u = disco.format_url(with_scheme, page_url)
    if not u:
        return None
    x = _split(u)
    if x is None:
        return None
    return _url_string(x, drop_hash=True)


def _rule_test(test: Any, url: str) -> bool:
    if hasattr(test, "search"):
        return test.search(url) is not None
    return bool(test(url))


def platform_of(url: str) -> str | None:
    """Platform label for a URL from the sameAs platform rules (first urlTest that matches)."""
    if disco.to_place_id(url):
        return "Google Business Profile"
    for label, test in disco.same_as_platform_rules():
        if _rule_test(test, url):
            return label
    return None


def _path_depth(url: str) -> int:
    u = _split(url)
    if u is None:
        return 0
    return len([p for p in (u.path or "/").split("/") if p])


def _name_tokens(*names: str | None) -> list[str]:
    out: list[str] = []
    for n in names:
        for t in re.split(r"[^a-z0-9]+", str(n if n is not None else "").lower()):
            if len(t) >= 4 and t not in NAME_STOP and t not in out:
                out.append(t)
    return out


def _first_string(v: Any) -> str | None:
    if isinstance(v, str) and v.strip():
        return v.strip()
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return _js_num_str(v)
    if isinstance(v, list):
        for x in v:
            s = _first_string(x)
            if s:
                return s
    return None


def _js_num_str(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def _page_entity(objs: list[dict]) -> dict | None:
    """The page's own entity: first object carrying NAP data, else the first entity-typed one."""
    for o in objs:
        if isinstance(o.get("name"), str) and (
            o.get("address") is not None or o.get("telephone") is not None
        ):
            return o
    ent_re = disco.entity_type_re()
    for o in objs:
        if isinstance(o.get("name"), str) and any(
            ent_re.search(t) for t in disco.json_ld_types(o)
        ):
            return o
    return None


# ── cheerio stand-ins ─────────────────────────────────────────────────────


def _text(el: Tag | None) -> str:
    """cheerio `.text()`: every descendant text node (script/style included, comments not)."""
    if el is None:
        return ""
    return "".join(
        str(s)
        for s in el.descendants
        if isinstance(s, NavigableString) and not isinstance(s, _SKIP_STRINGS)
    )


def _attr(el: Tag | None, name: str) -> str | None:
    if el is None:
        return None
    v = el.get(name)
    if isinstance(v, list):  # bs4 splits multi-valued attributes (class, rel)
        return " ".join(v)
    return v


def _load(html: str) -> BeautifulSoup | None:
    try:
        return BeautifulSoup(html or "", "html.parser")
    except Exception:  # noqa: BLE001 — cheerio's load never throws; keep the `$: null` branch reachable
        return None


def _text_blocks(soup: BeautifulSoup) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    chars = 0

    def push(kind: str, raw: str | None) -> None:
        nonlocal chars
        text = _WS.sub(" ", str(raw if raw is not None else "")).strip()
        if not text or text in seen or len(out) >= TEXT_BLOCK_CAP or chars + len(text) > TEXT_CHAR_CAP:
            return
        if kind == "paragraph" and len(text) < 20:
            return
        seen.add(text)
        chars += len(text)
        out.append({"kind": kind, "text": text})

    push("title", _text(soup.select_one("title")))
    for sel in ('meta[name="description"]', 'meta[property="og:description"]', 'meta[property="og:title"]'):
        push("meta", _attr(soup.select_one(sel), "content"))
    for el in soup.select("h1,h2,h3"):
        push("heading", _text(el))
    for el in soup.select("p,li"):
        push("paragraph", _text(el))
    return out


def _credential_candidates(soup: BeautifulSoup | None, objs: list[dict]) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()

    def add(text: str, via: str) -> None:
        t = _WS.sub(" ", text).strip()
        k = t.lower()
        if not t or k in seen or len(out) >= CRED_CAP:
            return
        seen.add(k)
        if re.search(r"\blic", t, re.IGNORECASE):
            hint = "license"
        elif re.search(r"\b(nmls|crd|npn)\b", t, re.IGNORECASE):
            hint = "registration"
        else:
            hint = None
        c = disco.to_credential(t, hint)
        cls = disco.classify_credential(t, [t])
        out.append(
            {
                "text": t,
                "parsed": dict(c) if c else None,
                "label": cls.get("label") if cls["recognized"] and cls["value"] else None,
                "via": via,
            }
        )

    for t in disco.collect_all_credential_texts(objs):
        add(t, "jsonld_hasCredential")
    if soup is not None:
        body = soup.find("body")
        # Deepest short element whose text carries a license / registry label.
        for el in body.find_all(True) if isinstance(body, Tag) else []:
            text = _WS.sub(" ", _text(el)).strip()
            if len(text) > 160 or not CRED_TEXT_RE.search(text):
                continue
            if any(CRED_TEXT_RE.search(_text(c)) for c in el.find_all(True, recursive=False)):
                continue
            add(text, "page_text")
    return out


def parse_candidate_facts(
    html: str,
    *,
    source_url: str,
    resolved_url: str | None = None,
    fetched_at: str | None = None,
    entity_name: str | None = None,
    status_code: int | None = None,
) -> dict:
    """HTML → CandidateFacts (the TS shape: source_url, resolved_url, fetched_at, jsonld, nap,
    place_id, sameAs, credentials, links, text, blocked). Pure."""
    page_url = resolved_url or source_url
    soup = _load(html or "")
    try:
        objs = disco.parse_document_objs(html or "", page_url)
    except Exception:  # noqa: BLE001
        objs = []
    blocks = disco.extract_json_ld_blocks(html or "")
    entity = _page_entity(objs)

    # ---- NAP ----
    name = _first_string((entity or {}).get("name"))
    name_src = "jsonld" if name else None
    if not name and soup is not None:
        og = (_attr(soup.select_one("meta[property='og:site_name']"), "content") or "").strip()
        name = og or _WS.sub(" ", _text(soup.select_one("h1"))).strip() or None
        name_src = "html" if name else None
    address = disco.normalize_address((entity or {}).get("address"))
    addr_src = "jsonld" if address else None
    if not address and soup is not None:
        raw = _text(soup.select_one("address")) or _text(soup.select_one('[itemprop="address"]'))
        address = disco.normalize_address(raw) if raw else None
        addr_src = "html" if address else None
    raw_phone = _first_string((entity or {}).get("telephone"))
    phone = disco.to_e164(disco.validate_value("phone", raw_phone, page_url)) if raw_phone else None
    phone_src = "jsonld" if phone else None
    if not phone and soup is not None:
        tel = _attr(soup.select_one('a[href^="tel:"]'), "href")
        phone = (
            disco.to_e164(disco.validate_value("phone", re.sub(r"^tel:", "", tel, flags=re.IGNORECASE), page_url))
            if tel
            else None
        )
        phone_src = "tel_link" if phone else None

    # ---- own domains ----
    own_hosts = {h for h in (host_of(source_url), host_of(page_url)) if h}
    own_registrable = {registrable_domain(h) for h in own_hosts}
    site_home = _path_depth(page_url) <= 1
    tokens = _name_tokens(entity_name, name, _first_string((entity or {}).get("legalName")))

    # ---- sameAs + links ----
    same_as: list[dict] = []
    same_as_seen: set[str] = set()
    owned: list[dict] = []
    owned_seen: set[str] = set()
    place_id: str | None = None

    def add_owned(url: str, reason: str) -> None:
        h = host_of(url)
        if not h or h in own_hosts or h in owned_seen:
            return
        owned_seen.add(h)
        owned.append({"url": url, "reason": reason})

    def external(url: str, via: str) -> None:
        nonlocal place_id
        if place_id is None:
            place_id = disco.to_place_id(url)
        platform = platform_of(url)
        if (platform or via == "jsonld_sameAs") and url not in same_as_seen:
            same_as_seen.add(url)
            same_as.append({"url": url, "platform": platform, "via": via})
        if platform:
            return
        h = host_of(url)
        if not h:
            return
        if via == "jsonld_sameAs":
            add_owned(url, "jsonld_sameAs")
            return
        # Sibling subdomains are the entity's own only when this page is a site home; on a
        # profile hosted deep inside a larger site they belong to the host.
        if registrable_domain(h) in own_registrable:
            if site_home:
                add_owned(url, "brand_domain_match")
            return
        host_labels = ".".join(h.split(".")[:-1])
        if any(t in host_labels for t in tokens):
            add_owned(url, "name_domain_match")

    for raw_url in disco.collect_all_same_as_urls(blocks):
        u = absolute_url(raw_url, page_url)
        if u:
            external(u, "jsonld_sameAs")
    internal: list[str] = []
    internal_seen: set[str] = set()
    if soup is not None:
        for el in soup.select("a[href]"):
            u = absolute_url(_attr(el, "href") or "", page_url)
            if not u:
                continue
            h = host_of(u)
            if h and h in own_hosts:
                if u not in internal_seen and len(internal) < LINK_CAP:
                    internal_seen.add(u)
                    internal.append(u)
            else:
                external(u, "page_link")

    return {
        "source_url": source_url,
        "resolved_url": resolved_url,
        "fetched_at": fetched_at if fetched_at is not None else iso_now(),
        "jsonld": objs,
        "nap": {
            "name": name,
            "address": address,
            "phone": phone,
            "source": {"name": name_src, "address": addr_src, "phone": phone_src},
        },
        "place_id": place_id,
        "sameAs": same_as,
        "credentials": _credential_candidates(soup, objs),
        "links": {"internal": internal, "ownedCandidates": owned},
        "text": _text_blocks(soup) if soup is not None else [],
        "blocked": disco.looks_blocked(status_code if status_code is not None else 200, html),
    }
