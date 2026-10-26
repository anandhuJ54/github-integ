"""Harvest helpers and staging schema step 3 (static values in section-4 formats)."""

from __future__ import annotations

import math
import re
from typing import Any

from ._js import (
    is_finite,
    is_integer,
    is_num,
    js_number,
    js_round,
    js_str,
    json_stringify,
    trim,
    try_url,
    utc_year,
)
from .apply import action_url, decode_action, video_from_url
from .keys import STATIC_FORMATS, TAX_PREFIX, field_type, is_empty_value, is_tax_id, key_of
from .keys import non_empty as _non_empty
from .learn import compute_must_have
from .opts import kwargs_of
from .taxonomy import is_mergeable_id
from .values import (
    EMAIL_RE,
    US_STATES,
    ZIP_RE,
    clean_text,
    norm_val,
    parse_office_block,
    state_code,
    validate_value,
)


def apply_address_owner(values: dict[str, Any], contract: dict[str, Any]) -> dict[str, Any]:
    """When the location owns the address, copy it into empty person address keys."""
    out = dict(values)
    if (contract or {}).get("address_owner") != "location":
        return out
    for k in ("street", "city", "state", "postal_code"):
        loc = out.get("location." + k)
        if not is_empty_value(loc) and is_empty_value(out.get("person." + k)):
            out["person." + k] = loc
    return out


def record_must_have(values: dict[str, Any], primary: str, name_owner: str | None = None
                     ) -> dict[str, Any]:
    """The contract must-have rule evaluated on ONE page's values."""
    fields = {fid: {"hits": 1} for fid, v in values.items() if not is_empty_value(v)}
    mh = compute_must_have(fields, primary, name_owner)
    return {"ok": mh["ok"], "missing": mh["missing"]}


