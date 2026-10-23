"""Value validation: text cleaning, US addresses, phones, geo, separators, not-found pages."""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

from . import _dom
from ._js import (
    is_finite,
    is_integer,
    is_letter_or_number,
    is_num,
    is_punct,
    is_punct_or_symbol,
    is_str_or_num,
    js_str,
    json_stringify,
    num_str,
    trim,
    try_url,
)
from .keys import TAX_PREFIX, is_tax_id, key_of

# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------
_WS_RE = re.compile(r"\s+")


def norm_lines(s: str) -> str:
    lines = (trim(_WS_RE.sub(" ", ln)) for ln in s.split("\n"))
    return "\n".join(ln for ln in lines if ln)


def clean_text(s: str, keep_newlines: bool = False) -> str:
    t = re.sub(r"<[^>]*>", " ", s)
    t = re.sub(r"&nbsp;", " ", t, flags=re.IGNORECASE)
    t = re.sub(r"&amp;", "&", t, flags=re.IGNORECASE)
    return norm_lines(t) if keep_newlines else trim(_WS_RE.sub(" ", t))


def first_scalar(raw: Any) -> str | int | float | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        for r in raw:
            v = first_scalar(r)
            if v is not None and trim(js_str(v)) != "":
                return v
        return None
    if isinstance(raw, str) or is_num(raw):
        return raw
    return None


EMAIL_RE = re.compile(r'^[^\s@<>()\[\]\\,;:"]+@[^\s@<>()\[\]\\,;:"]+\.[a-z]{2,}$', re.IGNORECASE)

# Key-specific checks layered on top of the type check (Fix 2, 2026-09-25).
US_STATES: dict[str, str] = {
    "AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california",
    "CO": "colorado", "CT": "connecticut", "DE": "delaware", "FL": "florida", "GA": "georgia",
    "HI": "hawaii", "ID": "idaho", "IL": "illinois", "IN": "indiana", "IA": "iowa",
    "KS": "kansas", "KY": "kentucky", "LA": "louisiana", "ME": "maine", "MD": "maryland",
    "MA": "massachusetts", "MI": "michigan", "MN": "minnesota", "MS": "mississippi",
    "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada",
    "NH": "new hampshire", "NJ": "new jersey", "NM": "new mexico", "NY": "new york",
    "NC": "north carolina", "ND": "north dakota", "OH": "ohio", "OK": "oklahoma",
    "OR": "oregon", "PA": "pennsylvania", "RI": "rhode island", "SC": "south carolina",
    "SD": "south dakota", "TN": "tennessee", "TX": "texas", "UT": "utah", "VT": "vermont",
    "VA": "virginia", "WA": "washington", "WV": "west virginia", "WI": "wisconsin",
    "WY": "wyoming", "DC": "district of columbia", "PR": "puerto rico", "GU": "guam",
    "VI": "virgin islands", "AS": "american samoa", "MP": "northern mariana islands",
}
STATE_BY_NAME = {n: c for c, n in US_STATES.items()}


def state_code(s: str) -> str | None:
    t = re.sub(r"\.$", "", trim(s), count=1)
    if re.fullmatch(r"[a-z]{2}", t, re.IGNORECASE) and t.upper() in US_STATES:
        return t.upper()
    return STATE_BY_NAME.get(_WS_RE.sub(" ", t.lower()))


ZIP_RE = re.compile(r"\b(\d{5}(?:-\d{4})?)\b")


def check_state(s: str) -> str | None:
    whole = state_code(s)
    if whole:
        return whole
    found: list[str] = []
    for p in s.split(",")[1:]:
        seg = trim(re.sub(r"\d+", "", ZIP_RE.sub("", p, count=1)))
        c = state_code(seg)
        if c and c not in found:
            found.append(c)
    return found[0] if len(found) == 1 else None


def plain_city(c: str) -> str | None:
    t = trim(re.sub(r",$", "", trim(c), count=1))
    return t if 2 <= len(t) <= 40 and re.fullmatch(r"[A-Za-z .'\-]+", t) else None


