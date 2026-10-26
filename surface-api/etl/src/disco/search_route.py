"""disco search route (port of `-disco-search-route.ts`, route-based mapper step 6, 2026-10-07).

Pure helpers (no network, no DB) used by the AI worker's map_site:

- `stated_total_in_text`: a result count the site itself states on a page ("16,554 agents
  found", "Showing 1-12 of 146,729", "2,310 advisors near you").
- `needs_more_routes`: the coverage rule that decides whether the background-call (step 5) and
  search-input (step 6) routes are tried. No fixed profile count: the best proven route is
  compared with a total the site states; without one, only a route with no proven reach or a
  lower-bound reach asks for more.
- `find_search_inputs`: search boxes on a page (city / ZIP / name), read from the page's own
  form fields and labels.
- `search_values` / `name_starts`: the values tried while mapping, from our own data.

Generic patterns only, no site names. Result dicts keep the TS keys (they are stored as JSON).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from bs4 import BeautifulSoup

from _base.disco.site_contract._js import try_url

# ---- stated totals ----------------------------------------------------------------------------
# Fix (count words follow the category, 2026-10-07): only neutral words plus the caller's
# category words count; "115 offices" on a person category's page is not its profile total.
GENERIC_COUNT_WORDS = ["results", "result", "matches", "listings", "profiles"]

_I = re.IGNORECASE


def _visible_text(html: str) -> str:
    s = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=_I)
    s = re.sub(r"<style[\s\S]*?</style>", " ", s, flags=_I)
    s = re.sub(r"<noscript[\s\S]*?</noscript>", " ", s, flags=_I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"&nbsp;|&#160;", " ", s)
    s = re.sub(r"&ndash;|&#8211;|&mdash;", "-", s)
    s = s.replace("&amp;", "&")
    return re.sub(r"\s+", " ", s)


def _to_num(s: str) -> float:
    d = re.sub(r"[^\d]", "", re.sub(r"[,.\s](?=\d{3}\b)", "", s))
    return float(int(d)) if d else 0.0


def _dedupe(xs: list[str]) -> list[str]:
    out: list[str] = []
    for x in xs:
        if x not in out:
            out.append(x)
    return out


def stated_total_in_text(html: str, category_words: list[str] | None = None) -> dict | None:
    """A result count the page states next to a count word (generic words plus the category's
    own head words). Largest plausible one: {total, snippet} or None."""
    if not html:
        return None
    text = _visible_text(html)[:400_000]
    words = _dedupe([*GENERIC_COUNT_WORDS, *(
        x for w in (category_words or []) for x in (w, f"{w}s", f"{w}es")
    )])
    words = [w.replace("-", "\\-") for w in words if re.match(r"^[a-z][a-z-]{2,30}$", w, _I)]
    if not words:
        return None
    w_ = f"(?:{'|'.join(words)})"
    n_ = r"(\d{1,3}(?:[,.\s]\d{3})+|\d{2,7})"
    patterns = [
        rf"\bof\s+(?:about\s+|over\s+)?{n_}\+?\s+(?:[a-z-]+\s+){{0,2}}?{w_}\b",
        (rf"\b{n_}\+?\s+(?:[a-z-]+\s+){{0,2}}?{w_}\s+"
         r"(?:found|available|near|matching|in|nationwide|listed)\b"),
        rf"\b(?:showing|displaying|viewing)\s+\d{{1,5}}\s*[-–]\s*\d{{1,5}}\s+of\s+{n_}\b",
        rf"\b{n_}\+?\s+(?:total\s+)?{w_}\b",
    ]
    best: dict | None = None
    for pi, pat in enumerate(patterns):
        for m in re.finditer(pat, text, _I):
            n = _to_num(m.group(1))
            if n < 2 or n > 20_000_000:
                continue
            # The last, loosest pattern needs 3+ digits (avoids "5 agents" copy).
            if pi == 3 and n < 100:
                continue
            if re.match(r"^(19|20)\d{2}$", m.group(1)):
                continue  # a year
            if not best or n > best["total"]:
                best = {"total": int(n), "snippet": m.group(0).strip()[:80]}
    return best


# ---- coverage rule ----------------------------------------------------------------------------
def needs_more_routes(best_reach: float, lower_bound: bool, stated_total: float | None) -> dict:
    """Whether more routes should be tried: {more, why, coverage}. With a stated total: when the
    best proven reach covers less than 90% of it. Without one: when the best route has no proven
    reach or only a lower bound."""
    br = _n(best_reach)
    if stated_total and stated_total > 0:
        st = _n(stated_total)
        coverage = best_reach / stated_total
        why = f"best route reaches {br} of {st} stated ({_round(coverage * 100)}%)"
        return {"more": coverage < 0.9, "why": why, "coverage": coverage}
    if best_reach <= 0:
        return {"more": True, "why": "no route reaches any profiles and no total is stated",
                "coverage": None}
    if lower_bound:
        return {"more": True,
                "why": f"best route reach {br} is a lower bound and no total is stated",
                "coverage": None}
    return {"more": False,
            "why": f"best route reaches {br}; no total stated, reach not a lower bound",
            "coverage": None}


def _round(x: float) -> int:
    import math

    return math.floor(x + 0.5)


def _n(x: float) -> str:
    if isinstance(x, float) and x == int(x):
        return str(int(x))
    return str(x)


# ---- search boxes -----------------------------------------------------------------------------
ZIP_RE = re.compile(r"\b(zip|postal|post\s*code|postcode)\b|zip", _I)
CITY_RE = re.compile(
    r"\b(city|location|address|near|where|place|town|state|area|market|region|metro)\b"
    r"|location|city", _I)
NAME_RE = re.compile(
    r"\b(name|agent|advisor|adviser|professional|realtor|person|who|last\s*name|first\s*name)\b"
    r"|name", _I)
GENERIC_RE = re.compile(r"\b(search|keyword|keywords|query|find|q)\b|search", _I)
SKIP_RE = re.compile(
    r"\b(email|password|newsletter|subscribe|phone|coupon|promo|login|sign\s*in|username|cookie"
    r"|cookies|vendor|consent|ot)\b|vendor|cookie", _I)


def _xq(v: str) -> str:
    if "'" in v:
        joined = "', \"'\", '".join(v.split("'"))
        return f"concat('{joined}')"
    return f"'{v}'"


def _attr(el: Any, name: str) -> str | None:
    v = el.get(name)
    if v is None:
        return None
    return " ".join(v) if isinstance(v, list) else str(v)


def find_search_inputs(html: str, page_url: str) -> list[dict]:
    """Search boxes on the page, with the kinds of value they take (from their own name and
    labels). Each: {kinds, label, inputXpath, submitXpath, form}."""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    out: list[dict] = []
    seen: set[str] = set()
    for e in soup.find_all("input"):
        typ = (_attr(e, "type") if _attr(e, "type") is not None else "text").lower()
        if typ not in ("text", "search", ""):
            continue
        id_ = _attr(e, "id") or ""
        name = _attr(e, "name") or ""
        label_for = ""
        if id_:
            lab = soup.find("label", attrs={"for": id_.replace('"', "")})
            label_for = lab.get_text() if lab else ""
        hint = " ".join([
            name, id_, _attr(e, "placeholder") or "", _attr(e, "aria-label") or "",
            _attr(e, "title") or "", label_for, _attr(e, "autocomplete") or "",
        ])
        hint = re.sub(r"([a-z])([A-Z])", r"\1 \2", hint)
        hint = re.sub(r"[_-]+", " ", hint).strip()
        if not hint or SKIP_RE.search(hint):
            continue
        kinds: list[str] = []
        if ZIP_RE.search(hint):
            kinds.append("zip")
        if CITY_RE.search(hint):
            kinds.append("city")
        if NAME_RE.search(hint):
            kinds.append("name")
        if not kinds and (GENERIC_RE.search(hint) or typ == "search"):
            kinds.extend(["city", "zip", "name"])
        if not kinds:
            continue
        placeholder = _attr(e, "placeholder")
        if id_:
            input_xpath = f"//input[@id={_xq(id_)}]"
        elif name:
            input_xpath = f"//input[@name={_xq(name)}]"
        elif placeholder:
            input_xpath = f"//input[@placeholder={_xq(placeholder)}]"
        else:
            input_xpath = ""
        if not input_xpath or input_xpath in seen:
            continue
        seen.add(input_xpath)
        form_el = e.find_parent("form")
        form: dict | None = None
        if form_el is not None:
            method = "POST" if (_attr(form_el, "method") or "get").upper() == "POST" else "GET"
            action = page_url
            act = try_url(_attr(form_el, "action") or page_url, page_url)
            if act:
                action = act.href
            fields: dict[str, str] = {}
            for h in form_el.find_all("input"):
                if (_attr(h, "type") or "") == "hidden" and _attr(h, "name") is not None:
                    fields[_attr(h, "name")] = _attr(h, "value") or ""
            if name and re.match(r"^https?:", action, _I):
                form = {"action": action, "method": method, "inputName": name, "fields": fields}
            fid = _attr(form_el, "id")
            form_xpath = f"//form[@id={_xq(fid)}]" if fid else None
            if form_xpath:
                submit_xpath = (
                    f"({form_xpath}//button[not(@type) or @type='submit'] | "
                    f"{form_xpath}//input[@type='submit'])[1]"
                )
            else:
                submit_xpath = (
                    f"({input_xpath}/ancestor::form[1]//button[not(@type) or @type='submit'] | "
                    f"{input_xpath}/ancestor::form[1]//input[@type='submit'])[1]"
                )
        else:
            submit_xpath = f"({input_xpath}/following::button[1])[1]"
        out.append({"kinds": kinds, "label": hint[:80], "inputXpath": input_xpath,
                    "submitXpath": submit_xpath, "form": form})

    # Fix (location boxes first, 2026-10-08): boxes that take a city or ZIP come before
    # name-only boxes; real forms first within each group.
    def rank(s: dict) -> int:
        loc = "zip" in s["kinds"] or "city" in s["kinds"]
        return (0 if loc else 2) + (0 if s["form"] else 1)

    return sorted(out, key=rank)[:4]


# ---- values tried while mapping ---------------------------------------------------------------
def search_values(
    kind: str,
    cities: list[dict],
    letters: list[str],
    bigrams: dict[str, str],
    min_len: int = 1,
) -> list[list[str]]:
    """Values for one search kind, most promising first; the caller tries the first two."""
    if kind == "zip":
        return [[c["zip"]] for c in cities if c.get("zip")]
    if kind == "city":
        return [[f"{c['city']}, {c['state']}", f"{c['city']} {c['state']}", c["city"]]
                for c in cities]
    # name prefixes: commonest last-name initials, extended to the commonest two-letter start.
    return [[ltr, bigrams.get(ltr, ltr)] if min_len <= 1 else [bigrams.get(ltr, ltr)]
            for ltr in letters]


def name_starts(last_names: list[str]) -> dict:
    """Initial and two-letter-start frequencies from a sample of last names (our own records):
    {letters, bigrams}."""
    l1: dict[str, int] = {}
    l2: dict[str, dict[str, int]] = {}
    for raw in last_names:
        n = re.sub(r"[^A-Za-z]", "", unicodedata.normalize("NFKD", raw))
        if len(n) < 2:
            continue
        a = n[0].upper()
        b = a + n[1].lower()
        l1[a] = l1.get(a, 0) + 1
        m = l2.setdefault(a, {})
        m[b] = m.get(b, 0) + 1
    letters = [k for k, _ in sorted(l1.items(), key=lambda kv: -kv[1])]
    bigrams = {a: max(m.items(), key=lambda kv: kv[1])[0] for a, m in l2.items()}
    return {"letters": letters, "bigrams": bigrams}
