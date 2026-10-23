"""§1 discover_companies — source discovery (DR-3, 2026-09-30), port of `disco-ai-worker.ts`.

The model returns WEBSITES that publish many individual profile pages for the category (brand
sites first, then directories), ranked by authority. Strict validation before anything reaches
the DB; the write itself is the governed `disco_discover_ingest` RPC (in the worker).
"""
from __future__ import annotations

import math
import re
from typing import Any

from etl.disco import ai_worker_util as u
from etl.disco.ai_worker_tools import (
    DISCOVER_BRAND_MAX,
    DISCOVER_DIRECTORY_MAX,
    DISCOVER_MAX_TOKENS,
    DISCOVER_REGISTRY_MAX,
    DISCOVER_SOURCE_TYPES,
    DISCOVER_TOOL,
)

DOMAIN_RE = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")
PLACEHOLDER_RE = re.compile(r"placeholder|lorem ipsum|\btbd\b|\bremoved\b", re.IGNORECASE)
# Names must be the organisation's name only (no notes about the do-not-repeat list).
NAME_COMMENT_RE = re.compile(
    r"\b(excluded|replaced|omitted|already (listed|found|included)|instead of)\b"
    r"|\balternatives?\s*($|[-/(),;:]|to\b)",
    re.IGNORECASE,
)


def normalize_domain(raw: str) -> str:
    s = raw.strip().lower()
    s = re.sub(r"^[a-z]+://", "", s)
    s = re.sub(r"^www\.", "", s)
    s = re.split(r"[/?#\s]", s)[0]
    return re.sub(r"\.$", "", s)


def is_source_domain(d: str) -> bool:
    return bool(DOMAIN_RE.match(d))


def clean_url(s: str) -> str:
    return re.sub(r"[\r\n\t]", "", s).strip()


def is_same_site(url: str, domain: str) -> bool:
    x = u.try_url(url)
    if not x:
        return False
    host = x.host.lower()
    d = domain.lower()
    return host == d or host.endswith("." + d)


def same_site_url(raw: Any, domain: str) -> str | None:
    """P0 (2026-10-05): a hint URL is kept only when it is a full http(s) URL on the source's
    own site (any subdomain). Anything else is dropped, never guessed."""
    s = clean_url("" if raw is None else u.js_str(raw))
    if not s:
        return None
    x = u.try_url(s)
    if not x or not re.match(r"^https?:$", x.protocol):
        return None
    return x.href if is_same_site(x.href, domain) else None


def load_category_terms(db: u.Db, gcid: str, unit: str) -> dict:
    """P0 (2026-10-05): taxonomy names and negative phrases for a category, read-only.
    Person categories use profession_title + alias; place categories alias + specialization.
    Empty lists on no rows or any error."""
    out: dict[str, list[str]] = {"terms": [], "negatives": []}
    if not gcid:
        return out
    try:
        levels = ["profession_title", "alias"] if unit == "person" else ["alias", "specialization"]
        rows = db.rows_or_none(
            "select level, term_display from exp_taxonomy "
            "where gcid = %s and is_active = true and level = any(%s)",
            (gcid, [*levels, "negative_keyword"]),
        )
        if rows is None:
            return out
        terms: dict[str, str] = {}
        negs: dict[str, str] = {}
        for row in rows:
            t = re.sub(r"\s+", " ", str(row.get("term_display") or "")).strip()
            if not t:
                continue
            key = re.sub(r"[®™]", "", t.lower())
            if row.get("level") == "negative_keyword":
                negs[key] = t
            elif key not in terms:
                terms[key] = t
        out["terms"] = list(terms.values())
        out["negatives"] = list(negs.values())
    except Exception:  # noqa: BLE001, S110  (enhancement only)
        pass
    return out