def check_city(s: str) -> str | None:
    m = re.match(r"^([^,\d]+),\s*([A-Za-z .]+?)\s+\d{5}(?:-\d{4})?\s*$", s)
    if m and state_code(m.group(2)):
        return plain_city(m.group(1))
    return plain_city(s)


# Fix 5 (2026-09-25): generic multi-line / comma-less address parsing.
STATE_NAME_ALT = "|".join(
    n.replace(" ", r"\s+") for n in sorted(US_STATES.values(), key=len, reverse=True)
)
ST_GROUP = f"([A-Za-z]{{2}}|{STATE_NAME_ALT})"
LINE_CITY_ST_ZIP = re.compile(rf"^(.*?)[,\s]+{ST_GROUP}[\s,]+(\d{{5}}(?:-\d{{4}})?)$", re.IGNORECASE)
LINE_ST_ZIP = re.compile(rf"^{ST_GROUP}[\s,]+(\d{{5}}(?:-\d{{4}})?)$", re.IGNORECASE)


def _lines(s: Any) -> list[str]:
    return [ln for ln in (trim(x) for x in js_str("" if s is None else s).split("\n")) if ln]


def _last_seg(g1: str) -> str:
    segs = [x for x in (trim(y) for y in g1.split(",")) if x]
    return segs[-1] if segs else ""


def parse_address(s: str) -> dict[str, Any] | None:
    """Parse "City, ST 12345", "City ST 12345" or "City\\nST 12345" (lines split on \\n)."""
    lines = _lines(s)

    def city_before(i: int) -> str | None:
        for j in range(i - 1, -1, -1):
            c = plain_city(lines[j])
            if c:
                return c
        return None

    for i, line in enumerate(lines):
        m = LINE_CITY_ST_ZIP.match(line)
        if not m:
            continue
        st = state_code(m.group(2))
        if not st:
            continue
        g1 = trim(m.group(1))
        city = (plain_city(_last_seg(g1)) if g1 else None) or city_before(i)
        return {"city": city, "state": st, "zip": m.group(3)}
    for i, line in enumerate(lines):
        m = LINE_ST_ZIP.match(line)
        if not m:
            continue
        st = state_code(m.group(1))
        if not st:
            continue
        return {"city": city_before(i), "state": st, "zip": m.group(2)}
    return None


def _check_by_key(key: str, s: str) -> str | None:
    if key in ("state", "city", "postal_code"):
        p = parse_address(s)
        flat = trim(re.sub(r"\s*\n\s*", " ", s))
        if key == "state":
            return p["state"] if p is not None else check_state(flat)
        if key == "city":
            if p is not None and p.get("city") is not None:
                return p["city"]
            return check_city(flat)
        if p and p.get("zip"):
            return p["zip"]
        if re.fullmatch(r"\d{5}(-\d{4})?", flat):
            return flat
        m = ZIP_RE.search(flat)
        return m.group(1) if m else None
    if key == "license_state":
        return check_state(trim(re.sub(r"\s*\n\s*", " ", s)))
    if key in ("name", "business_name", "firm_name", "branch_name", "first_name", "last_name",
               "legal_name"):
        return s if 2 <= len(s) <= 120 and not re.search(r"\d", s) else None
    if key == "address_block":
        # Fix 8: the whole block must contain a US "ST ZIP" / "City, ST ZIP" line.
        return s if parse_address(s) else None
    if key == "job_title":
        return s if 2 <= len(s) <= 120 and re.search(r"[A-Za-z]", s) else None
    return s


ADDRESS_KEYS = {"city", "state", "postal_code", "address_block"}

# Fix 8: derive one address part from an accepted address block.
PHONE_LINE_RE = re.compile(r"^[+()\d\s.\-]+$")


def _digits(s: str) -> str:
    return re.sub(r"[^0-9]", "", s)


