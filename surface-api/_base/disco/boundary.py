"""Category boundary generation (port of `-disco-boundary.ts`, 2026-10-16), generic for any gcid.

A category boundary (`exp_category_boundary`: definition, includes, excludes, subtypes) tells
discovery what one profile of the category is and which neighbouring kinds belong to other
categories. `generate_category_boundary` writes one for a category that has none:

- grounded in our own category list: the model sees the category's name and type and the real
  categories whose names share a word with it; every "goes to" is resolved against
  gbp_categories by name, and a name that is not a real category is kept as "adjacent: <name>";
- generic: brand / company examples ("e.g. ...", "such as ...") are removed;
- checked: an empty or malformed answer is refused (nothing saved);
- never overwrites an authored boundary (source not starting with "generated"); regenerate
  replaces only a generated one. Saved with source "generated:<model>".

NOTE (governance): like the TS, this writes `exp_category_boundary` directly (insert/update),
not through `exp_category_proposals`.
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

BOUNDARY_TOOL: dict = {
    "name": "define_category_boundary",
    "description": (
        "Define what one profile of this category is, and which neighbouring kinds belong to "
        "other categories."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "definition": {
                "type": "string",
                "description": "One or two sentences: what one profile of this category is.",
            },
            "includes": {
                "type": "array", "items": {"type": "string"},
                "description": "2-6 kinds of profiles that belong to this category.",
            },
            "subtypes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"name": {"type": "string"}, "criteria": {"type": "string"}},
                    "required": ["name", "criteria"],
                },
                "description": "0-5 sub-types of profile, snake_case names, with how to tell them "
                "apart.",
            },
            "excludes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "description": "The kind of profile or site that is NOT this category.",
                        },
                        "goes_to": {
                            "type": "string",
                            "description": "Exact name of the category it belongs to, from the "
                            'RELATED CATEGORIES list, or "not a source".',
                        },
                    },
                    "required": ["type", "goes_to"],
                },
                "description": "3-12 neighbouring kinds that belong elsewhere.",
            },
        },
        "required": ["definition", "includes", "excludes"],
    },
}

STOP = {
    "service", "services", "agency", "company", "office", "shop", "store", "center", "centre",
    "and", "the", "of", "for", "a", "an", "association", "department", "school", "club",
}
_SUFFIX = re.compile(r"(ing|ants?|ents?|ers?|ors?|ists?|ies|es|s)\Z")


def _stem(w: str) -> str:
    return _SUFFIX.sub("", re.sub(r"[^a-z]", "", w.lower()), count=1)


def _tokens(s: str) -> list[str]:
    out = [_stem(x) for x in re.split(r"[\s/&,()-]+", s)]
    return [t for t in out if len(t) >= 3 and t not in STOP]


def _js_str(v: Any) -> str:
    """String(v) as JavaScript renders JSON-ish values."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, dict):
        return "[object Object]"
    if isinstance(v, list):
        return ",".join("" if x is None else _js_str(x) for x in v)
    return str(v)


def _s(v: Any) -> str:
    """String(v ?? '')."""
    return "" if v is None else _js_str(v)


# An "e.g. / such as / for example" part is removed only when it names something (a capitalised
# word); generic wording ("such as staff and senior accountants") is kept.
NAMES_SOMETHING = re.compile(r"(^|[\s,(])[A-Z][A-Za-z0-9&.'-]*[A-Za-z0-9]")
_PAREN_EX = re.compile(r"\((?:e\.g\.|eg\.?|for example|such as|like|including)([^)]*)\)", re.IGNORECASE)
_TAIL_EX = re.compile(r"([,;]?\s*(?:e\.g\.|for example|such as|including)\s)(.*)\Z", re.IGNORECASE)


