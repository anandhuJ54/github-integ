"""JSON-LD tier: the one JSON-LD reader, page-entity evidence and embedded application state."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any, TypeVar

from ._js import is_num, js_str, json_stringify, trim, try_url

T = TypeVar("T")
LdObj = dict[str, Any]


def safe(fn: Callable[[], T], fallback: T) -> T:
    try:
        return fn()
    except Exception:  # noqa: BLE001 — TS catch-all
        return fallback


_LD_RE = re.compile(
    r"<script[^>]*type\s*=\s*[\"']?application/ld\+json[\"']?[^>]*>([\s\S]*?)</script>", re.IGNORECASE
)


def extract_json_ld_blocks(html: str) -> list[Any]:
    """Every application/ld+json block on a page as parsed JSON (malformed blocks skipped)."""
    out: list[Any] = []
    for m in _LD_RE.finditer(html or ""):
        try:
            out.append(json.loads(trim(m.group(1))))
        except (ValueError, RecursionError):
            pass
    return out


def deep_find_key(
    obj: Any, target: str, path: list[str | int] | None = None
) -> dict[str, Any] | None:
    """First value under key ``target`` (exact) and its path, or None."""
    path = path or []
    if obj is None:
        return None
    if isinstance(obj, list):
        for i, x in enumerate(obj):
            found = deep_find_key(x, target, [*path, i])
            if found:
                return found
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == target:
                return {"value": v, "path": [*path, k]}
            found = deep_find_key(v, target, [*path, k])
            if found:
                return found
    return None


#: Entity-like schema.org @type (deliberately broad).
ENTITY_TYPE_RE = re.compile(
    r"person|organization|localbusiness|professionalservice|financialservice|attorney|"
    r"medicalbusiness|store|corporation",
    re.IGNORECASE,
)


def json_ld_types(obj: dict[str, Any]) -> list[str]:
    t = obj.get("@type")
    if isinstance(t, str):
        return [t]
    if isinstance(t, list):
        return [x for x in t if isinstance(x, str)]
    return []


def collect_site_entity_names(html: str) -> set[str]:
    """Lowercased, trimmed names of every entity-typed JSON-LD node (homepage brand names)."""
    out: set[str] = set()
    stack: list[Any] = list(extract_json_ld_blocks(html))
    guard = 0
    while stack and guard < 5000:
        guard += 1
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        name = node.get("name")
        if (isinstance(name, str) and trim(name)
                and any(ENTITY_TYPE_RE.search(x) for x in json_ld_types(node))):
            out.add(trim(name).lower())
        for v in node.values():
            if isinstance(v, (dict, list)):
                stack.append(v)
    return out


JSONLD_SKIP_KEYS = {
    "author", "publisher", "creator", "contributor", "editor", "provider", "brand",
    "parentOrganization", "worksFor", "memberOf", "sponsor", "funder", "seller",
    "copyrightHolder", "isPartOf", "about",
}


def has_page_specific_entity_json_ld(html: str, site_entity_names: set[str]) -> bool:
    """Entity-typed JSON-LD node with a name that is not one of the site's own entities."""
    stack: list[Any] = list(extract_json_ld_blocks(html))
    guard = 0
    while stack and guard < 5000:
        guard += 1
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
            continue
        if not isinstance(node, dict):
            continue
        name = node.get("name")
        if (isinstance(name, str) and trim(name)
                and any(ENTITY_TYPE_RE.search(x) for x in json_ld_types(node))
                and trim(name).lower() not in site_entity_names):
            return True
        for k, v in node.items():
            if k in JSONLD_SKIP_KEYS:
                continue
            if isinstance(v, (dict, list)):
                stack.append(v)
    return False


# ---------------------------------------------------------------------------
# Fix (profile-page check, 2026-10-06): which entity on a page belongs to the page.
# ---------------------------------------------------------------------------
PAGE_NONPROFILE_TYPE_RE = re.compile(
    r"residence|house|apartment|accommodation|^place$|city|^state$|country|administrativearea|"
    r"neighborhood|attraction|landform|vehicle|movie|book|recipe|course|brand",
    re.IGNORECASE,
)