def street_from_block(block: Any) -> str | None:
    lines = _lines(block)

    def city_line(ln: str) -> bool:
        m = LINE_CITY_ST_ZIP.match(ln)
        return bool(m and state_code(m.group(2)))

    i = next((k for k, ln in enumerate(lines) if city_line(ln)), -1)
    city_idx = -1
    if i >= 0:
        m = LINE_CITY_ST_ZIP.match(lines[i])
        g1 = trim(m.group(1))
        if g1 and plain_city(_last_seg(g1)):
            city_idx = i
    else:
        def st_line(ln: str) -> bool:
            m = LINE_ST_ZIP.match(ln)
            return bool(m and state_code(m.group(1)))

        i = next((k for k, ln in enumerate(lines) if st_line(ln)), -1)
        if i < 0:
            return None
    if city_idx < 0:
        for j in range(i - 1, -1, -1):
            if plain_city(lines[j]):
                city_idx = j
                break
        if city_idx < 0:
            return None
    if city_idx - 1 < 0:
        return None
    cand = lines[city_idx - 1]
    if not cand:
        return None
    if PHONE_LINE_RE.match(cand) or len(_digits(cand)) >= 10:
        return None
    return cand if re.search(r"\d+\s*[A-Za-z]", cand) else None


def derive_address_part(block: Any, part: str) -> str | None:
    if not isinstance(block, str):
        return None
    if part == "street":
        return street_from_block(block)
    p = parse_address(block)
    if not p:
        return None
    return p["city"] if part == "city" else p["state"] if part == "state" else p["zip"]


#: C3: North American toll-free area codes.
TOLL_FREE_AREAS = {"800", "833", "844", "855", "866", "877", "888"}


def _slug_says_toll_free(field_id: str) -> bool:
    words = re.sub(r"[_\-.]+", " ", field_id[len(TAX_PREFIX):].lower())
    t = f" {words} "
    return bool(re.search(r" toll ?free ", t) or re.search(r" tollfree ", t))


def is_toll_free_number(v: str) -> bool:
    d = _digits(js_str("" if v is None else v))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return len(d) == 10 and d[:3] in TOLL_FREE_AREAS


def validate_value(
    type_: str,
    raw: Any,
    page_url: str,
    field_id: str | None = None,
    flags: dict[str, Any] | None = None,
) -> Any:
    """Validate / normalise one raw value for a field type (None = not a value)."""
    flags = flags or {}
    # C5: taxonomy URLs — fragment-only and javascript: are not values; actions accept tel:/mailto:.
    if type_ == "url" and is_tax_id(field_id):
        s0 = first_scalar(raw)
        s = "" if s0 is None else clean_text(js_str(s0))
        if not s or s.startswith("#") or re.match(r"^javascript:", s, re.IGNORECASE):
            return None
        # C8: URL-shaped only — no whitespace or | < > " { } in the raw value, no bare words.
        raw_t = trim(js_str(s0))
        if re.search(r'[\s|<>"{}]', raw_t):
            return None
        if re.match(r"^(tel|mailto):", raw_t, re.IGNORECASE):
            return raw_t if flags.get("action") else None
        if not re.match(r"^(https?://|//|/|\./|\.\./|\?)", raw_t, re.IGNORECASE):
            return None
    v0 = _validate_by_type(type_, raw, page_url)
    if v0 is None or not isinstance(v0, str):
        return v0
    # C3: a toll-free phone key must hold a toll-free number.
    if (type_ == "phone" and is_tax_id(field_id) and _slug_says_toll_free(field_id or "")
            and not is_toll_free_number(v0)):
        return None
    key = "" if is_tax_id(field_id) else key_of(field_id)
    # Newlines survive only until key validation; address keys parse them.
    flat = trim(re.sub(r"\s*\n\s*", " ", v0)) if "\n" in v0 else v0
    if not key:
        return flat
    try:
        return _check_by_key(key, v0 if key in ADDRESS_KEYS else flat)
    except Exception:  # noqa: BLE001 — TS catch-all
        return None


def _single_line_street(flat: str, city: str | None) -> str | None:
    """Street from a single-line address: the segments before the city segment."""
    if not city:
        return None
    segs = [x for x in (trim(y) for y in flat.split(",")) if x]
    cl = city.lower()
    i = next((k for k, s in enumerate(segs) if s.lower() == cl or s.lower().startswith(cl + " ")),
             -1)
    if i <= 0:
        return None
    st = ", ".join(segs[:i])
    return st if re.search(r"\d+\s*[A-Za-z]", st) and not PHONE_LINE_RE.match(st) else None