def build_discover_prompt(ctx: dict) -> str:
    person = ctx["unit"] == "person"
    pages = "profile pages" if person else "location pages"
    members = "profiles" if person else "locations"
    lines: list[str] = []
    lines.append(
        "You are finding data sources for a professional-profile graph."
        if person else "You are finding data sources for a local-business profile graph."
    )
    lines.append("")
    complexity = ctx.get("complexity")
    lines.append(
        f'CATEGORY: "{ctx["displayName"]}" [{ctx["category"]}]'
        + (f" ({complexity} complexity)" if complexity else "")
    )
    lines.append(
        "PROFILE UNIT: an individual person. One profile = one page about one professional, "
        "usually with their office and firm."
        if person else
        "PROFILE UNIT: a single physical location. One profile = one page about one place, with "
        "its address, hours and contact details."
    )
    b = ctx.get("boundary") or {}
    if isinstance(b, dict) and b.get("definition"):
        lines.extend(["", "WHAT ONE PROFILE LOOKS LIKE:", f"DEFINITION: {b['definition']}"])
        includes = "; ".join(u.js_str(x) for x in (b.get("includes") or []) if x)
        if includes:
            lines.append(f"INCLUDES: {includes}")
        subtypes = "; ".join(
            (f"{s['name']} ({s['criteria']})" if s.get("criteria") else u.js_str(s["name"]))
            for s in (b.get("subtypes") or []) if isinstance(s, dict) and s.get("name")
        )
        if subtypes:
            lines.append(f"PROFILE SUB-TYPES: {subtypes}")
        excludes = [e for e in (b.get("excludes") or []) if isinstance(e, dict) and e.get("type")]
        if excludes:
            lines.append(
                "THESE ARE NOT PROFILES OF THIS CATEGORY (they are separate categories), BUT THEIR "
                "WEBSITES ARE "
                f"VALID SOURCES IF THEY PUBLISH PAGES FOR THE {members.upper()} ABOVE:"
            )
            for e in excludes:
                goes = e.get("goes_to") if e.get("goes_to") is not None else "another category"
                lines.append(f"  • {e['type']} → {goes}  (can be a source)")
    # P0 (2026-10-05): category names and negative phrases from the taxonomy.
    terms = (ctx.get("terms") or [])[:20]
    if terms:
        lines.extend(["", f"ALSO CALLED: {'; '.join(terms)}"])
    negatives = (ctx.get("negatives") or [])[:15]
    if negatives:
        lines.append(
            f"NOT WHAT WE WANT (sites mainly about these are not sources): {'; '.join(negatives)}"
        )
    lines.append("")
    lines.append(
        f"TASK: list the real US websites that publish many individual {pages} for this category, "
        "in two groups:"
    )
    lines.append("")
    lines.append(
        f"GROUP 1 — BRAND SITES (up to {DISCOVER_BRAND_MAX}): firms, brokerages, franchisors and "
        'networks whose own website has a page per professional (e.g. a staff directory or "find '
        'a professional" search).'
        if person else
        f"GROUP 1 — BRAND SITES (up to {DISCOVER_BRAND_MAX}): chains, franchisors and "
        "multi-location groups whose own website has a page per location (e.g. a store or "
        "location finder)."
    )
    lines.append(
        f"GROUP 2 — DIRECTORIES (up to {DISCOVER_DIRECTORY_MAX}): portals, directories, review "
        "platforms, professional associations and licence registries that list professionals "
        "from many firms."
        if person else
        f"GROUP 2 — DIRECTORIES (up to {DISCOVER_DIRECTORY_MAX}): directories, portals, review "
        "platforms, industry associations and government registries (e.g. licensing or "
        "inspection lists) that list locations from many owners."
    )
    lines.append(
        "Registries are listed one per state or county with their real website domain; include "
        f"at most {DISCOVER_REGISTRY_MAX} registries, largest first, so other directories are not "
        "crowded out."
    )
    lines.append(
        "Where several sites belong to the same owner and show the same profiles, return only the "
        "main domain. "
        "Do not return a site owned by the same company as any site in the ALREADY FOUND list."
    )
    lines.append(
        "List category-focused directories first (sites built around this kind of "
        f"{'professional' if person else 'business'}). "
        "Include a general multi-industry directory only if it has a dedicated section for these "
        "profiles with substantial coverage, and rank it below the category-focused ones."
    )
    lines.append("Do not pad either group: return fewer sites than the maximum if fewer qualify.")
    lines.append("Do not return general search engines or map apps.")
    lines.append(
        f"Return sites whose {members} mainly belong to this category; sites whose {members} "
        "mainly belong to a narrower or different category are found under that category."
    )
    lines.append("")
    lines.append(
        "NOT A SOURCE: a website about a single person or a single small team (personal sites, "
        "single-professional pages). Do not return these."
        if person else
        "NOT A SOURCE: a website for a single location (e.g. an independent business's own "
        "site). Do not return these; directories cover them."
    )
    if ctx["excludeDomains"]:
        lines.append("")
        lines.append(
            "ALREADY FOUND — do NOT repeat these domains; return only sites not in this list:"
        )
        lines.append(", ".join(ctx["excludeDomains"]))
    lines.append("")
    lines.append(
        "RANK within each group by authority: market share, size, brand strength and the number "
        f"of individual {pages} the site publishes."
    )
    lines.append("")
    lines.append(
        "For each site return: name (the organisation's official name only — no comments, "
        "alternatives or notes about other sites); "
        "official primary domain only (no marketing subdomains, no guesses); group; "
        "source_type (brand_site for group 1; portal | directory | review_platform | association "
        "| license_registry for group 2); "
        "authority_rank (1 = strongest in its group); profiles_hosted_estimate; evidence (why it "
        "ranks here, including the page count)."
    )
    lines.append(
        f"Optional, only when you know them: directory_url (the page on that site that lists or "
        f"searches its {members}) and "
        f"profile_url_example (one real {'profile' if person else 'location'} page URL on that "
        "site). Leave them empty rather than guess."
    )
    lines.append("")
    lines.append("Only include sites you are confident are real. Use the return_top_sources tool.")
    return "\n".join(lines)


