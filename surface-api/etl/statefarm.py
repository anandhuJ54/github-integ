"""State Farm agent page -> deterministic deep-field extraction (port of `lib/etl-statefarm.ts`).

The agent microsite is server-rendered and exposes JSON-LD (InsuranceAgency + Offer objects)
plus stable class hooks for credentials, languages, hours, about-me bullets, photos and the
"Our Team" roster. NO AI is used or needed. Pure functions only. Regex-based like the TS;
returned dicts keep the TS keys (they are stored as JSON).
"""
from __future__ import annotations

import json
import math
import re
from typing import Any


# ---- JS semantics helpers -----------------------------------------------------------------
def _js_str(x: Any) -> str:
    """``String(x)`` for JSON values."""
    if x is None:
        return "null"
    if isinstance(x, str):
        return x
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if isinstance(x, float):
        if math.isnan(x):
            return "NaN"
        if x == int(x) and abs(x) < 1e21:
            return str(int(x))
        return repr(x)
    if isinstance(x, list):
        return ",".join("" if v is None else _js_str(v) for v in x)
    if isinstance(x, dict):
        return "[object Object]"
    return str(x)


def _str_or_empty(x: Any) -> str:
    """``String(x ?? "")``."""
    return "" if x is None else _js_str(x)


def _get(o: Any, key: str) -> Any:
    """``o?.[key]`` on a JSON value (non-objects give undefined)."""
    return o.get(key) if isinstance(o, dict) else None