#: C9: remove a trailing phone number (a phone-shaped run that validates as a phone).
TRAILING_PHONE_RE = re.compile(
    r"(^|[\s,;|•·])(?:(?:phone|tel|ph|p|t)\.?:?\s*)?"
    r"(\+?1?[\s.\-]?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})\s*$",
    re.IGNORECASE,
)


def strip_trailing_phone(s: str) -> str:
    m = TRAILING_PHONE_RE.search(s)
    if not m:
        return s
    d = _digits(m.group(2))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if len(d) != 10:
        return s
    return trim(re.sub(r"[\s,;|•·\-]+$", "", s[: m.start() + len(m.group(1))]))


OFFICE_TAIL_RE = re.compile(rf"^(.*?)[,\s]+{ST_GROUP}[\s,]+(\d{{5}}(?:-\d{{4}})?)$", re.IGNORECASE)
STREET_END_RE = re.compile(
    r"\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|way|parkway|pkwy|plaza|plz|lane|"
    r"ln|court|ct|place|pl|highway|hwy|circle|cir|terrace|ter|pike|trail|trl|square|sq|crossing|"
    r"expressway|expy|freeway|fwy|turnpike|tpke)\.?(?:\s+(?:n|s|e|w|ne|nw|se|sw)\.?)?"
    r"(?:\s*,?\s*(?:suite|ste|unit|apt|bldg|building|floor|fl|rm|room|#)\.?\s*#?\s*[\w-]+)*"
    r"(?=\s|,|$)",
    re.IGNORECASE,
)


def parse_office_block(raw: str) -> dict[str, str] | None:
    """Fix (office block, 2026-10-12): "[branch] house-number street [suite] city ST ZIP phone"."""
    text = trim(_WS_RE.sub(" ", clean_text(js_str("" if raw is None else raw))))
    if not text or len(text) > 300:
        return None
    m = TRAILING_PHONE_RE.search(text)
    if not m:
        return None
    d = _digits(m.group(2))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if len(d) != 10:
        return None
    rest = trim(re.sub(r"[\s,;|•·\-]+$", "", text[: m.start() + len(m.group(1))]))
    if re.search(r"\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}", rest):
        return None  # a second number: not one office block
    t = OFFICE_TAIL_RE.match(rest)
    if not t:
        return None
    state = state_code(t.group(2))
    if not state:
        return None
    body = trim(re.sub(r"[,\s]+$", "", t.group(1)))
    fm = re.search(r"\d", body)
    if not fm:
        return None
    first_num = fm.start()
    lead = trim(re.sub(r"[\s,\-–—:|]+$", "", body[:first_num]))
    body = body[first_num:]
    if not re.match(r"^\d+[A-Za-z]?\s+[A-Za-z]", body):
        return None
    lead_parts = re.split(r"\s[-–—|:]\s", lead)
    lead_city = trim(lead_parts[-1] if lead_parts else "")
    if lead_city and body.lower().endswith(" " + lead_city.lower()):
        city = lead_city
        street = body[: len(body) - len(lead_city)]
    elif "," in body:
        i = body.rfind(",")
        street = body[:i]
        city = body[i + 1:]
    else:
        e = STREET_END_RE.search(body)
        if not e:
            return None
        street = body[: e.end()]
        city = body[e.end():]
    street = trim(re.sub(r"[,\s]+$", "", street))
    c = plain_city(city)
    if not c or len(street) < 5:
        return None
    return {"street": street, "city": c, "state": state, "postal_code": t.group(3), "phone": d}