NON_ENTITY_TYPES = {
    "webpage", "website", "profilepage", "aboutpage", "contactpage", "collectionpage",
    "searchresultspage", "breadcrumblist", "itemlist", "listitem", "searchaction", "imageobject",
    "videoobject", "faqpage", "question", "answer", "article", "blogposting", "newsarticle",
    "product", "offer", "review", "aggregaterating", "rating", "postaladdress", "geocoordinates",
    "contactpoint", "sitenavigationelement", "wpheader", "wpfooter", "event", "howto",
    "creativework", "thing", "readaction", "entrypoint",
}


def types_of(o: LdObj) -> list[str]:
    t = o.get("@type")
    return [x for x in (t if isinstance(t, list) else [t]) if isinstance(x, str)]


def is_entity_typed(o: LdObj) -> bool:
    return any(t.lower() not in NON_ENTITY_TYPES for t in types_of(o))


def norm_page_url(u: Any, base: str | None = None) -> str | None:
    if not isinstance(u, str) or not trim(u):
        return None
    x = try_url(trim(u), base)
    if x is None or x.protocol not in ("http:", "https:"):
        return None
    host = re.sub(r"^www\.", "", x.host.lower(), count=1)
    return f"{host}{re.sub(r'/+$', '', x.pathname, count=1).lower()}"


def norm_name(s: str) -> str:
    return trim(re.sub(r"[^a-z0-9]+", " ", s.lower().replace("&amp;", "&")))


def page_heading_text(html: str) -> str:
    h = html or ""
    h1 = re.search(r"<h1\b[^>]*>([\s\S]*?)</h1>", h, re.IGNORECASE)
    og = re.search(r"<meta[^>]+property=[\"']og:title[\"'][^>]*content=[\"']([^\"']*)[\"']", h,
                   re.IGNORECASE)
    title = re.search(r"<title[^>]*>([\s\S]*?)</title>", h, re.IGNORECASE)
    parts = [m.group(1) for m in (h1, og, title) if m and m.group(1)]
    return norm_name(re.sub(r"<[^>]+>", " ", " ".join(parts)))