def validate_discovered_sources(raw: Any, exclude: set[str]) -> dict:
    """Strict validation: invalid entries are counted (they trigger one retry); repeats of
    already-seen domains are silently skipped. Returns {sources, rejected}."""
    brands: list[dict] = []
    dirs: list[dict] = []
    seen: set[str] = set()
    rejected = 0
    for r in raw if isinstance(raw, list) else []:
        r = r if isinstance(r, dict) else {}
        name = u.js_str(r.get("name") if r.get("name") is not None else "").strip()
        domain = normalize_domain(u.js_str(r.get("domain") if r.get("domain") is not None else ""))
        group = r.get("group")
        st = r.get("source_type")
        est = u.num(r.get("profiles_hosted_estimate"))
        rank = u.num(r.get("authority_rank"))
        evidence = u.js_str(r.get("evidence") if r.get("evidence") is not None else "").strip()
        if group == "brand_site":
            type_ok = st == "brand_site"
        else:
            type_ok = group == "directory" and st != "brand_site" and st in DISCOVER_SOURCE_TYPES
        if (
            not name or not is_source_domain(domain) or not type_ok or not math.isfinite(est)
            or est <= 0 or PLACEHOLDER_RE.search(name) or NAME_COMMENT_RE.search(name)
            or PLACEHOLDER_RE.search(evidence)
        ):
            rejected += 1
            continue
        if domain in exclude or domain in seen:
            continue
        seen.add(domain)
        s: dict[str, Any] = {
            "name": name,
            "domain": domain,
            "group": group,
            "source_type": st,
            "authority_rank": 0,
            "group_rank": u.js_round(rank) if math.isfinite(rank) and rank > 0 else 999,
            "profiles_hosted_estimate": u.js_round(est),
            "evidence": evidence,
        }
        # P0: optional hints — kept only when they are URLs on this source's own site.
        dir_url = same_site_url(r.get("directory_url"), domain)
        prof_url = same_site_url(r.get("profile_url_example"), domain)
        if dir_url:
            s["directory_url"] = dir_url
        if prof_url:
            s["profile_url_example"] = prof_url
        (brands if group == "brand_site" else dirs).append(s)
    registries = 0
    directories: list[dict] = []
    for s in sorted(dirs, key=lambda x: x["group_rank"]):
        if s["source_type"] == "license_registry":
            registries += 1
            if registries > DISCOVER_REGISTRY_MAX:
                continue
        directories.append(s)
    picked = [
        *sorted(brands, key=lambda x: x["group_rank"])[:DISCOVER_BRAND_MAX],
        *directories[:DISCOVER_DIRECTORY_MAX],
    ]
    sources = [{**s, "authority_rank": i + 1} for i, s in enumerate(picked)]
    return {"sources": sources, "rejected": rejected}