def strip_examples(s: Any) -> str:
    """Remove brand / company examples so the boundary stays generic."""
    t = _s(s)
    t = _PAREN_EX.sub(lambda m: "" if NAMES_SOMETHING.search(m.group(1)) else m.group(0), t)
    t = _TAIL_EX.sub(
        lambda m: "" if NAMES_SOMETHING.search(m.group(2)) else m.group(0), t, count=1
    )
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\s+([,.;])", r"\1", t)
    return t.strip()


def as_list(v: Any) -> list:
    """The model sometimes sends a list as a JSON string or as lines; accept both."""
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        t = v.strip()
        if t.startswith("["):
            try:
                j = json.loads(t)
                if isinstance(j, list):
                    return j
            except ValueError:
                pass
        if t:
            parts = [re.sub(r"^[-*•]\s*", "", x).strip() for x in re.split(r"\n+|;\s*", t)]
            return [x for x in parts if x]
    return []


def _kind_of(v: Any) -> str:
    if isinstance(v, list):
        return f"list of {len(v)}"
    if v is None:
        return "nothing"
    if isinstance(v, str):
        return f"text ({len(v)} chars)"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int | float):
        return "number"
    return "object"


def _get(o: Any, k: str) -> Any:
    return o.get(k) if isinstance(o, dict) else None