def normalize_address(raw: Any) -> dict[str, Any] | None:
    """C6: normalise a PostalAddress object or an address string into a structured address."""
    try:
        v = raw
        if isinstance(v, list):
            v = next(
                (x for x in v if x is not None
                 and (isinstance(x, (dict, list)) or trim(js_str(x)) != "")),
                None,
            )
        if v is None:
            return None
        out: dict[str, Any] = {"text": ""}
        if isinstance(v, (dict, list)):
            o = v if isinstance(v, dict) else {}

            def sget(k: str) -> str:
                x = o.get(k)
                if isinstance(x, str) or is_num(x):
                    return clean_text(js_str(x))
                if isinstance(x, dict) and isinstance(x.get("name"), str):
                    return clean_text(x["name"])
                return ""

            street = sget("streetAddress")
            city = sget("addressLocality")
            region = sget("addressRegion")
            zip_ = sget("postalCode")
            country = sget("addressCountry")
            res: dict[str, Any] = {}
            if street:
                res["streetAddress"] = street
            c = check_city(city) if city else None
            if c:
                res["addressLocality"] = c
            r = check_state(region) if region else None
            if r:
                res["addressRegion"] = r
            z = ZIP_RE.search(zip_)
            if z:
                res["postalCode"] = z.group(1)
            if country:
                res["addressCountry"] = country
            tail = " ".join(x for x in (region, zip_) if x)
            text = ", ".join(x for x in (street, city, tail, country) if x)
            if not text and isinstance(o.get("name"), str):
                text = clean_text(o["name"])
            out = {**res, "text": text}
        elif isinstance(v, str) or is_num(v):
            block = strip_trailing_phone(clean_text(js_str(v), True))
            flat = strip_trailing_phone(
                trim(re.sub(r",\s*,", ",", re.sub(r"\s*\n\s*", ", ", block)))
            )
            res = {}
            p = parse_address(block) or parse_address(flat)
            if p:
                street = street_from_block(block) or _single_line_street(flat, p["city"])
                if street:
                    res["streetAddress"] = street
                if p["city"]:
                    res["addressLocality"] = p["city"]
                if p["state"]:
                    res["addressRegion"] = p["state"]
                if p["zip"]:
                    res["postalCode"] = p["zip"]
            out = {**res, "text": flat}
        else:
            return None
        if len(out["text"]) < 5:
            return None
        return out
    except Exception:  # noqa: BLE001 — TS catch-all
        return None


def normalize_geo(raw: Any) -> dict[str, float] | None:
    """C9: a { latitude, longitude } pair; one coordinate alone is rejected."""
    try:
        v = raw
        if isinstance(v, list):
            v = next((x for x in v if x is not None), None)
        if v is None:
            return None
        if isinstance(v, (dict, list)):
            o = v if isinstance(v, dict) else {}
            lat = o.get("latitude") if o.get("latitude") is not None else o.get("lat")
            lng = o.get("longitude")
            if lng is None:
                lng = o.get("lng") if o.get("lng") is not None else o.get("lon")
        else:
            nums = re.findall(r"-?\d+(?:\.\d+)?", js_str(v))
            if len(nums) != 2:
                return None
            lat, lng = nums

        def num(x: Any) -> float | int | None:
            if is_num(x):
                return x if math.isfinite(x) else None
            if not isinstance(x, str):
                return None
            m = re.fullmatch(r"-?\d+(?:\.\d+)?", trim(x))
            return float(m.group(0)) if m else None

        fl = first_scalar(lat)
        fo = first_scalar(lng)
        la = num(fl if fl is not None else lat)
        lo = num(fo if fo is not None else lng)
        if la is None or lo is None:
            return None
        if la < -90 or la > 90 or lo < -180 or lo > 180:
            return None
        return {"latitude": la, "longitude": lo}
    except Exception:  # noqa: BLE001 — TS catch-all
        return None


# C11/C12: separator characters that can trail a multi-part text value.
_SEP_CLASS = r",;:\-–—/|&"
TRAILING_SEP_RE = re.compile(rf"[{_SEP_CLASS}]+\s*$")
PART_SEP_RE = re.compile(rf"[{_SEP_CLASS}]\s*$")


def strip_trailing_separator(s: str) -> str:
    """C12: strip trailing separator(s) and surrounding whitespace from a text value."""
    return trim(TRAILING_SEP_RE.sub("", js_str("" if s is None else s), count=1))