def load_discover_context(
    db: u.Db, category: str, complexity: str | None, boundary: dict | None
) -> dict:
    """Read-only context: category unit and name, plus every domain already seen for this
    category (existing sources and every earlier proposal) so a rerun only returns new sites."""
    try:
        cat = db.row(
            "select display_name, entity_type from gbp_categories where gcid = %s", (category,)
        )
    except Exception as e:
        raise RuntimeError(f"gbp_categories read failed: {e}") from e
    seen: set[str] = set()
    try:
        srcs = db.rows("select source_domain from exp_etl_sources where gcid = %s", (category,))
    except Exception as e:
        raise RuntimeError(f"exp_etl_sources read failed: {e}") from e
    for s in srcs:
        d = normalize_domain(u.js_str(s.get("source_domain") or ""))
        if is_source_domain(d):
            seen.add(d)
    try:
        props = db.rows(
            "select payload from disco_proposals where category_slug = %s and kind = %s",
            (category, "company_list"),
        )
    except Exception as e:
        raise RuntimeError(f"disco_proposals read failed: {e}") from e
    for p in props:
        payload = p.get("payload") if isinstance(p.get("payload"), dict) else {}
        companies = payload.get("companies") if isinstance(payload, dict) else None
        for c in companies if isinstance(companies, list) else []:
            dv = c.get("domain") if isinstance(c, dict) else None
            d = normalize_domain(u.js_str(dv if dv is not None else ""))
            if is_source_domain(d):
                seen.add(d)
    unit = "place" if (cat or {}).get("entity_type") == "location" else "person"
    terms = load_category_terms(db, category, unit)
    display = (cat or {}).get("display_name") or re.sub(
        r"_", " ", re.sub(r"^gcid:", "", category)
    )
    return {
        "category": category,
        "displayName": display,
        "unit": unit,
        "complexity": complexity,
        "boundary": boundary,
        "excludeDomains": sorted(seen),
        "terms": terms["terms"],
        "negatives": terms["negatives"],
    }


def discover_sources(api_key: str, model: str, ctx: dict) -> list[dict]:
    """One retry when the answer is empty or has a noticeable share of broken entries."""
    prompt = build_discover_prompt(ctx)
    exclude = set(ctx["excludeDomains"])
    best: dict | None = None
    for _attempt in (1, 2):
        inp = u.call_claude(api_key, model, prompt, DISCOVER_TOOL, DISCOVER_MAX_TOKENS)
        result = validate_discovered_sources((inp or {}).get("sources"), exclude)
        if not best or len(result["sources"]) > len(best["sources"]):
            best = result
        broken = (
            len(result["sources"]) == 0
            or result["rejected"] > max(2, len(result["sources"]) * 0.2)
        )
        if not broken:
            break
    if not best or not best["sources"]:
        raise RuntimeError("no valid sources in model output")
    return best["sources"]