def drop_placeholder_phones(values: dict[str, Any],
                            taxonomy_fields: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fix (placeholder phones, 2026-10-16): values without placeholder phones."""
    out: dict[str, Any] = {}
    for fid, v in values.items():
        is_tax = fid.startswith(TAX_PREFIX)
        tf = (taxonomy_fields or {}).get(fid[len(TAX_PREFIX):]) if is_tax else None
        phone_like = bool(re.search(r"(phone|fax)$", fid, re.IGNORECASE)) or (
            is_tax and isinstance(tf, dict) and tf.get("type") == "phone")
        if not phone_like:
            out[fid] = v
            continue
        if isinstance(v, list):
            kept = [x for x in v if not is_placeholder_phone(x)]
            if kept:
                out[fid] = kept
        elif not is_placeholder_phone(v):
            out[fid] = v
    return out


def build_harvest_record(args: dict[str, Any] | None = None, /, **kw: Any) -> dict[str, Any]:
    """Build one staging record.

    Arguments (TS camelCase or snake_case): contract, values, detail_url, firm_relabelled,
    detail_entity_type, field_floor, extras.
    """
    a = kwargs_of(args, kw)
    contract: dict[str, Any] = a.get("contract") or {}
    detail_url: str = a.get("detail_url") or ""
    # Fix (placeholder phones, 2026-10-16): removed from every phone / fax value first.
    values = drop_placeholder_phones(a.get("values") or {}, contract.get("taxonomy_fields"))
    primary = contract.get("primary_subject")
    det = a.get("detail_entity_type")
    entity_type = det if det in ("professional", "location") else (
        "professional" if primary == "person" else "location")
    payload: dict[str, Any] = {}
    staging = build_staging_static(contract=contract, values=values, extras=a.get("extras"),
                                   page_url=detail_url)
    universal = staging["universal"]
    subjects: dict[str, str] = {}
    firm_relabelled = a.get("firm_relabelled") or []
    for fid, v in values.items():
        if is_empty_value(v):
            continue
        if is_tax_id(fid):
            slug = fid[len(TAX_PREFIX):]
            payload[slug] = v
            s = ((contract.get("taxonomy_fields") or {}).get(slug) or {}).get("subject") or (
                "person" if primary == "person" else "location")
            subjects[slug] = "firm" if fid in firm_relabelled else (
                "branch" if s == "location" else s)
    filled = count_staging_fields(universal, values)
    payload["_contract"] = {"version": contract.get("version"),
                            "learned_at": contract.get("learned_at")}
    payload["_subjects"] = subjects
    if contract.get("firm_profile"):
        payload["_firm_ref"] = {"learned_at": contract["firm_profile"].get("learned_at")}
    extras = staging["extras"]
    if extras:
        payload["_extra"] = extras
    if staging["sources"]:
        payload["_static_sources"] = staging["sources"]

    def pick(k: str) -> Any:
        p = values.get("person." + k)
        if not is_empty_value(p):
            return p
        lv = values.get("location." + k)
        return None if is_empty_value(lv) else lv

    if primary == "person":
        name_val = values.get("location.business_name") if is_empty_value(
            values.get("person.name")) else values.get("person.name")
    else:
        name_val = values.get("person.name") if is_empty_value(
            values.get("location.business_name")) else values.get("location.business_name")
    identity_candidates = {
        "url": detail_url,
        "name": None if is_empty_value(name_val) else name_val,
        "phone": pick("phone"),
        "email": pick("email"),
        "street": pick("street"),
        "city": pick("city"),
        "state": pick("state"),
        "postal_code": pick("postal_code"),
        "branch_name": None if is_empty_value(values.get("location.business_name"))
        else values["location.business_name"],
        "firm_name": None if is_empty_value(values.get("firm.firm_name"))
        else values["firm.firm_name"],
        "universal": universal,
    }
    must_have = record_must_have(values, primary, contract.get("name_owner"))
    floor = js_number(0 if a.get("field_floor") is None else a.get("field_floor"))
    floor_needed = math.ceil(0.7 * floor) if floor > 0 else 0
    return {
        "entity_type": entity_type, "payload": payload,
        "identity_candidates": identity_candidates, "detail_url": detail_url,
        "must_have": must_have, "filled": filled, "floor_needed": floor_needed,
        "shallow": not must_have["ok"] or filled < floor_needed,
    }


# ============================================================================
# Staging schema step 3
# ============================================================================
non_empty = _non_empty


def as_strings(v: Any) -> list[str]:
    out: list[str] = []
    for x in v if isinstance(v, list) else ([] if v is None else [v]):
        if isinstance(x, str) or is_num(x):
            out.append(js_str(x))
        elif isinstance(x, dict) and isinstance(x.get("name"), str):
            out.append(x["name"])
        elif isinstance(x, dict) and isinstance(x.get("url"), str):
            out.append(x["url"])
    return out


def _digits(s: str) -> str:
    return re.sub(r"[^0-9]", "", s)


_EXT_RE = re.compile(r"\s*(?:ext\.?|extension|x)\s*\d+\s*$", re.IGNORECASE)


def _main_number(v: Any) -> str:
    strs = as_strings(v)
    s = re.sub(r"^tel:", "", strs[0] if strs else "", count=1, flags=re.IGNORECASE)
    return _EXT_RE.split(s)[0]


def is_placeholder_phone(v: Any) -> bool:
    """All one digit, a straight run, or the fictional 555-01xx range."""
    d = _digits(_main_number(v))
    if len(d) < 6:
        return False
    if re.fullmatch(r"([0-9])\1+", d):
        return True
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if re.fullmatch(r"([0-9])\1+", d):
        return True
    if d in ("1234567890", "0123456789", "9876543210", "2345678901", "123456789", "12345678"):
        return True
    return len(d) == 10 and d[3:6] == "555" and d[6:8] == "01"


def to_us_phone10(v: Any) -> str | None:
    """Fix (10-digit US phone, 2026-10-13): valid North American numbers as 10 digits."""
    d = _digits(_main_number(v))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    if not re.fullmatch(r"[2-9][0-9]{2}[2-9][0-9]{6}", d):
        return None
    if is_placeholder_phone(d):
        return None
    return d


def to_e164(v: Any) -> str | None:
    main = _main_number(v)
    d = _digits(main)
    if len(d) == 10:
        return "+1" + d
    if len(d) == 11 and d.startswith("1"):
        return "+" + d
    if re.match(r"^\s*\+", main) and 8 <= len(d) <= 15:
        return "+" + d
    return None


def to_place_id(v: Any) -> str | None:
    """Google place id (ChIJ…): the value itself, or a place_id parameter of a Maps link."""
    from ._js import decode_uri_component

    for raw in as_strings(v):
        s = trim(raw)
        if re.fullmatch(r"ChIJ[A-Za-z0-9_-]{10,}", s):
            return s
        t = s
        try:
            t = decode_uri_component(s)
        except (ValueError, UnicodeDecodeError):
            pass
        m = re.search(r"(?:place_id[:=]|query_place_id=|placeid=)(ChIJ[A-Za-z0-9_-]{10,})", t,
                      re.IGNORECASE)
        if m:
            return m.group(1)
    return None


TRACKING_PARAM_RE = re.compile(
    r"^(utm_[a-z_]+|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|_ga)$", re.IGNORECASE)


def format_url(v: Any, page_url: str) -> str | None:
    strs = as_strings(v)
    s = strs[0] if strs else None
    if not s:
        return None
    u = try_url(trim(s), page_url)
    if u is None or u.protocol not in ("http:", "https:"):
        return None
    u.protocol = "https:"
    for k in [k for k, _ in u.search_params()]:
        if TRACKING_PARAM_RE.match(k):
            u.delete_search_param(k)
    return u.href


def _format_text(v: Any) -> str | None:
    strs = as_strings(v)
    if not strs:
        return None
    t = clean_text(strs[0])
    return t or None


def _format_list(_key: str, v: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in as_strings(v):
        for p in re.split(r"[;\n•]|\s\|\s|(?:^|\s)\*\s", raw):
            t = clean_text(p or "")
            if not t:
                continue
            k = t.lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(t)
    return out


REG_ISSUER_RE = re.compile(r"\b(NMLS|CRD|FINRA|SEC|IARD)\b")


def to_credential(text: str, hint: str | None = None) -> dict[str, Any] | None:
    t = clean_text(text)
    if not t:
        return None
    im = REG_ISSUER_RE.search(t)
    issuer = im.group(1) if im else None
    if hint:
        type_ = hint
    elif re.search(r"licen[cs]e", t, re.IGNORECASE):
        type_ = "license"
    elif issuer or re.search(r"registration|\breg\.?\s*#", t, re.IGNORECASE):
        type_ = "registration"
    else:
        type_ = "designation"
    c: dict[str, Any] = {"type": type_}
    if type_ == "designation":
        name = trim(re.sub(r"[®™]", "", t))
        if not name:
            return None
        c["name"] = name
        return c
    lm = re.search(r"(?:#|\bno\.?|\bnumber|\bid)\s*:?\s*([A-Z0-9][A-Z0-9-]{3,})", t, re.IGNORECASE)
    labelled = lm.group(1) if lm else None
    num = labelled if labelled and re.search(r"\d", labelled) else None
    if num is None:
        nm = re.search(r"\b([A-Z]{0,3}-?\d[\dA-Z-]{3,})\b", t)
        num = nm.group(1) if nm else None
    if num:
        c["number"] = num
    if issuer:
        c["issuer"] = issuer
    if type_ == "license":
        for m in re.finditer(r"\b([A-Z]{2})\b(?!\s*[:#])", t):
            if m.group(1) != issuer and state_code(m.group(1)):
                c["state"] = m.group(1)
                break
        if not c.get("state"):
            for code, nm2 in US_STATES.items():
                if re.search(rf"\b{nm2}\b", t, re.IGNORECASE):
                    c["state"] = code
                    break
    name = t.replace(num if num is not None else "\u0000", "", 1)
    name = re.sub(r"(?:#|\bno\.?|\bnumber|\bid)\s*:?\s*$", "", name, count=1, flags=re.IGNORECASE)
    name = re.sub(r"[#:]+", " ", name)
    name = re.sub(r"[®™]", "", name)
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"^[\s,.;-]+|[\s,.;-]+$", "", name)
    sc = state_code(name) if name else None
    if name and not (sc and (c.get("state") == sc or not c.get("state"))):
        c["name"] = name
    elif name and sc:
        c["state"] = sc
    elif issuer:
        c["name"] = issuer
    return c if c.get("name") or c.get("number") or c.get("state") else None


PLATFORM_BY_HOST: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(^|\.)facebook\.com$|(^|\.)fb\.com$"), "facebook"),
    (re.compile(r"(^|\.)linkedin\.com$"), "linkedin"),
    (re.compile(r"(^|\.)twitter\.com$|(^|\.)x\.com$"), "x"),
    (re.compile(r"(^|\.)instagram\.com$"), "instagram"),
    (re.compile(r"(^|\.)youtube\.com$|(^|\.)youtu\.be$"), "youtube"),
    (re.compile(r"(^|\.)tiktok\.com$"), "tiktok"),
    (re.compile(r"(^|\.)pinterest\.com$"), "pinterest"),
    (re.compile(r"(^|\.)yelp\.com$"), "yelp"),
    (re.compile(r"(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|(^|\.)g\.page$"), "google"),
]


def _to_links(v: Any, page_url: str) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for s in as_strings(v):
        if re.search(r"\s", trim(s)):
            continue
        url = format_url(s, page_url)
        if not url:
            continue
        u = try_url(url)
        host = u.hostname.lower() if u else ""
        if "." not in host:
            continue
        if url in seen:
            continue
        seen.add(url)
        platform = next((p for rx, p in PLATFORM_BY_HOST if rx.search(host)), "other")
        out.append({"platform": platform, "url": url})
    return out


DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
DAY_RE_SRC = (r"(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|"
              r"sat(?:urday)?|sun(?:day)?|mo|tu|we|th|fr|sa|su)\.?")
_DAY_LINE_RE = re.compile(
    rf"^{DAY_RE_SRC}(?:\s*(?:-|to|through)\s*{DAY_RE_SRC})?((?:\s*,\s*{DAY_RE_SRC})*)\s*:?\s*(.*)$",
    re.IGNORECASE,
)
_TIME_RE = re.compile(
    r"^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|to)\s*"
    r"(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?$",
    re.IGNORECASE,
)


def _day_index(s: str) -> int:
    t = re.sub(r"\.$", "", s.lower(), count=1)
    try:
        return ["mo", "tu", "we", "th", "fr", "sa", "su"].index(t[:2])
    except ValueError:
        return -1


def _hhmm(h: int, m: int) -> str:
    return f"{h:02d}:{m:02d}"


def _parse_hours_line(line: str) -> list[dict[str, str]] | None:
    s = trim(re.sub(r"\s+", " ", re.sub(r"[–—]", "-", line)))
    m = _DAY_LINE_RE.match(s)
    if not m:
        return None
    start = _day_index(m.group(1))
    end = _day_index(m.group(2)) if m.group(2) else start
    if start < 0 or end < 0:
        return None
    days: list[int] = []
    i = start
    while True:
        days.append(i)
        if i == end or len(days) > 7:
            break
        i = (i + 1) % 7
    for extra in [trim(x) for x in (m.group(3) or "").split(",") if trim(x)]:
        j = _day_index(extra)
        if j >= 0 and j not in days:
            days.append(j)
    rest = trim(m.group(m.re.groups) or "")
    if re.fullmatch(r"closed", rest, re.IGNORECASE):
        return [{"day": DAYS[d]} for d in days]
    tm = _TIME_RE.match(rest)
    if not tm:
        return None
    oh = int(tm.group(1))
    om = int(tm.group(2) or 0)
    ch = int(tm.group(4))
    cm = int(tm.group(5) or 0)
    oap = "pm" if tm.group(3) and tm.group(3).lower().startswith("p") else (
        "am" if tm.group(3) else "")
    cap = "pm" if tm.group(6) and tm.group(6).lower().startswith("p") else (
        "am" if tm.group(6) else "")
    if oap == "pm" and oh < 12:
        oh += 12
    if oap == "am" and oh == 12:
        oh = 0
    if cap == "pm" and ch < 12:
        ch += 12
    if cap == "am" and ch == 12:
        ch = 0
    # "9-5" without am/pm: a closing hour before the opening hour is afternoon.
    if not oap and not cap and ch <= oh and ch < 12:
        ch += 12
    if oh > 24 or ch > 24 or om > 59 or cm > 59:
        return None
    return [{"day": DAYS[d], "opens": _hhmm(oh, om), "closes": _hhmm(ch, cm)} for d in days]


_HOURS_SPLIT_RE = re.compile(
    r"\n|;|\s\|\s|,(?=\s*(?:mon|tue|wed|thu|fri|sat|sun|mo|tu|we|th|fr|sa|su)\b)", re.IGNORECASE)


def _to_hours(v: Any) -> list[Any]:
    out: list[Any] = []
    seen: set[str] = set()
    for raw in as_strings(v):
        for seg in _HOURS_SPLIT_RE.split(raw):
            t = clean_text(seg)
            if not t:
                continue
            parsed = _parse_hours_line(t)
            for item in parsed if parsed is not None else [t]:
                k = item.lower() if isinstance(item, str) else item["day"]
                if k in seen:
                    continue
                seen.add(k)
                out.append(item)
    return out


NON_NAME_RE = re.compile(
    r"\b(solutions?|services?|compensation|wellness|planning|management|investing|investments?|"
    r"strategies|strategy|specialist|associates?|page|home|debt|risk|access|older|organization|"
    r"portfolio|insurance|financial|wealth|retirement|charitable|giving|equity|executive|team|"
    r"group|advisors?|benefits?|plans?|lending|trust|estate|income|tax|business|clients?|"
    r"contact|learn|more|about|overview)\b",
    re.IGNORECASE,
)
_PARTICLES = {"de", "da", "del", "della", "di", "du", "la", "le", "van", "von", "der", "den",
              "bin", "al"}


def _first_def(o: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if o.get(k) is not None:
            return o[k]
    return None


def _to_members(v: Any, page_url: str, exclude: set[str] | None = None) -> list[dict[str, str]]:
    exclude = exclude or set()
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for x in v if isinstance(v, list) else ([] if v is None else [v]):
        m: dict[str, str] | None = None
        if isinstance(x, (dict, list)) and x:
            o = x if isinstance(x, dict) else {}
            name = _format_text(o.get("name"))
            if name:
                m = {"name": name}
                role = _format_text(_first_def(o, "role", "jobTitle"))
                if role:
                    m["role"] = role
                lic = _format_text(o.get("license"))
                if lic:
                    m["license"] = lic
                photo = format_url(_first_def(o, "photo_url", "image"), page_url)
                if photo:
                    m["photo_url"] = photo
        elif isinstance(x, str):
            t = clean_text(x)
            pieces = re.split(r"\s[-–|]\s|,\s", t)
            a, b = pieces[0], pieces[1:]
            words = re.split(r"\s+", trim(a))
            name_like = all(re.match(r"^[A-Z]", w) or w in _PARTICLES for w in words)
            if 2 <= len(words) <= 5 and not re.search(r"\d", a) and name_like:
                m = {"name": trim(a)}
                if b:
                    m["role"] = trim(", ".join(b))
        if not m or m["name"].lower() in seen:
            continue
        if NON_NAME_RE.search(m["name"]) or m["name"].lower() in exclude:
            continue
        seen.add(m["name"].lower())
        out.append(m)
    return out


def _is_license_label(name: str | None, number: str | None = None) -> bool:
    t = clean_text(name or "")
    return 3 <= len(t) <= 60 and t != number and ";" not in t and not state_code(t)


_YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")


def _one_year(t: str) -> int | None:
    ys = [y for y in dict.fromkeys(int(m.group(1)) for m in _YEAR_RE.finditer(t))
          if y <= utc_year()]
    return ys[0] if len(ys) == 1 else None


def _to_awards(v: Any, page_url: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for x in v if isinstance(v, list) else ([] if v is None else [v]):
        a: dict[str, Any] | None = None
        if isinstance(x, (dict, list)) and x:
            o = x if isinstance(x, dict) else {}
            title = _format_text(_first_def(o, "title", "name"))
            if not title:
                continue
            a = {"title": title}
            y = _one_year(js_str(o["year"]) if o.get("year") is not None else "")
            if y is None:
                y = _one_year(title) if o.get("year") is None else None
            if y:
                a["year"] = y
            issuer = _format_text(o.get("issuer"))
            if issuer:
                a["issuer"] = issuer
            desc = _format_text(o.get("description"))
            if desc:
                a["description"] = desc
            url = format_url(o.get("url"), page_url)
            if url:
                a["url"] = url
        elif isinstance(x, str) or is_num(x):
            t = clean_text(js_str(x))
            if not t:
                continue
            y = _one_year(t)
            if y:
                title = trim(re.sub(rf"[\s,(–—-]*\b{y}\b[)\s]*$", "", t, count=1)) or t
            else:
                title = t
            a = {"title": title, **({"year": y} if y else {})}
        if not a:
            continue
        k = f"{a['title'].lower()}|{a.get('year', '')}"
        if k in seen:
            continue
        seen.add(k)
        out.append(a)
    return out


def _to_education(v: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for x in v if isinstance(v, list) else ([] if v is None else [v]):
        e: dict[str, Any] | None = None
        if isinstance(x, (dict, list)) and x:
            o = x if isinstance(x, dict) else {}
            e = {}
            school = _format_text(_first_def(o, "school", "name"))
            if school:
                e["school"] = school
            degree = _format_text(o.get("degree"))
            if degree:
                e["degree"] = degree
            y = _one_year(js_str(o["year"]) if o.get("year") is not None else "")
            if y:
                e["year"] = y
            if not e.get("school") and not e.get("degree"):
                t = _format_text(_first_def(o, "title", "text"))
                if t:
                    e["text"] = t
                else:
                    e = None
        elif isinstance(x, str):
            t = clean_text(x)
            if t:
                e = {"text": t}
                y = _one_year(t)
                if y:
                    e["year"] = y
        if not e:
            continue
        k = json_stringify(e).lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return out


# ---- derived rules (section 5.4) --------------------------------------------
NAME_SUFFIX_RE = re.compile(r"^(jr\.?|sr\.?|ii|iii|iv|v|vi)$", re.IGNORECASE)


def _is_designation_token(tok: str) -> bool:
    t = trim(tok)
    if not t or NAME_SUFFIX_RE.match(t):
        return False
    u = re.sub(r"[®™]", "", t)
    if u != t:
        return len(u) >= 2
    if re.fullmatch(r"(?:[A-Z][a-z]?\.){2,4}", u):
        return True
    if not re.fullmatch(r"[A-Za-z]{2,7}", u):
        return False
    upper = len(re.findall(r"[A-Z]", u))
    lower = len(re.findall(r"[a-z]", u))
    return upper >= 2 and lower <= 1 and bool(re.match(r"^[A-Z]", u))


def split_post_nominals(name: str) -> dict[str, Any]:
    """"Jane Doe, CFP®, CEPA" -> { name: "Jane Doe", designations: ["CFP®", "CEPA"] }."""
    segs = [x for x in (trim(s) for s in name.split(",")) if x]
    if not segs:
        return {"name": name, "designations": []}
    designations: list[str] = []
    keep: list[str] = []
    other: list[str] = []
    for i, seg in enumerate(segs):
        toks = re.split(r"\s+", seg)
        if i > 0 and len(toks) <= 3 and all(_is_designation_token(t) for t in toks):
            designations.extend(toks)
        elif i == 0 or NAME_SUFFIX_RE.match(seg) or len(re.split(r"\s+", segs[0])) == 1:
            keep.append(seg)
        else:
            other.append(seg)
    first = re.split(r"\s+", keep[0] if keep else "")
    trail: list[str] = []
    mark = next((i for i, t in enumerate(first) if i >= 2 and re.search(r"[®™]", t)), -1)
    if mark >= 2 and all(_is_designation_token(t) for t in first[mark:]):
        trail.extend(first[mark:])
        first = first[:mark]
    rest = ", ".join(x for x in [" ".join(first), *keep[1:]] if x)
    out: dict[str, Any] = {"name": rest or name, "designations": [*trail, *designations]}
    if other:
        out["trailing"] = ", ".join(other)
    return out


# ---- quality rules (section 5) ----------------------------------------------
def _url_core(u: str) -> str:
    x = try_url(u)
    if x is None:
        return ""
    host = re.sub(r"^www\.", "", x.hostname, count=1)
    return f"{host}{re.sub(r'/+$', '', x.pathname, count=1)}".lower()


def _is_list_like_text(s: str) -> bool:
    lines = [ln for ln in (trim(x) for x in s.split("\n")) if ln]
    if len(lines) < 4:
        return False
    short = sum(1 for ln in lines if len(re.split(r"\s+", ln)) <= 6)
    return short / len(lines) >= 0.6


def is_hours_text(text: str) -> bool:
    """Text made of opening hours (3+ "Mon 08:30AM"-style entries) is an hours panel."""
    t = clean_text(text)
    days = len(re.findall(
        r"\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?:?\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|"
        r"by appointment|closed)\b", t, re.IGNORECASE))
    if days >= 3:
        return True
    labels = {m.group(0).lower() for m in re.finditer(
        r"(phone|fax|office address|mailing address|e-?mail|office hours)", t, re.IGNORECASE)}
    sentences = len(re.findall(r"[a-z]{2}[.!?](?:\s|$)", t))
    return len(labels) >= 2 and sentences < 2


def is_real_bio(text: str, name: str) -> bool:
    t = clean_text(text)
    if len(t) < 40:
        return False
    ranges = re.findall(
        r"\b(?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|current|today)\b", t, re.IGNORECASE)
    if len(ranges) >= 2:
        return False
    sentences = len(re.findall(r"[.!?](?:\s|$)", t))
    tokens = [w for w in re.split(r"\s+", re.sub(r"[^A-Za-z\s'-]", " ", name))
              if len(w) >= 3 and not NAME_SUFFIX_RE.match(w)]
    pats = [re.sub(r"[-']", ".", w) for w in tokens]
    if any(re.search(rf"\b{p}\b", t, re.IGNORECASE) for p in pats):
        return True
    if re.search(r"\b(i|i'm|i've|i am|my|me|we|we're|our|us)\b", t, re.IGNORECASE):
        return True
    if re.search(r"\b(he|she|his|her|hers|they|their)\b", t, re.IGNORECASE) and sentences >= 2:
        return True
    return len(t) >= 200 and sentences >= 2


def boilerplate_key(v: Any) -> str:
    """First 300 characters of norm_val: compared against contract.boilerplate_values."""
    return norm_val(v)[:300]


def _count_key(v: Any) -> str:
    if isinstance(v, dict):
        if is_num(v.get("latitude")):
            return norm_val(v)
        if isinstance(v.get("text"), str):
            return norm_val(v["text"])
        if isinstance(v.get("day"), str):
            opens = js_str(v["opens"]) if v.get("opens") is not None else ""
            closes = js_str(v["closes"]) if v.get("closes") is not None else ""
            return norm_val(f"{v['day']}{opens}{closes}")
        x = _first_def(v, "url", "title", "name", "school", "text", "number")
        return norm_val(x if x is not None else json_stringify(v))
    s = "" if v is None else js_str(v)
    d = _digits(s)
    if re.match(r"^\s*(tel:)?[+()\d\s.\-]+$", s, re.IGNORECASE) and (
            len(d) == 10 or (len(d) == 11 and d.startswith("1"))):
        return "tel" + d[-10:]
    return norm_val(s)


ACTION_NAV_RE = re.compile(
    r"^(log ?in|sign ?in|sign ?up|register|my account|careers?|jobs|search|menu|home|back|skip|"
    r"privacy|terms|cookies?|find (an?|your) [a-z ]+|locations?)$",
    re.IGNORECASE,
)


def action_type(text: str, url: str) -> str:
    """Action type by fixed rules on the button text / key name and the link."""
    t = f" {text.lower()} "
    if re.match(r"^tel:", url, re.IGNORECASE):
        return "call"
    if re.match(r"^sms:", url, re.IGNORECASE):
        return "text"
    if re.match(r"^mailto:", url, re.IGNORECASE):
        return "email"
    if "quote" in t:
        return "quote"
    if re.search(r"\bdemo\b", t):
        return "demo"
    if re.search(r"\b(book|schedul|appointment|meeting|reserve|consult)", t) or re.search(
            r"calendly\.com|acuityscheduling|bookings|/book", url, re.IGNORECASE):
        return "book"
    if re.search(r"\breview\b", t):
        return "review"
    if re.search(r"\b(text|sms)\b", t):
        return "text"
    if re.search(r"\bcall\b", t):
        return "call"
    if re.search(r"\b(contact|message|connect|get in touch|ask|inquir|enquir|chat|e-?mail)", t):
        return "contact"
    return "other"


def _action_label_from_slug(words: str) -> str:
    w = trim(re.sub(r"\s+", " ", re.sub(r"\b(action|cta|url|button|link|widget|agent|brand)\b",
                                         " ", words, flags=re.IGNORECASE)))
    return w[0].upper() + w[1:] if w else words


def action_key(label: str, url: str) -> str:
    """Key used to compare actions across sample pages (contract.sitewide_actions)."""
    lab = re.sub(r"[^a-z0-9]+", "", label.lower())
    return f"{lab}|{_url_core(url) if re.match(r'^https?:', url, re.IGNORECASE) else url.lower()}"


_ADDR_OBJ_KEYS = {"street": "streetAddress", "city": "addressLocality", "state": "addressRegion",
                  "postal_code": "postalCode"}


def build_staging_static(args: dict[str, Any] | None = None, /, **kw: Any) -> dict[str, Any]:
    """Step 3: page rule -> route -> derived -> quality -> format.

    Arguments: contract, values, extras, page_url. Returns ``{universal, extras, sources}``.
    """
    a = kwargs_of(args, kw)
    contract: dict[str, Any] = a.get("contract") or {}
    page_url: str = a.get("page_url") or ""
    vals: dict[str, Any] = {k: v for k, v in (a.get("values") or {}).items() if non_empty(v)}
    extras: dict[str, Any] = {k: v for k, v in (a.get("extras") or {}).items() if non_empty(v)}
    sources: dict[str, str] = {}
    static_routes = contract.get("static_routes") or {}
    boiler = contract.get("boilerplate_values") or {}

    # 2-3. routes.
    routed_extras: dict[str, list[str]] = {}
    for sid, lst in static_routes.items():
        routes_for = lst if isinstance(lst, list) else []
        type_ = field_type(sid)
        if not type_ or key_of(sid) == "actions":
            continue
        for r in routes_for:
            if r.get("kind") == "extra":
                routed_extras.setdefault(sid, []).append(r.get("from"))
        merge = is_mergeable_id(sid)
        if not merge and non_empty(vals.get(sid)):
            continue
        if merge:
            cur = vals.get(sid)
            merged: list[Any] = list(cur) if isinstance(cur, list) else (
                [cur] if non_empty(cur) else [])
        else:
            merged = []
        before = len(merged)
        for route in routes_for:
            if not merge and non_empty(vals.get(sid)):
                break
            if route.get("kind") == "taxonomy":
                got: list[Any] = []
                part = route.get("part")
                for frm in route.get("from") or []:
                    v = vals.get(frm)
                    if not non_empty(v):
                        continue
                    if part and isinstance(v, dict):
                        v = v.get(part) if part in ("latitude", "longitude") \
                            else v.get(_ADDR_OBJ_KEYS.get(part, ""))
                    elif part:
                        continue
                    ok = validate_value(type_, v, page_url, sid)
                    if non_empty(ok):
                        got.append(ok)
                if not got:
                    continue
                if merge:
                    for g in got:
                        merged.extend(g if isinstance(g, list) else [g])
                    continue
                keys = {"|".join(sorted(_count_key(x) for x in g)) if isinstance(g, list)
                        else _count_key(g) for g in got}
                if len(keys) != 1:
                    continue
                vals[sid] = got[0]
                sources[sid] = "taxonomy"
            else:
                v = extras.get(route.get("from"))
                if not non_empty(v):
                    continue
                if route.get("split_commas"):
                    v = [p for p in (trim(y) for x in as_strings(v) for y in x.split(",")) if p]
                ok = validate_value(type_, v, page_url, sid)
                if not non_empty(ok):
                    continue
                if merge:
                    merged.extend(ok if isinstance(ok, list) else [ok])
                    continue
                vals[sid] = ok
                sources[sid] = "extra"
        if merge and len(merged) > before:
            vals[sid] = merged
            sources[sid] = "extra" if any(
                r.get("kind") == "extra" and non_empty(extras.get(r.get("from")))
                for r in routes_for) else "taxonomy"
    for sid, keys_ in routed_extras.items():
        if non_empty(vals.get(sid)):
            for k in keys_:
                extras.pop(k, None)

    # actions: page buttons + every routed action key; site-wide and navigation items dropped.
    actions_by: dict[str, list[dict[str, str]]] = {}

    def last10(x: str) -> str:
        return _digits(x)[-10:]

    known_phones = {d for d in (last10(s) for fid in (
        "person.phone", "person.fax", "location.phone", "location.fax", "firm.phone_main",
        "firm.fax") for s in as_strings(vals.get(fid))) if len(d) == 10}
    known_emails = {e for e in (trim(re.sub(r"^mailto:", "", s, count=1, flags=re.IGNORECASE)
                                     .split("?")[0]).lower()
                                for fid in ("person.email", "location.email", "firm.email")
                                for s in as_strings(vals.get(fid))) if e}
    sitewide_actions = contract.get("sitewide_actions") or {}
    for subj in ("person", "location"):
        sid = f"{subj}.actions"
        lst: list[dict[str, str]] = []
        seen: set[str] = set()

        def push(label: str, raw_url: str, type_hint: str = "", _sid: str = sid,
                 _lst: list[dict[str, str]] = lst, _seen: set[str] = seen) -> None:
            url = action_url(raw_url, page_url)
            lab = clean_text(label)
            if not url or not lab or len(lab) > 80:
                return
            if re.match(r"^(tel|sms):", url, re.IGNORECASE) and last10(url) in known_phones:
                return
            if re.match(r"^mailto:", url, re.IGNORECASE) and trim(url[7:].split("?")[0]).lower() \
                    in known_emails:
                return
            fmt = format_url(url, page_url) if re.match(r"^https?:", url) else url
            if not fmt:
                return
            if ACTION_NAV_RE.match(lab) or action_key(lab, fmt) in (sitewide_actions.get(_sid)
                                                                     or []):
                return
            k = fmt.lower()
            if k in _seen:
                return
            _seen.add(k)
            _lst.append({"label": lab, "url": fmt, "type": action_type(f"{type_hint} {lab}", fmt)})

        for s in as_strings(vals.get(sid)):
            act = decode_action(s)
            if act:
                push(act["label"], act["url"])
        r = next((x for x in (static_routes.get(sid) or [])
                  if x.get("kind") == "taxonomy" and x.get("merge")), None)
        if r:
            for frm in r.get("from") or []:
                slug_words = re.sub(r"[_-]+", " ", frm[len(TAX_PREFIX):])
                for u in as_strings(vals.get(frm)):
                    before_n = len(lst)
                    push(_action_label_from_slug(slug_words), u, slug_words)
                    if len(lst) > before_n:
                        sources.setdefault(sid, "taxonomy")
        if subj == "location" and actions_by.get("person.actions"):
            person_urls = {x["url"].lower() for x in actions_by["person.actions"]}
            lst[:] = [x for x in lst if x["url"].lower() not in person_urls]
        if lst:
            actions_by[sid] = lst
        if subj == "person" and not non_empty(vals.get("person.booking_url")):
            book = next((x for x in lst if x["type"] == "book" and re.match(r"^https?:", x["url"])),
                        None)
            if book:
                vals["person.booking_url"] = book["url"]
                sources["person.booking_url"] = "derived"

    # 4. derived rules — Fix (office block, 2026-10-12).
    def first_str(x: Any) -> str:
        ss = as_strings(x)
        return ss[0] if ss else ""

    def l10(x: Any) -> str:
        return _digits(first_str(x))[-10:]

    def low(x: Any) -> str:
        return re.sub(r"[^a-z0-9]", "", clean_text(first_str(x)).lower())

    for k, raw in list(extras.items()):
        if not isinstance(raw, str):
            continue
        ob = parse_office_block(raw)
        if not ob:
            continue
        cur_street = low(vals.get("location.street"))
        if cur_street and not (cur_street.startswith(low(ob["street"]))
                               or low(ob["street"]).startswith(cur_street)):
            continue
        if non_empty(vals.get("location.city")) and low(vals["location.city"]) != low(ob["city"]):
            continue
        if non_empty(vals.get("location.state")):
            ss = as_strings(vals["location.state"])
            if state_code(clean_text(ss[0] if ss else "undefined")) != ob["state"]:
                continue
        if non_empty(vals.get("location.postal_code")) and \
                l10(vals["location.postal_code"])[:5] != ob["postal_code"][:5]:
            continue
        for part in ("street", "city", "state", "postal_code"):
            fid = f"location.{part}"
            if not non_empty(vals.get(fid)):
                vals[fid] = ob[part]
                sources[fid] = "derived"
        lp = l10(vals.get("location.phone"))
        if (not lp or lp == l10(vals.get("person.phone"))) and lp != ob["phone"]:
            vals["location.phone"] = ob["phone"]
            sources["location.phone"] = "derived"
        del extras[k]
        break
    # Fix (years plausibility, 2026-10-13).
    if non_empty(vals.get("person.years_experience")):
        yv = vals["person.years_experience"]
        if is_num(yv):
            yn = float(yv)
        else:
            m = re.search(r"\d+(?:\.\d+)?", first_str(yv))
            yn = js_number(m.group(0) if m else None)
        if not (math.isfinite(yn) and 1 <= yn < 80):
            vals.pop("person.years_experience", None)
            sources.pop("person.years_experience", None)
    # Fix (years of experience, 2026-10-12).
    bio = vals.get("person.bio")
    if (not non_empty(vals.get("person.years_experience")) and isinstance(bio, str)
            and boilerplate_key(bio) not in (boiler.get("person.bio") or [])):
        m = re.search(r"\b(\d{1,2})\+?\s+years?\s+of\s+(?:(?:professional|industry|"
                      r"financial(?:\s+services)?|relevant)\s+)?experience\b", bio, re.IGNORECASE)
        if m:
            vals["person.years_experience"] = int(m.group(1))
            sources["person.years_experience"] = "derived"
    cred_texts: list[tuple[str, str | None]] = [(s, None) for s in
                                                as_strings(vals.get("person.credentials"))]
    if isinstance(vals.get("person.name"), str):
        sp = split_post_nominals(vals["person.name"])
        if sp["designations"] or sp.get("trailing"):
            vals["person.name"] = sp["name"]
            cred_texts.extend((d, None) for d in sp["designations"])
            if sp["designations"]:
                sources.setdefault("person.credentials", "derived")
            if sp.get("trailing") and not non_empty(vals.get("person.job_title")):
                vals["person.job_title"] = sp["trailing"]
                sources["person.job_title"] = "derived"
    cred_texts.extend((s, "license") for s in as_strings(vals.get("person.licenses")))
    cred_texts.extend((s, "registration") for s in as_strings(vals.get("person.registration_ids")))
    if not non_empty(vals.get("person.year_started")):
        n = js_number(vals.get("person.years_experience"))
        if is_finite(n) and 0 < n < 80:
            vals["person.year_started"] = utc_year() - js_round(n)
            sources["person.year_started"] = "derived"

    creds: list[dict[str, Any]] = []
    cred_seen: set[str] = set()
    for text, hint in cred_texts:
        pieces = [text] if hint else re.split(r"[;\n]|\s\|\s", text)
        for p in pieces:
            c = to_credential(p, hint)
            if not c:
                continue
            k = f"{(c.get('name') or '').lower()}|{c.get('number') or ''}"
            if k in cred_seen:
                continue
            cred_seen.add(k)
            creds.append(c)
    for subj in ("person", "location"):
        fid = f"{subj}.gbp_place_id"
        if non_empty(vals.get(fid)):
            continue
        pid = to_place_id([u for u in as_strings(vals.get(f"{subj}.social_links"))
                           if re.search(r"google\.|goo\.gl", u, re.IGNORECASE)])
        if pid:
            vals[fid] = pid
            sources[fid] = "derived"
    lic = next((c for c in creds if c["type"] == "license"), None)
    if lic:
        if not non_empty(vals.get("person.license_number")) and lic.get("number"):
            vals["person.license_number"] = lic["number"]
            sources["person.license_number"] = "derived"
        if not non_empty(vals.get("person.license_state")) and lic.get("state"):
            vals["person.license_state"] = lic["state"]
            sources["person.license_state"] = "derived"
        if not non_empty(vals.get("person.license_type")) and _is_license_label(
                lic.get("name"), lic.get("number")):
            vals["person.license_type"] = lic["name"]
            sources["person.license_type"] = "derived"

    # quality: boilerplate text, list-like bio.
    for fid in ("person.bio", "location.description"):
        v = vals.get(fid)
        if not isinstance(v, str):
            continue
        bp = boiler.get(fid)
        if bp and boilerplate_key(v) in bp:
            del vals[fid]
            continue
        if fid == "person.bio" and _is_list_like_text(v):
            del vals[fid]
    for fid in ("person.bio", "location.description", "firm.description"):
        if isinstance(vals.get(fid), str) and is_hours_text(vals[fid]):
            del vals[fid]
    # Street lines: glued suite gets its space back; a leading branch name is dropped.
    for fid in ("person.street", "location.street", "firm.street"):
        if not isinstance(vals.get(fid), str):
            continue
        t = re.sub(r"([a-z.])(Suite|Ste\b|Unit|Apt|Bldg|Building|Floor|Fl\b|#)", r"\1 \2",
                   clean_text(vals[fid]))
        parts = re.split(r"\s*,\s*", t)
        i = next((j for j, p in enumerate(parts) if re.match(r"^\d", p)), -1)
        if i > 0:
            t = ", ".join(parts[i:])
        vals[fid] = t
    # The profile URL is always the harvested page itself (section 3a).
    if (contract.get("primary_subject") or "person") == "person":
        vals["person.profile_url"] = page_url
    if isinstance(vals.get("person.bio"), str) and not is_real_bio(
            vals["person.bio"], js_str(vals["person.name"]) if vals.get("person.name") is not None
            else ""):
        del vals["person.bio"]
    lt = vals.get("person.license_type")
    if isinstance(lt, str):
        ct = clean_text(lt)
        if len(ct) > 60 or ";" in lt or len(ct) < 3 or state_code(ct):
            del vals["person.license_type"]
            if lic and _is_license_label(lic.get("name"), lic.get("number")):
                vals["person.license_type"] = lic["name"]
                sources["person.license_type"] = "derived"
    # US coordinates: latitude north (+), longitude west (-); outside the US range dropped.
    st_src = vals.get("location.state") if vals.get("location.state") is not None \
        else vals.get("person.state")
    st_list = as_strings(st_src)
    st = st_list[0] if st_list else None
    lat = js_number(vals.get("location.latitude"))
    lon = js_number(vals.get("location.longitude"))
    if st and state_code(clean_text(st)) and math.isfinite(lat) and math.isfinite(lon):
        la = abs(lat)
        lo = -abs(lon)
        if 17 <= la <= 72 and -180 <= lo <= -64:
            vals["location.latitude"] = _num(la)
            vals["location.longitude"] = _num(lo)
        else:
            vals.pop("location.latitude", None)
            vals.pop("location.longitude", None)
    page_core = _url_core(page_url)
    home = try_url("/", page_url)
    home_core = _url_core(home.href) if home else ""
    firm_core = _url_core(format_url(vals["firm.website"], page_url) or "") \
        if isinstance(vals.get("firm.website"), str) else ""
    for fid in ("person.website", "person.booking_url"):
        u = format_url(vals.get(fid), page_url)
        c = _url_core(u) if u else ""
        if not c or c == page_core or c == home_core or (firm_core and c == firm_core):
            vals.pop(fid, None)
    if firm_core and firm_core == page_core:
        vals.pop("firm.website", None)
    # Fix (office website, 2026-10-12): the office website is never this profile page.
    u = format_url(vals.get("location.website"), page_url)
    if u and _url_core(u) == page_core:
        vals.pop("location.website", None)
    # Social links point to social profiles, not back to this site.
    pu = try_url(page_url)
    site_root = ".".join(pu.hostname.lower().split(".")[-2:]) if pu else ""
    for fid in ("person.social_links", "location.social_links", "firm.social_links"):
        if not non_empty(vals.get(fid)) or not site_root:
            continue
        kept = []
        for s in as_strings(vals[fid]):
            x = try_url(s, page_url)
            if x is None:
                kept.append(s)
                continue
            h = x.hostname.lower()
            if h != site_root and not h.endswith("." + site_root):
                kept.append(s)
        if kept:
            vals[fid] = kept
        else:
            del vals[fid]

    # formats
    sitewide_media = contract.get("sitewide_media") or {}
    universal: dict[str, Any] = {}
    for fid, fmt in STATIC_FORMATS.items():
        v = vals.get(fid)
        out: Any = None
        key = fid[fid.find(".") + 1:]
        if fmt == "credential_list":
            out = creds if fid == "person.credentials" and creds else None
        elif fmt == "text":
            out = _format_text(v)
        elif fmt == "phone":
            out = to_us_phone10(v) if non_empty(v) else None
        elif fmt == "email":
            ss = as_strings(v)
            e = trim(re.sub(r"^mailto:", "", ss[0], count=1, flags=re.IGNORECASE).split("?")[0]).lower() \
                if ss else None
            out = e if e and EMAIL_RE.match(e) else None
        elif fmt == "url":
            out = format_url(v, page_url) if non_empty(v) else None
        elif fmt == "state":
            ss = as_strings(v)
            out = state_code(clean_text(ss[0])) if ss and ss[0] else None
        elif fmt == "postal":
            ss = as_strings(v)
            if ss and ss[0]:
                zm = ZIP_RE.search(clean_text(ss[0]))
                out = zm.group(1) if zm else None
        elif fmt == "year":
            if is_num(v):
                n = v
            else:
                ym = re.search(r"\d{4}", first_str(v))
                n = js_number(ym.group(0) if ym else None)
            out = _num(n) if is_integer(n) and 1800 <= n <= utc_year() else None
        elif fmt == "number":
            n = v if is_num(v) else js_number(trim(first_str(v)))
            out = _num(n) if non_empty(v) and is_finite(n) else None
        elif fmt == "list":
            lst2 = _format_list(key, v)
            out = lst2 or None
        elif fmt == "link_list":
            out = _to_links(v, page_url) or None
        elif fmt == "hours_list":
            out = _to_hours(v) or None
        elif fmt == "member_list":
            exclude = {x for x in (clean_text(y).lower() for k2 in (
                "person.name", "person.services", "person.specialties", "person.job_title",
                "person.headline") for s in as_strings(vals.get(k2)) for y in [s, *s.split(",")])
                if x}
            out = _to_members(v, page_url, exclude) or None
        elif fmt == "place_id":
            out = to_place_id(v)
        elif fmt == "action_list":
            out = actions_by.get(fid)
        elif fmt == "award_list":
            out = _to_awards(v, page_url) or None
        elif fmt == "video_list":
            site = set(sitewide_media.get(fid) or [])
            lv: list[dict[str, str]] = []
            seen_v: set[str] = set()
            for x in v if isinstance(v, list) else ([] if v is None else [v]):
                o = x if isinstance(x, (dict, list)) and x is not None else None
                if o is not None:
                    raw_u = js_str(o.get("url")) if isinstance(o, dict) and \
                        o.get("url") is not None else ""
                else:
                    raw_u = js_str(x)
                vv = video_from_url(raw_u, page_url)
                if not vv or vv["url"] in site or vv["url"] in seen_v:
                    continue
                seen_v.add(vv["url"])
                title = _format_text(o.get("title")) if isinstance(o, dict) else None
                lv.append({**vv, "title": title} if title else vv)
            out = lv or None
        elif fmt == "gallery_list":
            subj = fid[: fid.find(".")]
            own = {x for x in (format_url(vals.get(k2), page_url) for k2 in (
                f"{subj}.photo_url", f"{subj}.cover_photo_url", f"{subj}.logo_url",
                "firm.logo_url")) if x}
            site = set(sitewide_media.get(fid) or [])
            lg: list[str] = []
            for x in as_strings(v):
                uu = format_url(x, page_url)
                if not uu or uu in own or uu in site or uu in lg:
                    continue
                lg.append(uu)
            out = lg or None
        elif fmt == "education_list":
            out = _to_education(v) or None
        if non_empty(out):
            universal[fid] = out
    return {"universal": universal, "extras": extras, "sources": sources}


def _num(n: float) -> float | int:
    if isinstance(n, float) and math.isfinite(n) and n == int(n):
        return int(n)
    return n


def count_staging_fields(universal: dict[str, Any], values: dict[str, Any]) -> int:
    """Distinct values over the static (formatted) and taxonomy values."""
    all_v: list[Any] = [*universal.values(),
                        *[v for fid, v in values.items() if is_tax_id(fid) and non_empty(v)]]
    scalars: dict[str, None] = {}
    lists: list[set[str]] = []
    for v in all_v:
        if isinstance(v, list):
            s = {k for k in (_count_key(x) for x in v) if k}
            if s:
                lists.append(s)
        else:
            k = _count_key(v)
            if k:
                scalars[k] = None
    n = sum(1 for k in scalars if not any(k in lst for lst in lists))
    distinct: dict[str, set[str]] = {}
    for lst in lists:
        distinct["|".join(sorted(lst))] = lst
    dl = list(distinct.values())
    for lst in dl:
        contained = any(o is not lst and len(o) > len(lst) and lst <= o for o in dl)
        if not contained:
            n += 1
    return n