def join_parts(parts: list[str]) -> str:
    """C12: join parts while each ends with a separator (cap 10 parts, 2000 chars)."""
    out: list[str] = []
    for p in parts:
        if len(out) >= 10:
            break
        t = trim(_WS_RE.sub(" ", p))
        if not t:
            continue
        out.append(t)
        if not PART_SEP_RE.search(t):
            break
    return " ".join(out)[:2000]


CUT_OFF_END_RE = re.compile(r"[(\[{<]$")


def _only_punct(t: str) -> bool:
    return all(is_punct_or_symbol(ch) or ch.isspace() for ch in t)


def is_cut_off_text(s: str) -> bool:
    """C11/C12: a text value ending with an opening bracket, or only punctuation, is cut off."""
    t = trim(js_str("" if s is None else s))
    if not t:
        return False
    return bool(CUT_OFF_END_RE.search(t)) or _only_punct(t)


# ---------------------------------------------------------------------------
# Station 5: not-found pages
# ---------------------------------------------------------------------------
NOT_FOUND_PHRASE_RE = re.compile(
    "|".join([  # noqa: FLY002
        "page not found",
        "page cannot be found",
        "(?:can['’]t|cannot|could['’]n['’]?t|could not) find the page",
        "could not be found",
        "no longer available",
        "no longer exists",
        "page you requested does not exist",
        "does(?:['’]?n['’]?t| not) exist",
        r"error\s*404",
    ]),
    re.IGNORECASE,
)


def _standalone_404(t: str) -> bool:
    """A bare "404" counts only as a standalone word (bounded by start/end, space or \\p{P})."""
    for m in re.finditer("404", t):
        a, b = m.start(), m.end()
        before_ok = a == 0 or t[a - 1].isspace() or is_punct(t[a - 1])
        after_ok = b == len(t) or t[b].isspace() or is_punct(t[b])
        if before_ok and after_ok:
            return True
    return False


def _collect_not_found_strings(v: Any, out: list[str]) -> None:
    if v is None:
        return
    if is_str_or_num(v):
        out.append(js_str(v))
        return
    if isinstance(v, list):
        for x in v:
            _collect_not_found_strings(x, out)
        return
    if isinstance(v, dict) and isinstance(v.get("text"), str):
        out.append(v["text"])


def looks_not_found(html: str, values: dict[str, Any]) -> bool:
    """Station 5: true when a normal 200 page reads as a "not found" message."""
    try:
        soup = _dom.load(html)
        t1 = _dom.select_first(soup, "head title")
        t2 = _dom.select_first(soup, "title")
        title = trim(_WS_RE.sub(" ", _dom.text(t1) or _dom.text(t2) or ""))
        first_h1 = trim(_WS_RE.sub(" ", _dom.text(_dom.select_first(soup, "h1"))))
    except Exception:  # noqa: BLE001 — TS catch-all
        return False
    for t in (title, first_h1):
        if not t:
            continue
        if NOT_FOUND_PHRASE_RE.search(t) or _standalone_404(t):
            return True
    for fid in ("person.name", "location.business_name"):
        strs: list[str] = []
        _collect_not_found_strings((values or {}).get(fid), strs)
        if any(NOT_FOUND_PHRASE_RE.search(s) for s in strs):
            return True
    return False


# ---------------------------------------------------------------------------
# C11: value-anchored selectors
# ---------------------------------------------------------------------------
TEXT_PSEUDO_RE = re.compile(r":(?:-soup-)?contains\(|:has-text\(", re.IGNORECASE)


def anchor_norm(x: str) -> str:
    n = unicodedata.normalize("NFKD", x.lower())
    return "".join(ch for ch in n if is_letter_or_number(ch))


def _anchor_strings(v: Any) -> list[str]:
    if v is None:
        return []
    if is_str_or_num(v):
        return [js_str(v)]
    if isinstance(v, list):
        return [s for x in v for s in _anchor_strings(x)]
    if isinstance(v, dict):
        if isinstance(v.get("text"), str):
            return [v["text"]]
        return [s for x in v.values() for s in _anchor_strings(x)]
    return []


def _locator_selector_texts(loc: dict[str, Any]) -> list[str]:
    pair = loc.get("pair")
    if pair:
        return _locator_selector_texts(pair["latitude"]) + _locator_selector_texts(
            pair["longitude"]
        )
    return [x for x in (loc.get("css"), loc.get("label")) if isinstance(x, str) and x != ""]