def _is_num(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _from_char_code(n: int) -> str:
    return chr(n & 0xFFFF)


def _decode_entities(s: str) -> str:
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
    s = s.replace("&gt;", ">").replace("&quot;", '"')
    s = re.sub(r"&#0?39;|&apos;|&rsquo;", "'", s)
    s = re.sub(r"&#(\d+);", lambda m: _from_char_code(int(m.group(1))), s)
    return re.sub(r"&[a-z]+;", " ", s)


_JS_WS = re.compile(r"\s+")
_I = re.IGNORECASE


def clean(s: str | None) -> str | None:
    if not s:
        return None
    out = _JS_WS.sub(" ", _decode_entities(re.sub(r"<[^>]*>", " ", s))).strip()
    return out or None


def _json_ld_blocks(html: str) -> list[Any]:
    out: list[Any] = []
    for m in re.finditer(
        r"<script[^>]*type=[\"']application/ld\+json[\"'][^>]*>([\s\S]*?)</script>",
        html,
        re.IGNORECASE,
    ):
        raw = (m.group(1) or "").strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except ValueError:
            continue  # skip malformed block - never guess
        if isinstance(parsed, list):
            out.extend(parsed)
        else:
            out.append(parsed)
    return out


def _type_list(t: Any) -> list[str]:
    if isinstance(t, list):
        return [_js_str(x) for x in t]
    if isinstance(t, str):
        return [t]
    return []


def _first_string(v: Any) -> str | None:
    if isinstance(v, str):
        return v.strip() or None
    if isinstance(v, list):
        for item in v:
            s = _first_string(item)
            if s:
                return s
    return None


def social_platform(url: str) -> str:
    u = url.lower()
    if "facebook." in u:
        return "Facebook"
    if "instagram." in u:
        return "Instagram"
    if "linkedin." in u:
        return "LinkedIn"
    if "twitter." in u or "x.com" in u:
        return "X"
    if "yelp." in u:
        return "Yelp"
    if "youtube." in u:
        return "YouTube"
    if "tiktok." in u:
        return "TikTok"
    if "pinterest." in u:
        return "Pinterest"
    if "nextdoor." in u:
        return "Nextdoor"
    if "google." in u:
        return "Google"
    return "Website"


def _section_slice(html: str, start_marker: str, end_markers: list[str]) -> str:
    i = html.find(start_marker)
    if i < 0:
        return ""
    end = len(html)
    for em in end_markers:
        j = html.find(em, i + len(start_marker))
        if -1 < j < end:
            end = j
    return html[i:end]


def _all_matches(pattern: str, s: str, flags: int = 0) -> list[str]:
    return [m.group(1) for m in re.finditer(pattern, s, flags) if m.group(1) is not None]


def _search1(pattern: str, s: str, flags: int = 0, group: int = 1) -> str | None:
    m = re.search(pattern, s, flags)
    return m.group(group) if m else None


def _parse_license(raw: str, primary: bool) -> dict[str, Any]:
    value = raw.strip()
    m = re.match(r"^([A-Z]{2})[-\s]?(.+)$", value)
    return {
        "raw": value,
        "state": m.group(1) if m else None,
        "number": m.group(2).strip() if m else value,
        "primary": primary,
    }


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def parse_state_farm_agent(html: str, detail_url: str) -> dict[str, Any]:
    """Port of ``parseStateFarmAgent``: an SfDeepFields dict."""
    ld = _json_ld_blocks(html)

    agency = next(
        (
            o for o in ld
            if any(x in ("InsuranceAgency", "LocalBusiness", "Organization")
                   for x in _type_list(_get(o, "@type")))
        ),
        None,
    )
    offers = [o for o in ld if "Offer" in _type_list(_get(o, "@type"))]

    address = _get(agency, "address")
    address = {} if address is None else address
    geo = _get(agency, "geo")
    geo = {} if geo is None else geo
    founder = _get(agency, "founder")
    founder = {} if founder is None else founder

    same_as = _get(agency, "sameAs")
    same_as_raw = (
        [s for s in (_js_str(x).strip() for x in same_as) if s] if isinstance(same_as, list) else []
    )

    # --- credentials ---------------------------------------------------------------------
    cred_section = _section_slice(html, 'id="credentials-section"', [
        'id="about-me-section"', 'id="information-tabs-section"', "</section>\n</body>",
    ])
    licenses: list[dict[str, Any]] = []
    for cm in re.finditer(
        r'<span class="credential-value"[^>]*data-credential-type="([^"]*)"[^>]*>([^<]*)</span>',
        cred_section,
        re.IGNORECASE,
    ):
        value = clean(cm.group(2) or "")
        if not value:
            continue
        licenses.append(_parse_license(value, (cm.group(1) or "") == "primary"))

    # --- languages / hours / phones / website --------------------------------------------
    languages = [
        x for x in _dedupe([clean(s) or "" for s in _all_matches(r'data-language-title="([^"]+)"',
                                                                  html)])
        if x
    ]

    hours_section = _section_slice(html, "-hours-section", ["-website-section", "-phone-section"])
    office_hours = [
        x for x in (clean(s) or "" for s in _all_matches(
            r'<span class="-oneX-body--primary"[^>]*>([\s\S]*?)</span>', hours_section))
        if x
    ]
    tz = _search1(r'data-abbr="([^"]+)"', hours_section)

    toll_free = clean(_search1(r'data-phone-number-type="toll-free"[^>]*>([^<]*)<', html,
                               re.IGNORECASE))
    fax = clean(_search1(r'data-phone-number-type="fax"[^>]*>([^<]*)<', html, re.IGNORECASE))
    if fax is None:
        fax = _first_string(_get(agency, "faxNumber"))
    phone = _first_string(_get(agency, "telephone"))
    if phone is None:
        phone = clean(_search1(r'data-phone-number-type="primary"[^>]*>([^<]*)<', html,
                               re.IGNORECASE))

    redirect: str | None = None
    if re.search(r'class="[^"]*redirect-url[^"]*"[^>]*>', html):
        redirect = _search1(r'<a[^>]*href="([^"]+)"[^>]*class="[^"]*redirect-url[^"]*"', html,
                            re.IGNORECASE)
        if redirect is None:
            redirect = _search1(r'class="[^"]*redirect-url[^"]*"[^>]*href="([^"]+)"', html)
    same_as_site = next((u for u in same_as_raw if not re.match(r"^https?://", u, _I)), None)
    agency_url = _get(agency, "url")
    website_url = redirect
    if website_url is None and same_as_site:
        website_url = "https://" + re.sub(r"^/+", "", same_as_site)
    if website_url is None and isinstance(agency_url, str) and "statefarm.com" not in agency_url:
        website_url = agency_url

    # --- about me (rendered twice: desktop + mobile; dedupe by value) ----------------------
    about_me = _dedupe([
        x
        for block in _all_matches(r'<ul class="about-me-list">([\s\S]*?)</ul>', html)
        for x in (clean(s) or "" for s in _all_matches(r"<li[^>]*>([\s\S]*?)</li>", block))
        if x
    ])

    # --- photos ------------------------------------------------------------------------------
    photo = _first_string(_get(founder, "image"))
    if photo is None:
        photo = _search1(r"https://[^\"']*associate-photos/[^\"']*formalColorFull\.jpg", html,
                         re.IGNORECASE, 0)
    cover = _search1(r"https://[^\"']*associate-photos/[^\"']*informalColorFull\.jpg", html,
                     re.IGNORECASE, 0)
    associate_id = _search1(r"associate-photos/[^/]+/([A-Z0-9]+)/",
                            photo if photo is not None else (cover if cover is not None else ""),
                            re.IGNORECASE)

    # --- google place id ---------------------------------------------------------------------
    google_url = next((u for u in same_as_raw if "google." in u.lower()), None)
    place_re = r"[?&](?:placeid|query_place_id)=([A-Za-z0-9_-]+)"
    place_id = (
        (google_url and _search1(place_re, google_url, re.IGNORECASE))
        or _search1(place_re, html, re.IGNORECASE)
        or None
    )

    # --- team roster ---------------------------------------------------------------------------
    team_section = _section_slice(html, 'id="our-team-section"',
                                  ['id="disclosures', 'id="footer', "<footer"])
    team: list[dict[str, Any]] = []
    seen_team: set[str] = set()
    for card in re.split(r'<div id="team-member-\d+"', team_section)[1:]:
        name = clean(_search1(r'class="[^"]*team-member__name[^"]*"[^>]*>([\s\S]*?)</span>', card,
                              re.IGNORECASE))
        if not name or name.lower() in seen_team:
            continue
        seen_team.add(name.lower())
        team.append({
            "name": name,
            "role": clean(_search1(
                r'class="[^"]*team-member__job-title[^"]*"[^>]*>([\s\S]*?)</span>', card, _I)),
            "license": clean(_search1(
                r'class="[^"]*team-member__credential[^"]*"[^>]*>([\s\S]*?)</span>', card, _I)),
            "description": clean(_search1(
                r'class="[^"]*team-member__description[^"]*"[^>]*>([\s\S]*?)</span>', card,
                _I)),
            "photo_url": _search1(
                r'<img[^>]*class="[^"]*team-member__photo[^"]*"[^>]*src="([^"]+)"', card, _I),
            "alias": _search1(r'^[^>]*data-alias="([^"]*)"', card),
        })

    area = _get(agency, "areaServed")
    if isinstance(area, list):
        area_served = [
            s for s in (
                x if isinstance(x, str) else _str_or_empty(_get(x, "name")) for x in area
            ) if s
        ]
    elif isinstance(area, str):
        area_served = [area]
    else:
        area_served = []

    agency_name = _str_or_empty(_get(agency, "name"))
    name = clean(_search1(r"^(.*?)\s*-\s*State Farm", agency_name))
    if name is None:
        name = _first_string(_get(founder, "name"))
    if name is None:
        name = clean(agency_name)
    description = clean(_str_or_empty(_get(agency, "description")))
    brand = _first_string(_get(agency, "brand"))

    fields: dict[str, Any] = {
        "detail_url": detail_url,
        "name": name,
        "legal_name": clean(agency_name),
        "short_bio": description,
        "bio": " · ".join(about_me) if about_me else description,
        "about_me": about_me,
        "phone": phone,
        "toll_free": toll_free,
        "fax": fax,
        "website_url": website_url,
        "street": clean(_str_or_empty(_get(address, "streetAddress"))),
        "city": clean(_str_or_empty(_get(address, "addressLocality"))),
        "state": clean(_str_or_empty(_get(address, "addressRegion"))),
        "postal_code": clean(_str_or_empty(_get(address, "postalCode"))),
        "latitude": _get(geo, "latitude") if _is_num(_get(geo, "latitude")) else None,
        "longitude": _get(geo, "longitude") if _is_num(_get(geo, "longitude")) else None,
        "logo": _first_string(_get(agency, "logo")),
        "brand": brand if brand is not None else "State Farm",
        "area_served": area_served,
        "photo_url": photo,
        "cover_photo_url": cover,
        "products": [
            p for p in (
                {
                    "name": clean(_str_or_empty(o.get("name"))) or "",
                    "url": _first_string(o.get("url")),
                    "description": clean(_str_or_empty(o.get("description"))),
                }
                for o in offers
            ) if p["name"]
        ],
        "social": [
            {"platform": social_platform(u), "url": u}
            for u in same_as_raw if re.match(r"^https?://", u, _I)
        ],
        "licenses": licenses,
        "languages": languages,
        "office_hours": office_hours,
        "office_hours_tz": tz,
        "gbp_place_id": place_id,
        "team": team,
        "associate_id": associate_id,
        "field_count": 0,
    }
    fields["field_count"] = count_fields(fields)
    return fields


COUNTED_KEYS: list[str] = [
    "name", "short_bio", "bio", "about_me", "phone", "toll_free", "fax", "website_url", "street",
    "city", "state", "postal_code", "latitude", "longitude", "logo", "brand", "area_served",
    "photo_url", "cover_photo_url", "products", "social", "licenses", "languages",
    "office_hours", "office_hours_tz", "gbp_place_id", "team",
]


def count_fields(f: dict[str, Any]) -> int:
    n = 0
    for k in COUNTED_KEYS:
        v = f.get(k)
        if isinstance(v, list):
            if v:
                n += 1
        elif v is not None and v != "":
            n += 1
    return n


def parse_ok(f: dict[str, Any]) -> bool:
    """A page parsed successfully when the JSON-LD agency object was found."""
    return bool(f.get("name") and f.get("city") and f.get("state"))