def _page_entity_candidates(html: str, site_entity_names: set[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    guard = [0]

    def visit(v: Any, depth: int, main_entity: bool) -> None:
        if depth > 8 or v is None:
            return
        guard[0] += 1
        if guard[0] - 1 > 5000:
            return
        if isinstance(v, list):
            for x in v:
                visit(x, depth + 1, main_entity)
            return
        if not isinstance(v, dict):
            return
        o = v
        types = types_of(o)
        name = trim(o["name"]) if isinstance(o.get("name"), str) else ""
        if (name and types and is_entity_typed(o)
                and not any(PAGE_NONPROFILE_TYPE_RE.search(t) for t in types)
                and name.lower() not in site_entity_names):
            out.append({"o": o, "name": norm_name(name), "mainEntity": main_entity})
        wrapper = any(re.search(r"page$", t, re.IGNORECASE) for t in types)
        for k, val in o.items():
            if k in JSONLD_SKIP_KEYS or not isinstance(val, (dict, list)):
                continue
            visit(val, depth + 1,
                  True if (k == "mainEntity" and wrapper) else main_entity if k == "@graph"
                  else False)

    for b in extract_json_ld_blocks(html):
        visit(b, 0, False)
    if not out:
        for e in safe(lambda: collect_embedded_entities(html), []):
            name = trim(e["name"]) if isinstance(e.get("name"), str) else ""
            if name and name.lower() not in site_entity_names:
                out.append({"o": e, "name": norm_name(name), "mainEntity": False})
    return [c for c in out if len(c["name"]) >= 2]


def _tie_of(c: dict[str, Any], page_keys: set[str], heading: str, page_url: str) -> str | None:
    for k in ("url", "@id"):
        n = norm_page_url(c["o"].get(k), page_url)
        if n and n in page_keys:
            return "url"
    if c["mainEntity"]:
        return "main_entity"
    if len(c["name"]) >= 4 and heading and f" {c['name']} " in f" {heading} ":
        return "heading"
    return None


def _page_keys_of(html: str, page_url: str) -> set[str]:
    keys: set[str] = set()
    own = norm_page_url(page_url)
    if own:
        keys.add(own)
    h = html or ""
    canon = re.search(r"<link[^>]+rel=[\"']canonical[\"'][^>]*href=[\"']([^\"']+)[\"']", h, re.IGNORECASE) \
        or re.search(r"<link[^>]+href=[\"']([^\"']+)[\"'][^>]*rel=[\"']canonical[\"']", h, re.IGNORECASE)
    c = norm_page_url(canon.group(1), page_url) if canon else None
    if c:
        keys.add(c)
    return keys


def page_entity_evidence(
    html: str, page_url: str, site_entity_names: set[str], primary: str | None = None
) -> dict[str, Any]:
    """What the page's entities say about it: one profile, a listing, or nothing decisive."""
    all_c = safe(lambda: _page_entity_candidates(html, site_entity_names), [])

    def is_person(c: dict[str, Any]) -> bool:
        return "Person" in types_of(c["o"])

    persons = [c for c in all_c if is_person(c)]
    if primary == "person":
        cands = persons if persons else all_c
    elif primary == "location":
        cands = [c for c in all_c if not is_person(c)]
    else:
        cands = all_c
    names: list[str] = []
    for c in cands:
        if c["name"] not in names:
            names.append(c["name"])
    if not names:
        return {"kind": "none", "entities": 0, "tied": 0}
    keys = _page_keys_of(html, page_url)
    heading = page_heading_text(html)
    tied: dict[str, str] = {}
    for c in cands:
        t = _tie_of(c, keys, heading, page_url)
        if t and c["name"] not in tied:
            tied[c["name"]] = t
    if len(tied) == 1:
        name, tie = next(iter(tied.items()))
        return {"kind": "profile", "entities": len(names), "tied": 1, "tie": tie, "name": name}
    if len(tied) > 1:
        return {"kind": "ambiguous", "entities": len(names), "tied": len(tied)}
    if len(names) >= 2:
        return {"kind": "listing", "entities": len(names), "tied": 0}
    return {"kind": "single_untied", "entities": 1, "tied": 0, "name": names[0]}


def order_by_page_tie(
    objs: list[LdObj], html: str, page_url: str, primary: str | None = None
) -> list[LdObj]:
    """The page's own entity first (when exactly one entity name is tied to the page)."""
    if len(objs) < 2 or not page_url:
        return objs
    ev = safe(lambda: page_entity_evidence(html, page_url, set(), primary),
              {"kind": "none", "entities": 0, "tied": 0})
    if ev["kind"] != "profile" or not ev.get("name"):
        return objs

    def own(o: LdObj) -> bool:
        return isinstance(o.get("name"), str) and norm_name(o["name"]) == ev["name"]

    return [o for o in objs if own(o)] + [o for o in objs if not own(o)]


def collect_json_ld_objects(html: str) -> list[LdObj]:
    """Every @type-carrying object on a page (@graph flattened, mainEntity followed)."""
    out: list[LdObj] = []

    def visit(v: Any, depth: int) -> None:
        if depth > 6 or v is None:
            return
        if isinstance(v, list):
            for x in v:
                visit(x, depth + 1)
            return
        if not isinstance(v, dict):
            return
        if v.get("@type") is not None:
            out.append(v)
        if v.get("@graph") is not None:
            visit(v["@graph"], depth + 1)
        if isinstance(v.get("mainEntity"), (dict, list)):
            visit(v["mainEntity"], depth + 1)

    for b in extract_json_ld_blocks(html):
        visit(b, 0)
    # Fix (P1 embedded data, 2026-10-05): pages without entity JSON-LD may carry their records
    # as application state; those are normalised to schema.org form.
    if not any(is_entity_typed(o) for o in out):
        out.extend(safe(lambda: collect_embedded_entities(html), []))
    return out


# ---------------------------------------------------------------------------
# P1 — data embedded in the page (no browser)
# ---------------------------------------------------------------------------
EMBEDDED_MAX_CHARS = 4_000_000
EMBEDDED_MAX_NODES = 60_000
EMBEDDED_MAX_ENTITIES = 50

_JSON_SCRIPT_RE = re.compile(
    r"<script[^>]*type\s*=\s*[\"']?application/json[\"']?[^>]*>([\s\S]*?)</script>", re.IGNORECASE
)
_ASSIGN_RE = re.compile(r"(?:window\.)?(__[A-Z0-9_]+__|__[A-Z0-9_]*STATE[A-Z0-9_]*)\s*=\s*(\{|\[)")


def extract_embedded_state(html: str) -> list[Any]:
    """Parsed application-state blobs embedded in the HTML (JSON only)."""
    out: list[Any] = []
    src = html or ""

    def try_parse(txt: str) -> None:
        t = trim(txt)
        if not t or len(t) > EMBEDDED_MAX_CHARS:
            return
        try:
            out.append(json.loads(t))
        except (ValueError, RecursionError):
            pass

    for m in _JSON_SCRIPT_RE.finditer(src):
        try_parse(m.group(1))
    for m in _ASSIGN_RE.finditer(src):
        start = m.end() - 1
        end = _match_bracket(src, start)
        if end > start:
            try_parse(src[start:end + 1])
    return out


def _match_bracket(s: str, start: int) -> int:
    """Index of the bracket closing the one at ``start`` (string-aware), or -1."""
    open_ = s[start]
    close = "}" if open_ == "{" else "]"
    depth = 0
    in_str: str | None = None
    limit = min(len(s), start + EMBEDDED_MAX_CHARS)
    i = start
    while i < limit:
        c = s[i]
        if in_str:
            if c == "\\":
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if c in ('"', "'"):
            in_str = c
        elif c == open_:
            depth += 1
        elif c == close:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def _nk(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", k.lower())


EK: dict[str, list[str]] = {
    "name": ["name", "fullname", "displayname", "agentname", "advisorname", "profilename",
             "businessname", "locationname", "officename", "storename"],
    "first": ["firstname", "givenname", "fname"],
    "last": ["lastname", "familyname", "surname", "lname"],
    "phone": ["phone", "phonenumber", "telephone", "tel", "mobile", "mobilephone",
              "mobilenumber", "cellphone", "cell", "officephone", "workphone", "directphone",
              "primaryphone", "businessphone", "contactphone"],
    "phones": ["phones", "phonenumbers", "telephones"],
    "email": ["email", "emailaddress", "mail", "contactemail", "primaryemail"],
    "url": ["url", "profileurl", "profilelink", "canonicalurl", "permalink", "detailurl",
            "pageurl", "link", "href", "path", "uri"],
    "website": ["website", "websiteurl", "homepage"],
    "image": ["image", "imageurl", "photo", "photourl", "avatar", "avatarurl", "headshot",
              "headshoturl", "profileimage", "profilephoto", "picture", "thumbnail"],
    "title": ["jobtitle", "title", "position", "designation", "role", "headline"],
    "bio": ["bio", "biography", "description", "about", "aboutme", "summary"],
    "address": ["address", "officeaddress", "location", "primaryaddress", "mailingaddress",
                "businessaddress", "streetaddress", "office", "primaryoffice", "branch",
                "officelocation"],
    "street": ["street", "streetaddress", "address1", "addressline1", "line1", "street1"],
    "city": ["city", "locality", "addresslocality", "town"],
    "state": ["state", "statecode", "region", "addressregion", "province", "stateabbr",
              "stateabbreviation"],
    "zip": ["zip", "zipcode", "postalcode", "postcode", "zip5"],
    "hours": ["hours", "openinghours", "businesshours", "officehours"],
    "personHint": ["firstname", "lastname", "jobtitle", "designation", "licensenumber", "license",
                   "nmls", "nmlsid", "headshot", "agentid", "advisorid"],
    "placeHint": ["businessname", "storename", "locationname", "storenumber", "hours",
                  "openinghours", "businesshours", "cuisine", "menu"],
}
EKS: dict[str, set[str]] = {k: set(v) for k, v in EK.items()}


def _pick_str(o: dict[str, Any], keys: set[str]) -> str | None:
    for k, v in o.items():
        if _nk(k) not in keys:
            continue
        if isinstance(v, str) and trim(v):
            return trim(v)
        if is_num(v):
            return js_str(v)
        if isinstance(v, dict):
            inner = None
            for ik in ("url", "href", "number", "value"):
                if v.get(ik) is not None:
                    inner = v[ik]
                    break
            if isinstance(inner, str) and trim(inner):
                return trim(inner)
    return None


def _pick_phone(o: dict[str, Any]) -> str | None:
    direct = _pick_str(o, EKS["phone"])
    if direct:
        return direct
    for k, v in o.items():
        if _nk(k) not in EKS["phones"] or not isinstance(v, list):
            continue
        for x in v:
            if isinstance(x, str) and trim(x):
                return trim(x)
            if isinstance(x, dict):
                n = _pick_str(x, {"number", "phone", "phonenumber", "value", "display"})
                if n:
                    return n
    return None


def _pick_address(o: dict[str, Any]) -> dict[str, str] | str | None:
    flat: dict[str, str] = {}
    street = _pick_str(o, EKS["street"])
    city = _pick_str(o, EKS["city"])
    state = _pick_str(o, EKS["state"])
    zip_ = _pick_str(o, EKS["zip"])
    if street:
        flat["streetAddress"] = street
    if city:
        flat["addressLocality"] = city
    if state:
        flat["addressRegion"] = state
    if zip_:
        flat["postalCode"] = zip_
    if city or zip_:
        return flat
    for k, v in o.items():
        if _nk(k) not in EKS["address"]:
            continue
        if isinstance(v, str) and len(trim(v)) > 6:
            return trim(v)
        if isinstance(v, dict):
            inner = _pick_address(v)
            if inner:
                return inner
    return flat if flat else None


# Two to four capitalised words with no business word.
PERSON_NAME_RE = re.compile(
    r"^(?!.*\b(?:llc|inc|corp|co|company|group|realty|properties|associates|partners|team|office|"
    r"bank|services|financial|insurance|agency|restaurant|cafe|bar|grill|the)\b)"
    r"[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]*,?){1,3}$",
    re.IGNORECASE,
)


def _normalise_embedded(o: dict[str, Any]) -> LdObj | None:
    keys = {_nk(k) for k in o}
    name = _pick_str(o, EKS["name"])
    first = _pick_str(o, EKS["first"])
    last = _pick_str(o, EKS["last"])
    if not name and (first or last):
        name = " ".join(x for x in (first, last) if x)
    if not name or len(name) > 120 or re.match(r"^https?:", name, re.IGNORECASE):
        return None
    phone = _pick_phone(o)
    email = _pick_str(o, EKS["email"])
    address = _pick_address(o)
    url = _pick_str(o, EKS["url"])
    image = _pick_str(o, EKS["image"])
    valid_email = email if email and "@" in email else None
    # At least one contact signal and two signals in all (navigation items are not records).
    if not (phone or valid_email or address):
        return None
    signals = len([x for x in (phone, valid_email, address, url, image) if x])
    if signals < 2:
        return None
    is_person = (
        any(k in EKS["personHint"] for k in keys)
        or bool(first or last)
        or (not any(k in EKS["placeHint"] for k in keys)
            and (bool(valid_email) or bool(PERSON_NAME_RE.match(name))))
    )
    out: LdObj = {"@type": "Person" if is_person else "LocalBusiness", "@embedded": True,
                  "name": name}
    if phone:
        out["telephone"] = phone
    if valid_email:
        out["email"] = valid_email
    if address:
        out["address"] = address
    if url:
        out["url"] = url
    website = _pick_str(o, EKS["website"])
    if website and not out.get("url"):
        out["url"] = website
    if image:
        out["image"] = image
    title = _pick_str(o, EKS["title"])
    if is_person and title and len(title) < 120:
        out["jobTitle"] = title
    bio = _pick_str(o, EKS["bio"])
    if bio and len(bio) > 40:
        out["description"] = bio
    hours = _pick_str(o, EKS["hours"])
    if not is_person and hours:
        out["openingHours"] = hours
    return out


def collect_embedded_entities(html: str) -> list[LdObj]:
    """Entity-like objects from the page's embedded application state, schema.org-shaped."""
    if not re.search(r"application/json|__[A-Z0-9_]+__\s*=|STATE[A-Z0-9_]*\s*=", html or ""):
        return []
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    nodes = [0]

    def visit(v: Any, in_array: bool, depth: int) -> None:
        if v is None or depth > 14 or nodes[0] > EMBEDDED_MAX_NODES:
            return
        if isinstance(v, list):
            for x in v:
                visit(x, True, depth + 1)
            return
        if not isinstance(v, dict):
            return
        nodes[0] += 1
        e = _normalise_embedded(v)
        if e:
            sig = (f"{js_str(e['name']).lower()}|{e.get('telephone') or ''}"
                   f"|{e.get('url') if e.get('url') is not None else ''}")
            if sig not in seen:
                seen.add(sig)
                found.append({"o": e, "inArray": in_array, "n": len(e), "i": len(found)})
        for x in v.values():
            if isinstance(x, (dict, list)):
                visit(x, in_array, depth + 1)

    for blob in extract_embedded_state(html):
        visit(blob, False, 0)
    found.sort(key=lambda f: (int(f["inArray"]), -f["n"], f["i"]))
    return [f["o"] for f in found[:EMBEDDED_MAX_ENTITIES]]


def embedded_entity_urls(html: str, base: str) -> list[str]:
    """Same-site absolute URLs of the entities found in embedded state."""
    out: list[str] = []
    b = try_url(base)
    if b is None:
        return out
    host = re.sub(r"^www\.", "", b.host, count=1)
    for e in safe(lambda: collect_embedded_entities(html), []):
        u = e.get("url") if isinstance(e.get("url"), str) else None
        if not u:
            continue
        a = try_url(u, base)
        if a is None:
            continue
        h = re.sub(r"^www\.", "", a.host, count=1)
        if a.protocol not in ("http:", "https:") or (h != host and not h.endswith("." + host)):
            continue
        a.hash = ""
        if a.href not in out:
            out.append(a.href)
    return out


# ---------------------------------------------------------------------------
# Signatures and subjects
# ---------------------------------------------------------------------------
def fnv1a64(s: str) -> str:
    """FNV-1a 64-bit hex of a string (over UTF-16 code units, like the JS original)."""
    h = 0xCBF29CE484222325
    prime = 0x100000001B3
    mask = 0xFFFFFFFFFFFFFFFF
    data = s.encode("utf-16-le", "surrogatepass")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * prime) & mask
    return f"{h:016x}"


def json_ld_signature(o: LdObj) -> str:
    """Compact stable signature: FNV-1a 64-bit hash of the object's JSON string."""
    try:
        s = json_stringify(o)
    except (TypeError, ValueError):
        return ""
    return fnv1a64(s) if s else ""


def classify_subject(o: LdObj, site_entity_names: set[str], opts: dict[str, Any] | None = None
                     ) -> str | None:
    from .opts import norm_opts

    o_opts = norm_opts(opts)
    name = trim(o["name"]).lower() if isinstance(o.get("name"), str) else ""
    if name and name in site_entity_names:
        return "firm"
    sigs = o_opts.get("firm_signatures")
    if sigs and json_ld_signature(o) in sigs:
        return "firm"
    types = types_of(o)
    if "Person" in types:
        return "person"
    if types and any(t.lower() not in NON_ENTITY_TYPES for t in types):
        return "location"
    return None


HOURS_PATH = "@hours"
JSONLD_PATHS: dict[str, dict[str, list[list[str]]]] = {
    "person": {
        "name": [["name"]], "job_title": [["jobTitle"]], "phone": [["telephone"]],
        "email": [["email"]], "bio": [["description"]], "photo_url": [["image"]],
        "street": [["address", "streetAddress"]], "city": [["address", "addressLocality"]],
        "state": [["address", "addressRegion"]], "postal_code": [["address", "postalCode"]],
        "credentials": [["hasCredential", "name"]], "languages": [["knowsLanguage"]],
        "education": [["alumniOf", "name"]], "social_links": [["sameAs"]],
        "profile_url": [["url"]], "fax": [["faxNumber"]], "first_name": [["givenName"]],
        "last_name": [["familyName"]], "awards": [["award"]],
        "service_areas": [["areaServed", "name"], ["areaServed"]],
    },
    "location": {
        "business_name": [["name"]], "phone": [["telephone"]], "email": [["email"]],
        "street": [["address", "streetAddress"]], "city": [["address", "addressLocality"]],
        "state": [["address", "addressRegion"]], "postal_code": [["address", "postalCode"]],
        "website": [["url"]], "hours": [[HOURS_PATH]], "description": [["description"]],
        "logo_url": [["logo"], ["image"]], "social_links": [["sameAs"]], "fax": [["faxNumber"]],
        "latitude": [["geo", "latitude"]], "longitude": [["geo", "longitude"]],
    },
    "firm": {
        "firm_name": [["name"]], "logo_url": [["logo"]], "phone_main": [["telephone"]],
        "website": [["url"]], "social_links": [["sameAs"]], "fax": [["faxNumber"]],
        "email": [["email"]], "legal_name": [["legalName"]], "description": [["description"]],
        "street": [["address", "streetAddress"]], "city": [["address", "addressLocality"]],
        "state": [["address", "addressRegion"]], "postal_code": [["address", "postalCode"]],
    },
}


def _leaf_values(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [s for x in v for s in _leaf_values(x)]
    if isinstance(v, str):
        return [v]
    if is_num(v):
        return [js_str(v)]
    if isinstance(v, dict):
        pick = None
        for k in ("url", "name", "@id"):
            if v.get(k) is not None:
                pick = v[k]
                break
        return [pick] if isinstance(pick, str) else []
    return []


def walk_path(v: Any, path: list[str]) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [s for x in v for s in walk_path(x, path)]
    if not path:
        return _leaf_values(v)
    if not isinstance(v, dict):
        return []
    head, rest = path[0], path[1:]
    if head == "*":
        return walk_path(v, rest)
    return walk_path(v.get(head), rest)


def walk_raw(v: Any, path: list[str]) -> list[Any]:
    """C6: raw (non-flattened) values at a JSON-LD path."""
    if v is None:
        return []
    if isinstance(v, list):
        return [s for x in v for s in walk_raw(x, path)]
    if not path:
        return [v]
    if not isinstance(v, dict):
        return []
    head, rest = path[0], path[1:]
    if head == "*":
        return walk_raw(v, rest)
    return walk_raw(v.get(head), rest)


def _day_name(d: Any) -> str:
    return re.sub(r"^https?://schema\.org/", "", d, count=1, flags=re.IGNORECASE) if isinstance(d, str) \
        else ""


def _render_hours(o: LdObj) -> list[str]:
    out: list[str] = []
    oh = o.get("openingHours")
    for h in oh if isinstance(oh, list) else [oh] if oh is not None else []:
        if isinstance(h, str):
            out.append(h)
    spec = o.get("openingHoursSpecification")
    for s in spec if isinstance(spec, list) else [spec] if spec is not None else []:
        if not isinstance(s, dict):
            continue
        dw = s.get("dayOfWeek")
        days = [d for d in (_day_name(x) for x in (dw if isinstance(dw, list) else [dw])) if d]
        opens = "" if s.get("opens") is None else js_str(s.get("opens"))
        closes = "" if s.get("closes") is None else js_str(s.get("closes"))
        span = f"{opens}–{closes}"
        for d in days or [""]:
            out.append(trim(f"{d} {span}"))
    return out


def extract_json_ld(o: LdObj, path: list[str]) -> list[str]:
    if len(path) == 1 and path[0] == HOURS_PATH:
        return _render_hours(o)
    return walk_path(o, path)


def to_raw(type_: str, vals: list[str]) -> Any:
    if not vals:
        return None
    return vals if type_ == "list" else vals[0]