def is_value_anchored(loc: dict[str, Any], vals: list[Any] | None = None) -> bool:
    """C11: a rule selecting by text (:contains etc.), or whose selector contains its value."""
    texts = _locator_selector_texts(loc)
    if any(TEXT_PSEUDO_RE.search(t) for t in texts):
        return True
    norms = [n for n in (anchor_norm(t) for t in texts) if n]
    if not norms:
        return False
    for v in vals or []:
        for s in _anchor_strings(v):
            n = anchor_norm(s)
            if len(n) >= 6 and any(n in t for t in norms):
                return True
    return False


# ---------------------------------------------------------------------------
# Type validation
# ---------------------------------------------------------------------------
def _validate_by_type(type_: str, raw: Any, page_url: str) -> Any:
    try:
        if type_ == "address":
            return normalize_address(raw)
        if type_ == "geo":
            return normalize_geo(raw)
        if type_ == "list":
            arr = raw if isinstance(raw, list) else [] if raw is None else [raw]
            out: list[str] = []
            seen: set[str] = set()
            for item in arr:
                if len(out) >= 50:
                    break
                if not is_str_or_num(item):
                    continue
                # C12: a trailing separator is stripped and the item kept.
                t = strip_trailing_separator(clean_text(js_str(item)))
                if not t or len(t) > 300 or is_cut_off_text(t):
                    continue
                k = t.lower()
                if k in seen:
                    continue
                seen.add(k)
                out.append(t)
            return out if len(out) >= 1 else None
        v = first_scalar(raw)
        if v is None:
            return None
        if type_ in ("number", "year"):
            if is_num(v):
                n = v
            else:
                m = re.search(r"\d+(?:\.\d+)?", clean_text(v))
                if not m:
                    return None
                n = float(m.group(0))
            if not is_finite(n):
                return None
            if type_ == "year" and (not is_integer(n) or n < 1800 or n > 2100):
                return None
            return int(n) if isinstance(n, float) and n == int(n) else n
        s = clean_text(js_str(v), type_ == "text")
        if type_ == "phone":
            t = trim(re.sub(r"^tel:", "", s, count=1, flags=re.IGNORECASE))
            return t if len(_digits(t)) >= 10 else None
        if type_ == "email":
            t = trim(re.sub(r"^mailto:", "", s, count=1, flags=re.IGNORECASE).split("?")[0])
            return t if EMAIL_RE.match(t) else None
        if type_ == "url":
            if not s:
                return None
            u = try_url(s, page_url)
            if u is None:
                return None
            return u.href if u.protocol in ("http:", "https:") else None
        # text — C12: a trailing separator is stripped; an opening bracket / punctuation-only is
        # rejected.
        t0 = strip_trailing_separator(s)
        if is_cut_off_text(t0):
            return None
        return t0 if 2 <= len(t0) <= 2000 else None
    except Exception:  # noqa: BLE001 — TS catch-all
        return None


# ---------------------------------------------------------------------------
# Value normalisation for comparisons
# ---------------------------------------------------------------------------
def _lower_alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def norm_val(v: Any) -> str:
    # C9: geo pairs compare by their coordinates.
    if isinstance(v, dict) and is_num(v.get("latitude")):
        return f"{num_str(v['latitude'])}_{js_str(v.get('longitude')) if 'longitude' in v else 'undefined'}"
    # C6: structured addresses compare by their text.
    if isinstance(v, dict) and isinstance(v.get("text"), str):
        return _lower_alnum(v["text"])

    def item_text(x: Any) -> str:
        if isinstance(x, (dict, list)):
            if isinstance(x, dict):
                for k in ("url", "title", "name", "school", "text"):
                    if x.get(k) is not None:
                        return js_str(x[k])
            return json_stringify(x)
        return "" if x is None else js_str(x)

    s = "|".join(item_text(x) for x in v) if isinstance(v, list) else (
        "" if v is None else js_str(v)
    )
    return _lower_alnum(s)