def _fetchone(conn: Any, sql: str, params: tuple) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def _fetchall(conn: Any, sql: str, params: tuple) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def generate_category_boundary(
    conn: Any,
    model: str,
    gcid: str,
    ask: Callable[[str, dict], Any],
    *,
    regenerate: bool = False,
) -> dict:
    """Generate (and save) a boundary for gcid. Returns {boundary, saved, reason}.

    `conn` is a psycopg connection with write access (the TS used the service-role client);
    `ask(prompt, tool)` calls the model and returns the tool input dict.
    """
    existing = _fetchone(
        conn,
        "select definition, includes, excludes, subtypes, source from exp_category_boundary "
        "where gcid = %s",
        (gcid,),
    )
    existing_is_generated = bool(existing) and _s(existing.get("source")).startswith("generated")
    if existing and not existing_is_generated:
        return {"boundary": existing, "saved": False, "reason": "authored boundary kept"}
    if existing and not regenerate:
        return {"boundary": existing, "saved": False, "reason": "generated boundary already exists"}

    cat = _fetchone(
        conn, "select display_name, entity_type from gbp_categories where gcid = %s", (gcid,)
    )
    if not cat or not cat.get("display_name"):
        raise ValueError(f"unknown category {gcid}")
    all_rows = _fetchall(
        conn, "select gcid, display_name from gbp_categories where gcid <> %s limit 10000", (gcid,)
    )
    own = set(_tokens(cat["display_name"]))
    by_name: dict[str, str] = {}
    for c in all_rows:
        by_name[c["display_name"].lower()] = c["gcid"]
    related = [
        c["display_name"] for c in all_rows if any(t in own for t in _tokens(c["display_name"]))
    ][:80]
    gcids = {c["gcid"] for c in all_rows}

    unit = (
        "a single physical location (a place)"
        if cat.get("entity_type") == "location"
        else "an individual professional (a person)"
    )
    related_line = (
        "RELATED CATEGORIES (real categories in our list; use these exact names in goes_to):\n"
        + "; ".join(related)
        if related
        else "RELATED CATEGORIES: none found by name."
    )
    prompt = "\n".join([
        f"CATEGORY: {cat['display_name']} ({gcid})",
        f"ONE PROFILE IS: {unit}.",
        "",
        ("Define the boundary of this category for a US directory of profiles: what one profile is,"
        " what kinds of profiles belong"),
        ("to it, optional sub-types, and which neighbouring kinds of profiles or sites belong to"
        " OTHER categories."),
        "",
        related_line,
        "",
        "Rules:",
        ("- Be generic: describe kinds of professionals, places or sites. Never name a company,"
        " brand or website."),
        ("- goes_to must be an exact name from RELATED CATEGORIES, another real business category"
        ' name, or "not a source" (for software, tools,'),
        "  general marketplaces or sites that are not about this category).",
        ("- General multi-industry marketplaces and review sites are not sources of this category"
        " unless they have a dedicated section for it."),
        "- Keep each item short (one line).",
    ])

    out = ask(prompt, BOUNDARY_TOOL)
    definition = strip_examples(_s(_get(out, "definition")))
    includes = [strip_examples(_s(x)) for x in as_list(_get(out, "includes"))]
    includes = [x for x in includes if len(x) >= 3][:8]

    subtypes: list[dict] = []
    for s in as_list(_get(out, "subtypes")):
        name = re.sub(r"[^a-z0-9_]+", "_", _s(_get(s, "name")).strip().lower())
        name = re.sub(r"^_|_\Z", "", name)
        criteria = strip_examples(_s(_get(s, "criteria")))
        if name and criteria:
            subtypes.append({"name": name, "criteria": criteria})
    subtypes = subtypes[:6]

    excludes: list[dict] = []
    for e0 in as_list(_get(out, "excludes")):
        if isinstance(e0, str):  # a list item sent as text: "kind -> category" / "kind: category"
            m = re.split(r"\s*(?:→|->|=>|:)\s*", e0)
            e: Any = {"type": m[0], "goes_to": " ".join(m[1:])}
        else:
            e = e0
        typ = strip_examples(_s(_get(e, "type")))
        g = _s(_get(e, "goes_to")).strip()
        gl = re.sub(r"^gcid:", "", g.lower())
        gl_singular = re.sub(r"s\Z", "", gl)
        as_gcid = "gcid:" + re.sub(r"\s+", "_", gl)
        if not g or re.match(r"not a source", g, re.IGNORECASE):
            goes_to = "not a source"
        elif gl in by_name:
            goes_to = by_name[gl]
        elif gl_singular in by_name:
            goes_to = by_name[gl_singular]
        elif as_gcid in gcids:
            goes_to = as_gcid
        else:
            goes_to = f"adjacent: {g}"
        if len(typ) >= 3:
            excludes.append({"type": typ, "goes_to": goes_to})
    excludes = excludes[:12]

    problems: list[str] = []
    if len(definition) < 20:
        problems.append(
            f"definition {len(definition)} characters (received "
            f"{_kind_of(_get(out, 'definition'))})"
        )
    if len(definition) > 800:
        problems.append(f"definition too long ({len(definition)} characters)")
    if not includes:
        problems.append(f"includes empty (received {_kind_of(_get(out, 'includes'))})")
    if not excludes:
        problems.append(f"belongs-elsewhere empty (received {_kind_of(_get(out, 'excludes'))})")
    if problems:
        raise ValueError(f"boundary answer refused: {'; '.join(problems)}")

    boundary = {
        "definition": definition, "includes": includes, "excludes": excludes, "subtypes": subtypes,
    }
    source = f"generated:{model}"
    now = datetime.now(UTC)
    try:
        with conn.cursor() as cur:
            if existing:
                cur.execute(
                    "update exp_category_boundary set gcid = %s, definition = %s, includes = %s, "
                    "excludes = %s, subtypes = %s, source = %s, updated_at = %s "
                    "where gcid = %s and source like 'generated%%'",
                    (gcid, definition, Jsonb(includes), Jsonb(excludes), Jsonb(subtypes), source,
                     now, gcid),
                )
            else:
                cur.execute(
                    "insert into exp_category_boundary "
                    "(gcid, definition, includes, excludes, subtypes, source, updated_at) "
                    "values (%s, %s, %s, %s, %s, %s, %s)",
                    (gcid, definition, Jsonb(includes), Jsonb(excludes), Jsonb(subtypes), source,
                     now),
                )
    except psycopg.Error as err:
        raise RuntimeError(f"boundary save failed: {err}") from err
    return {
        "boundary": boundary, "saved": True,
        "reason": "regenerated" if existing else "generated",
    }
