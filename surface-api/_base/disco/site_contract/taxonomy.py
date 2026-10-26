"""Taxonomy layer (category registry keys, ids 'tax.<node_slug>'), static routes, prompt HTML,
the C9 brand pass and C10 sticky rules."""

from __future__ import annotations

import copy
import re
from typing import Any

from bs4 import Comment

from . import _dom
from ._js import iso_now, js_number, js_str, json_stringify, trim
from .apply import (
    _res,
    apply_locator,
    apply_site_contract,
    classify_credential,
    classify_same_as,
    ctx_for,
    find_label_el,
)
from .doc import doc_of, sample_get
from .keys import (
    EXTRA_PREFIX,
    TAX_PREFIX,
    all_field_ids,
    field_type,
    is_alias,
    is_classifier,
    is_derived,
    is_empty_value,
    is_identity_id,
    is_tax_id,
    key_of,
)
from .learn import (
    ADDRESS_PARTS,
    ORGANIZATION_TYPES,
    clashes,
    clashes_tax,
    group_geo_rules,
    is_org_type,
    locator_targets_chrome,
    rule_to_locator,
)
from .opts import kwargs_of, norm_opts
from .values import is_value_anchored, norm_val, validate_value

__all__ = ["ORGANIZATION_TYPES"]


def filter_taxonomy_rows(rows: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Keys a firm's own profile page could show: website-lane or unowned, never Question."""
    return [
        r for r in (rows or [])
        if r and isinstance(r.get("node_slug"), str) and r["node_slug"]
        and not (r.get("owns_lane") and r.get("owns_lane") != "website")
        and r.get("schema_type") != "Question"
    ]


TAX_TYPE_BY_PROP = {
    "telephone": "phone", "faxnumber": "phone", "email": "email",
    "url": "url", "sameas": "url", "image": "url", "logo": "url", "photo": "url",
    "potentialaction": "url", "address": "address", "geo": "geo",
    "hascredential": "list", "knowsabout": "list", "knowslanguage": "list", "award": "list",
    "memberof": "list", "alumniof": "list", "areaserved": "list", "hasoffercatalog": "list",
    "makesoffer": "list", "review": "list",
    # C13: multi-valued by schema_property last segment.
    "jobtitle": "list", "affiliation": "list", "availablelanguage": "list", "servicetype": "list",
    "employee": "list", "openinghours": "list", "openinghoursspecification": "list",
    "ratingvalue": "number", "reviewcount": "number", "numberofemployees": "number",
    "foundingdate": "year",
}


def _last_seg(p: str | None) -> str:
    segs = [x for x in (p or "").split(".") if x]
    return segs[-1] if segs else ""


def taxonomy_type(schema_property: str | None) -> str:
    if not schema_property:
        return "text"
    return TAX_TYPE_BY_PROP.get(_last_seg(schema_property).lower(), "text")


def taxonomy_subjects(scope: str | None, primary: str, schema_type: str | None = None
                      ) -> list[str]:
    """Fix 11: subject from schema_type first; entity_scope only when schema_type is null."""
    st = trim(schema_type) if schema_type else ""
    if st:
        if st.lower() == "person":
            return ["location" if primary == "location" else "person"]
        if is_org_type(st):
            return ["firm"]
        # Fix 18: a location-typed key reads location objects only.
        return ["location"]
    if scope == "professional":
        return ["location" if primary == "location" else "person"]
    if scope == "location":
        return ["location"]
    if scope == "brand":
        return ["firm"]
    return ["person", "location", "firm"] if primary == "person" else ["location", "firm"]


SCALAR_PROPS = {
    "name", "jobtitle", "telephone", "faxnumber", "email", "address", "streetaddress",
    "addresslocality", "addressregion", "postalcode", "addresscountry", "url", "image", "logo",
    "photo", "description", "legalname", "alternatename", "foundingdate", "ratingvalue",
    "reviewcount", "numberofemployees", "pricerange", "latitude", "longitude", "geo",
    "birthdate", "gender", "givenname", "familyname",
}
ITEM_STOPWORDS = {
    "advisor", "professional", "firm", "company", "business", "profile", "page", "url", "link",
    "name", "listing", "list", "award", "recognition", "ranking", "certification", "credential",
    "license", "designation", "number", "status", "service", "info", "details", "the", "and",
    "for", "with",
}


def _prop_tokens(prop: str) -> list[str]:
    t = re.sub(r"([a-z])([A-Z])", r"\1 \2", prop).lower()
    return [x for x in re.split(r"[^a-z0-9]+", t) if x] + [prop.lower()]


def distinctive_words(slug: str, name: str, prop: str) -> list[str]:
    stop = ITEM_STOPWORDS | set(_prop_tokens(prop))
    toks = [t for t in re.split(r"[^a-z0-9]+", f"{slug} {name}".lower())
            if len(t) >= 3 and t not in stop]
    return list(dict.fromkeys(toks))


def resolve_taxonomy_keys(rows: list[dict[str, Any]], primary: str) -> list[dict[str, Any]]:
    rows_f = filter_taxonomy_rows(rows)
    prop_use: dict[str, set[str]] = {}
    for r in rows_f:
        last = trim(_last_seg(r.get("schema_property"))).lower()
        if not last:
            continue
        prop_use.setdefault(last, set()).add(r["node_slug"])
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows_f:
        if r["node_slug"] in seen:
            continue
        seen.add(r["node_slug"])
        sp = r.get("schema_property")
        prop = trim(sp) if isinstance(sp, str) and trim(sp) else None
        last = trim(_last_seg(prop))
        last_l = last.lower()
        node_name = js_str(r["node_name"] if r.get("node_name") is not None else r["node_slug"])
        st = r.get("schema_type")
        k: dict[str, Any] = {
            "slug": r["node_slug"],
            "id": TAX_PREFIX + r["node_slug"],
            "type": taxonomy_type(prop),
            "subjects": taxonomy_subjects(r.get("entity_scope"), primary, st),
            "scope": r.get("entity_scope"),
            "path": [x for x in prop.split(".") if x] if prop else None,
            "schema_type": trim(st) if isinstance(st, str) and trim(st) else None,
            "node_name": node_name,
            "node_description": js_str(r.get("node_description") or ""),
            "prop_last": last_l,
        }
        if r.get("node_description") is None:
            k["node_description"] = ""
        if last_l == "potentialaction":
            k["action"] = True
        match_text = f"{r['node_slug']} {node_name}"
        if last_l in ("sameas", "hascredential"):
            # Fix 12a/b: recognized -> classifier; unrecognized -> no JSON-LD path read.
            kind = "sameas" if last_l == "sameas" else "credential"
            r0 = classify_same_as(match_text, []) if kind == "sameas" \
                else classify_credential(match_text, [])
            if _res(r0, "recognized"):
                label = _res(r0, "platform") if kind == "sameas" else (_res(r0, "label") or "")
                k["classifier"] = {"kind": kind, "label": label, "match_text": match_text}
                k["type"] = "url" if kind == "sameas" else "text"
            k["path"] = None
        elif last_l and last_l not in SCALAR_PROPS and len(prop_use.get(last_l, ())) >= 2:
            k["item_words"] = distinctive_words(r["node_slug"], node_name, last)
        out.append(k)
    return out


def taxonomy_types(keys: list[dict[str, Any]]) -> dict[str, str]:
    """Map of 'tax.<slug>' -> value type, for merge_css_rules."""
    return {k["id"]: k["type"] for k in keys}


def taxonomy_item_words(keys: list[dict[str, Any]]) -> dict[str, list[str]]:
    return {k["id"]: k["item_words"] for k in keys if k.get("item_words") is not None}


def default_role_of(k: dict[str, Any]) -> str:
    """C1: default subject label for the prompt (location shown as branch)."""
    subs = k.get("subjects") or []
    s = subs[0] if subs else "location"
    return "branch" if s == "location" else s


def taxonomy_role_lines(keys: list[dict[str, Any]]) -> str:
    return "\n".join(f"{k['id']} [default: {default_role_of(k)}] {k['node_name']}" for k in keys)


def apply_taxonomy_roles(keys: list[dict[str, Any]], raw_roles: Any, primary: str
                         ) -> dict[str, Any]:
    """C1: apply locator-assigned roles; returns ``{keys, roles, ownPageKey, changed}``."""
    by_id = {k["id"]: k for k in keys}
    roles: dict[str, str] = {}
    changed: list[str] = []
    nxt = {k["id"]: k for k in keys}
    own_page_key: str | None = None

    def to_subject(r: str) -> str | None:
        if r == "person":
            return "location" if primary == "location" else "person"
        return {"branch": "location", "firm": "firm"}.get(r)

    lst = raw_roles if isinstance(raw_roles, list) else []
    for item in lst:
        item = item if isinstance(item, dict) else {}
        fid = trim(item["id"]) if isinstance(item.get("id"), str) else ""
        role = trim(item["role"]) if isinstance(item.get("role"), str) else ""
        k = by_id.get(fid)
        if not k:
            continue
        if role == "own_page_url":
            continue
        s = to_subject(role)
        if not s:
            continue
        if len(k["subjects"]) == 1 and k["subjects"][0] == s:
            continue
        nxt[fid] = {**k, "subjects": [s]}
        roles[k["slug"]] = role
        changed.append(fid)
    for item in lst:
        if own_page_key:
            break
        item = item if isinstance(item, dict) else {}
        fid = trim(item["id"]) if isinstance(item.get("id"), str) else ""
        if item.get("role") != "own_page_url":
            continue
        k = nxt.get(fid)
        if not k or k["type"] != "url" or k["subjects"][0] == "firm":
            continue
        own_page_key = k["slug"]
        roles[k["slug"]] = "own_page_url"
    return {"keys": [nxt[k["id"]] for k in keys], "roles": roles, "ownPageKey": own_page_key,
            "changed": changed}


def taxonomy_subject_map(keys: list[dict[str, Any]]) -> dict[str, str]:
    return {k["id"]: k["subjects"][0] if k.get("subjects") else None for k in keys}


def taxonomy_logo_ids(keys: list[dict[str, Any]]) -> set[str]:
    return {k["id"] for k in keys if k.get("prop_last") == "logo"}


def taxonomy_action_ids(keys: list[dict[str, Any]]) -> set[str]:
    return {k["id"] for k in keys if k.get("action")}


ALIAS_BY_PROP: dict[str, dict[str, str]] = {
    "name": {"person": "person.name", "location": "location.business_name",
             "firm": "firm.firm_name"},
    "telephone": {"person": "person.phone", "location": "location.phone",
                  "firm": "firm.phone_main"},
    "email": {"person": "person.email", "location": "location.email"},
    "url": {"location": "location.website", "firm": "firm.website"},
    "logo": {"location": "location.logo_url", "firm": "firm.logo_url"},
    "image": {"person": "person.photo_url"},
}
CONTACT_FALLBACK_PROPS = {"telephone", "email"}


def add_taxonomy_aliases(fields: dict[str, Any], keys: list[dict[str, Any]]) -> dict[str, Any]:
    """C1/C10: give taxonomy keys without a locator an alias to a matching universal field."""
    out = dict(fields)

    def has(fid: str | None) -> bool:
        return bool(fid) and bool(out.get(fid)) and (out[fid].get("hits") or 0) >= 1

    for k in keys:
        if out.get(k["id"]):
            continue
        path = k.get("path")
        last = (path[-1] if path else (k.get("prop_last") or "")).lower()
        subj = k["subjects"][0] if k.get("subjects") else None
        frm = ALIAS_BY_PROP.get(last, {}).get(subj)
        if not has(frm) and last in CONTACT_FALLBACK_PROPS and subj in ("location", "person"):
            other = ALIAS_BY_PROP.get(last, {}).get("person" if subj == "location" else "location")
            if has(other):
                frm = other
        if not frm or not has(frm):
            continue
        src = out[frm]
        out[k["id"]] = {"tier": "alias", "locator": {"tier": "alias", "from": frm},
                        "type": k["type"], "hits": src.get("hits"), "samples": src.get("samples")}
    return out


# ---------------------------------------------------------------------------
# Staging schema step 2: contract routes (taxonomy -> static, extra -> static)
# ---------------------------------------------------------------------------
ROUTE_HELPER_TARGETS = {"person.years_experience", "person.licenses", "person.registration_ids"}


def is_route_target(fid: str) -> bool:
    return is_identity_id(fid) or fid in ROUTE_HELPER_TARGETS


def is_mergeable_id(fid: str) -> bool:
    """List ids merge every source; actions have their own merge."""
    return field_type(fid) == "list" and key_of(fid) != "actions" and is_route_target(fid)


ADDRESS_PROPS: dict[str, list[str]] = {
    "street": ["address.streetaddress", "streetaddress"],
    "city": ["address.addresslocality", "addresslocality"],
    "state": ["address.addressregion", "addressregion"],
    "postal_code": ["address.postalcode", "postalcode"],
}
STATIC_ROUTE_PROPS: dict[str, dict[str, list[str]]] = {
    "person": {
        "name": ["name"], "first_name": ["givenname"], "last_name": ["familyname"],
        "job_title": ["jobtitle"], "bio": ["description"], "photo_url": ["image", "photo"],
        "gallery": ["image", "photo"], "phone": ["telephone"], "fax": ["faxnumber"],
        "email": ["email"], "languages": ["knowslanguage"],
        "services": ["makesoffer", "hasoffercatalog", "servicetype"],
        "specialties": ["knowsabout"], "service_areas": ["areaserved"], "awards": ["award"],
        "education": ["alumniof"], **ADDRESS_PROPS,
    },
    "location": {
        "business_name": ["name"], "phone": ["telephone"], "fax": ["faxnumber"],
        "email": ["email"], "website": ["url"], "description": ["description"],
        "logo_url": ["logo"], "photo_url": ["image", "photo"], "gallery": ["image", "photo"],
        "hours": ["openinghours", "openinghoursspecification"],
        "latitude": ["geo.latitude", "latitude"], "longitude": ["geo.longitude", "longitude"],
        **ADDRESS_PROPS,
    },
    "firm": {
        "firm_name": ["name"], "legal_name": ["legalname"], "website": ["url"],
        "logo_url": ["logo"], "phone_main": ["telephone"], "fax": ["faxnumber"],
        "email": ["email"], "description": ["description"], **ADDRESS_PROPS,
    },
}


def static_target_for_key(key: str, open_ids: set[str], primary: str) -> str | None:
    """Static id an extra key names directly ('services', 'person_services'), when open."""
    m = re.match(r"^(person|location|firm)_(.+)$", key)
    if m:
        order = [m.group(1)]
    else:
        order = ["person", "location", "firm"] if primary == "person" else ["location", "firm"]
    k = m.group(2) if m else key
    for s in order:
        if f"{s}.{k}" in open_ids:
            return f"{s}.{k}"
    return None


def build_static_routes(args: dict[str, Any] | None = None, /, **kw: Any) -> dict[str, Any]:
    """Builds contract.static_routes for static ids that have no page rule.

    Arguments: fields, taxonomy_fields, tax_keys, primary, extra_fields, extra_candidates,
    extra_values, sample_urls. Returns ``{routes, dropped}``.
    """
    a = kwargs_of(args, kw)
    primary = a["primary"]
    fields = a.get("fields") or {}
    taxonomy_fields = a.get("taxonomy_fields") or {}
    extra_fields = a.get("extra_fields") or {}
    extra_values = a.get("extra_values") or []
    sample_urls = a.get("sample_urls") or []
    routes: dict[str, list[dict[str, Any]]] = {}

    def add(sid: str, r: dict[str, Any]) -> None:
        routes.setdefault(sid, []).append(r)

    dropped: list[dict[str, Any]] = []
    all_ids_list = all_field_ids(primary)
    open_ = {fid for fid in all_ids_list if is_route_target(fid) and not fields.get(fid)}

    def routable(sid: str) -> bool:
        return sid in open_ or is_mergeable_id(sid)

    key_by_id = {k["id"]: k for k in (a.get("tax_keys") or [])}

    # (a0) action keys of a subject all feed <subject>.actions (merged list).
    all_ids = set(all_ids_list)
    for slug, spec in taxonomy_fields.items():
        fid = TAX_PREFIX + slug
        k = key_by_id.get(fid)
        if not k or not k.get("action") or is_alias(spec.get("locator")) \
                or is_classifier(spec.get("locator")):
            continue
        sid = f"{spec.get('subject')}.actions"
        if sid not in all_ids:
            continue
        r = (routes.get(sid) or [None])[0]
        if r and r.get("kind") == "taxonomy":
            r["from"].append(fid)
        else:
            add(sid, {"kind": "taxonomy", "from": [fid], "merge": True})

    # (a) taxonomy -> static
    by_source: dict[str, list[dict[str, Any]]] = {}
    for slug, spec in taxonomy_fields.items():
        fid = TAX_PREFIX + slug
        k = key_by_id.get(fid)
        if (not k or not k.get("path") or k.get("action") or is_alias(spec.get("locator"))
                or is_classifier(spec.get("locator")) or k.get("classifier")
                or k.get("item_words") is not None):
            continue
        prop = ".".join(k["path"]).lower()
        subject = spec.get("subject")
        props = STATIC_ROUTE_PROPS.get(subject, {})
        collection = bool(re.search(r"(gallery|galleries|photos|images|library|album|collection)",
                                    slug, re.IGNORECASE))
        for key, lst in props.items():
            sid = f"{subject}.{key}"
            if (key == "gallery" and not collection) or (key == "photo_url" and collection):
                continue
            if routable(sid) and prop in lst:
                by_source.setdefault(sid, []).append({"id": fid})
        if k.get("type") == "geo" and subject == "location":
            for part in ("latitude", "longitude"):
                sid = f"location.{part}"
                if sid in open_:
                    by_source.setdefault(sid, []).append({"id": fid, "part": part})
        if k.get("type") == "address":
            for part in ADDRESS_PARTS:
                sid = f"{subject}.{part}"
                if sid in open_:
                    by_source.setdefault(sid, []).append({"id": fid, "part": part})
    for sid, srcs in by_source.items():
        direct = [x for x in srcs if not x.get("part")]
        use = direct or srcs
        parts = {x.get("part") or "" for x in use}
        if len(parts) > 1:
            dropped.append({"static_id": sid, "from": ",".join(x["id"] for x in use),
                            "reason": "mixed_parts"})
            continue
        part = use[0].get("part")
        route: dict[str, Any] = {"kind": "taxonomy",
                                 "from": list(dict.fromkeys(x["id"] for x in use))}
        if part:
            route["part"] = part
        if is_mergeable_id(sid):
            route["merge"] = True
        add(sid, route)

    # (b) extra -> static
    used_targets: set[str] = set()
    rank = {"sticky": 0, "name": 1, "match": 2}
    order = sorted((a.get("extra_candidates") or {}).items(),
                   key=lambda kv: rank.get(kv[1].get("source"), 3))
    for key, c in order:
        sid = c.get("static_id")
        frm = EXTRA_PREFIX + key
        if not is_route_target(sid) or sid not in all_ids_list:
            dropped.append({"static_id": sid, "from": frm, "reason": "not_a_static_id"})
            continue
        if not routable(sid):
            dropped.append({"static_id": sid, "from": frm, "reason": "static_has_page_rule"})
            continue
        if not is_mergeable_id(sid) and sid in used_targets:
            dropped.append({"static_id": sid, "from": frm, "reason": "static_already_routed"})
            continue
        if extra_fields.get(key) is None:
            dropped.append({"static_id": sid, "from": frm, "reason": "extra_not_kept"})
            continue
        type_ = field_type(sid)
        if not type_:
            dropped.append({"static_id": sid, "from": frm, "reason": "not_a_static_id"})
            continue
        found = 0
        bad = 0
        for i, vals in enumerate(extra_values):
            v = (vals or {}).get(key)
            if v is None or is_empty_value(v):
                continue
            found += 1
            ok = validate_value(type_, v, sample_urls[i] if i < len(sample_urls) else "", sid)
            if ok is None or is_empty_value(ok):
                bad += 1
        if found < 2:
            dropped.append({"static_id": sid, "from": frm, "reason": "low_support"})
            continue
        if sid.startswith("firm.") and not is_mergeable_id(sid):
            distinct = {norm_val((vals or {}).get(key)) for vals in extra_values
                        if (vals or {}).get(key) is not None
                        and not is_empty_value((vals or {}).get(key))}
            if len(distinct) > 1:
                dropped.append({"static_id": sid, "from": frm, "reason": "differs_across_pages"})
                continue
        if bad > 0:
            dropped.append({"static_id": sid, "from": frm,
                            "reason": f"type_check_failed_{bad}_of_{found}"})
            continue
        used_targets.add(sid)
        route = {"kind": "extra", "from": key, "source": c.get("source")}
        if c.get("reason"):
            route["reason"] = str(c["reason"])[:300]
        add(sid, route)
    return {"routes": routes, "dropped": dropped[:40]}


def taxonomy_prompt_lines(keys: list[dict[str, Any]]) -> str:
    lines = []
    for k in keys:
        spec = " (specific item only — not the whole list)" if k.get("item_words") is not None \
            else ""
        desc = trim(re.sub(r"\s+", " ", k.get("node_description") or ""))[:120]
        lines.append(f"{k['id']} ({k['type']}) [default: {default_role_of(k)}]{spec} — "
                     f"{k['node_name']}: {desc}")
    return "\n".join(lines)


def build_taxonomy_json_ld_fields(
    fields: dict[str, Any],
    keys: list[dict[str, Any]],
    samples: list[Any],
    site_entity_names: set[str],
    opts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """JSON-LD tier for taxonomy keys (classifier keys always get a classifier spec)."""
    out = dict(fields)
    universal = {fid: f for fid, f in fields.items() if not is_tax_id(fid)}
    ctxs = [
        ctx_for(doc_of(s), sample_get(s, "url") or "", site_entity_names, opts).with_values(
            apply_site_contract(doc_of(s), sample_get(s, "url") or "", {"fields": universal},
                                site_entity_names, opts)["values"])
        for s in samples
    ]
    for k in keys:
        if k.get("classifier"):
            c = k["classifier"]
            locator = {"tier": "classifier", "classifier": c["kind"], "label": c["label"],
                       "match_text": c["match_text"]}
            hits = sum(1 for cx in ctxs if apply_locator(locator, k["type"], k["id"], cx)
                       is not None)
            out[k["id"]] = {"tier": "classifier", "locator": locator, "type": k["type"],
                            "hits": hits, "samples": len(samples)}
            continue
        iw = k.get("item_words")
        if not k.get("path") or (iw is not None and len(iw) == 0):
            continue
        for subject in k.get("subjects") or []:
            locator: dict[str, Any] = {
                "tier": "jsonld", "subject": subject,
                "types": [k["schema_type"]] if k.get("schema_type") else [], "path": k["path"],
            }
            if k.get("schema_type"):
                locator["prefer"] = [k["schema_type"]]
            if iw is not None:
                locator["item_words"] = iw
            hits = sum(1 for cx in ctxs if apply_locator(locator, k["type"], k["id"], cx)
                       is not None)
            if hits > 0:
                out[k["id"]] = {"tier": "jsonld", "locator": locator, "type": k["type"],
                                "hits": hits, "samples": len(samples)}
                break
            if iw is not None:
                plain = {kk: v for kk, v in locator.items() if kk != "item_words"}
                if any(apply_locator(plain, k["type"], k["id"], cx) is not None for cx in ctxs):
                    k["ambiguous_seen"] = True
    return out


def taxonomy_locator_ids(fields: dict[str, Any], keys: list[dict[str, Any]]) -> list[str]:
    """Taxonomy ids the locator should be asked for."""
    return [k["id"] for k in keys
            if not fields.get(k["id"]) and not k.get("classifier")
            and not (k.get("item_words") is not None and len(k["item_words"]) == 0)]


# ---------------------------------------------------------------------------
# Prompt HTML
# ---------------------------------------------------------------------------
_PROMPT_KEEP = ("id", "class", "itemprop", "itemtype", "href", "src", "content")


def _prepare(input_: Any) -> Any:
    if isinstance(input_, str):
        return _dom.parse_html(input_ or "")
    d = doc_of(input_)
    if d.soup is not None:
        return copy.copy(d.soup)
    return _dom.parse_html(sample_get(input_, "html") or "")


def _strip_noise(soup: Any) -> None:
    for el in _dom.select(soup, "script,style,svg,noscript"):
        el.extract()
    for c in soup.find_all(string=lambda s: isinstance(s, Comment)):
        c.extract()


def _keep_attrs(el: Any, keep: tuple[str, ...]) -> None:
    for name in list(_dom.attrs(el).keys()):
        if not (name in keep or name.startswith(("data-", "aria-"))):
            del el.attrs[name]


def clean_html_for_prompt(input_: Any, cap: int = 30_000) -> str:
    """Cleaned markup for the locator prompt (Fix 1): chrome removed, profile root kept."""
    html = input_ if isinstance(input_, str) else (sample_get(input_, "html") or "")
    try:
        soup = _prepare(input_)
        _strip_noise(soup)
        h1 = _dom.select_first(soup, "h1")

        def holds_h1(el: Any) -> bool:
            return h1 is not None and (el is h1 or _dom.contains(el, h1))

        chrome: list[Any] = []
        for el in _dom.select(soup, "header,nav,footer,aside,[role=banner],[role=navigation],"
                                    "[role=contentinfo],[role=search]"):
            if not holds_h1(el):
                chrome.append(el)
        for el in _dom.select(soup, "[id],[class]"):
            if _dom.is_chrome_by_name(el) and not holds_h1(el):
                chrome.append(el)
        for el in chrome:
            el.extract()

        def text_len(el: Any) -> int:
            return len(trim(re.sub(r"\s+", " ", _dom.text(el))))

        root = None
        for el in _dom.select(soup, "main,[role=main]"):
            if root is None and text_len(el) > 0:
                root = el
        if root is None and h1 is not None:
            cur = h1.parent
            while cur is not None and _dom.is_tag(cur):
                if text_len(cur) >= 1500:
                    root = cur
                    break
                cur = cur.parent
        if root is None:
            root = _dom.select_first(soup, "body")
        for el in list(_dom.iter_tags(soup)):
            _keep_attrs(el, _PROMPT_KEEP)
        out = str(root) if root is not None else str(soup)
        if h1 is not None and root is not None and not holds_h1(root):
            out = str(h1) + out
        return trim(re.sub(r"\s+", " ", out))[:cap]
    except Exception:  # noqa: BLE001 — TS catch-all
        return re.sub(r"\s+", " ", js_str(html or ""))[:cap]


def chrome_html_for_prompt(input_: Any, cap: int = 12_000) -> str:
    """C9: ONLY the site chrome (header/footer/nav/chrome-named elements), cleaned and capped."""
    try:
        soup = _prepare(input_)
        _strip_noise(soup)
        picked: list[Any] = []
        picked.extend(_dom.select(soup, "header,nav,footer,[role=banner],[role=navigation],"
                                        "[role=contentinfo]"))
        picked.extend(el for el in _dom.select(soup, "[id],[class]") if _dom.is_chrome_by_name(el))
        ids = {id(el) for el in picked}

        def is_top(el: Any) -> bool:
            cur = el.parent
            while cur is not None:
                if id(cur) in ids:
                    return False
                cur = cur.parent
            return True

        uniq: list[Any] = []
        seen: set[int] = set()
        for el in picked:
            if is_top(el) and id(el) not in seen:
                seen.add(id(el))
                uniq.append(el)
        for el in uniq:
            for x in [el, *_dom.iter_tags(el)]:
                _keep_attrs(x, (*_PROMPT_KEEP, "role"))
        return trim(re.sub(r"\s+", " ", "\n".join(str(el) for el in uniq)))[:cap]
    except Exception:  # noqa: BLE001 — TS catch-all
        return ""


# ---------------------------------------------------------------------------
# C9 brand pass: firm profile learned once per site from chrome / homepage
# ---------------------------------------------------------------------------
FIRM_BRAND_IDS = [
    "firm.firm_name", "firm.logo_url", "firm.phone_main", "firm.website", "firm.social_links",
    "firm.email", "firm.address_block",
]


def firm_locator_ids(fields: dict[str, Any], keys: list[dict[str, Any]],
                     tax_candidates: list[str]) -> list[str]:
    cand = set(tax_candidates)
    return [
        *[fid for fid in FIRM_BRAND_IDS if not fields.get(fid)],
        *[k["id"] for k in keys if (k.get("subjects") or [None])[0] == "firm"
          and k["id"] in cand and not fields.get(k["id"])],
    ]


def _raw_locator_text(soup: Any, loc: dict[str, Any]) -> str | None:
    """C10: first raw text a CSS/label locator reads, before validation (<= 120 chars)."""
    if soup is None:
        return None
    try:
        pair = loc.get("pair")
        if pair:
            a = _raw_locator_text(soup, pair["latitude"])
            b = _raw_locator_text(soup, pair["longitude"])
            return None if a is None and b is None else f"{a or ''}, {b or ''}"[:120]
        if loc.get("strategy") == "css":
            if not loc.get("css"):
                return None
            el = _dom.select_first(soup, loc["css"])
            if el is None:
                return None
            t = _dom.attr(el, loc["attr"]) if loc.get("attr") else _dom.text(el)
        else:
            el = find_label_el(soup, loc.get("label") or "")
            if el is None:
                return None
            p = _dom.parent_tag(el)
            t = _dom.text(p) if p is not None else ""
        s = trim(re.sub(r"\s+", " ", t or ""))
        return s[:120] if s else None
    except Exception:  # noqa: BLE001 — TS catch-all
        return None


def _trunc_diag(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, str):
        return v[:200]
    s = json_stringify(v)
    return s[:200] if len(s) > 200 else v


FIRM_DIAGNOSTICS_CAP = 40


def _diag_rule(loc: dict[str, Any]) -> dict[str, Any]:
    pair = loc.get("pair")
    if pair:
        la, lo = pair["latitude"], pair["longitude"]
        return {"strategy": "css",
                "css": f"{la.get('css') or la.get('label') or ''} | "
                       f"{lo.get('css') or lo.get('label') or ''}"}
    out: dict[str, Any] = {"strategy": loc.get("strategy")}
    for k in ("css", "label", "attr"):
        if loc.get(k):
            out[k] = loc[k]
    return out


def merge_firm_rules(
    fields: dict[str, Any],
    rules: list[Any],
    home: Any,
    samples: list[Any],
    site_entity_names: set[str],
    opts: dict[str, Any] | None,
    firm_ids: list[str],
    tax_types: dict[str, str] | None = None,
) -> dict[str, Any]:
    """C9/C10: validate firm rules; returns ``{fields, failed, diagnostics, homepageDiffers}``."""
    opts = norm_opts(opts)
    tax_types = tax_types or {}
    allowed = set(firm_ids)
    out = dict(fields)
    failed: dict[str, None] = {}
    passed: set[str] = set()
    diagnostics: list[dict[str, Any]] = []
    homepage_differs: list[str] = []
    pages = [home, *samples]
    ctxs = [ctx_for(doc_of(p), sample_get(p, "url") or "", site_entity_names, opts) for p in pages]
    universal = {fid: f for fid, f in fields.items() if not is_tax_id(fid)}
    accepted = [apply_site_contract(doc_of(p), sample_get(p, "url") or "", {"fields": universal},
                                    site_entity_names, opts)["values"] for p in pages]

    def non_empty(v: Any) -> bool:
        return v is not None and norm_val(v) != ""

    for item in group_geo_rules(rules if isinstance(rules, list) else [], tax_types):
        r, pair = item.get("r"), item.get("pair")
        if not isinstance(r, dict) or not isinstance(r.get("id"), str) or r["id"] not in allowed:
            continue
        rid = r["id"]
        st = r.get("strategy")
        if (st == "css" and not r.get("css")) or (st == "label" and not r.get("label")) \
                or st not in ("css", "label"):
            failed[rid] = None
            continue
        tax = is_tax_id(rid)
        type_ = tax_types.get(rid) if tax else field_type(rid)
        if not type_:
            continue
        locator = pair if pair is not None else rule_to_locator(r)
        vals = [apply_locator(locator, type_, rid, c) for c in ctxs]
        raws = [_raw_locator_text(c.soup(), locator) for c in ctxs]
        hv = vals[0]
        sv = vals[1:]
        present = [v for v in sv if non_empty(v)]
        phone_clash = type_ == "phone" and any(
            v is not None and any(accepted[i].get(pid) is not None
                                  and norm_val(accepted[i][pid]) == norm_val(v)
                                  for pid in ("person.phone", "location.phone"))
            for i, v in enumerate(vals))
        type_clash = any(
            v is not None and (clashes_tax(type_, v, accepted[i], out) if tax
                               else clashes(rid, v, accepted[i]))
            for i, v in enumerate(vals))
        note: str | None = None
        if is_value_anchored(locator, vals):
            outcome, note = "failed_validation", "value_anchored"
        elif phone_clash or type_clash:
            outcome = "failed_validation"
            note = "equals_person_or_branch_phone" if phone_clash else "type_clash"
        elif len(present) >= 2:
            same = all(norm_val(v) == norm_val(present[0]) for v in present)
            if not same:
                outcome = "varies"
            else:
                outcome = "accepted"
                if non_empty(hv) and norm_val(hv) != norm_val(present[0]):
                    note = "homepage_differs"
                    homepage_differs.append(rid)
                elif not non_empty(hv):
                    note = "homepage_missing"
        elif len(present) == 1:
            if non_empty(hv) and norm_val(hv) == norm_val(present[0]):
                outcome = "accepted"
            elif non_empty(hv):
                outcome, note = "varies", "homepage_differs"
            else:
                outcome, note = "not_found", "single_sample"
        elif non_empty(hv):
            outcome, note = "accepted", "homepage_only"
        else:
            outcome = "failed_validation" if any(x is not None for x in raws) else "not_found"
        diag: dict[str, Any] = {
            "id": rid, "rule": _diag_rule(locator), "homepage": _trunc_diag(hv),
            "samples": [_trunc_diag(x) for x in sv], "raw_homepage": raws[0],
            "raw_samples": raws[1:], "outcome": outcome,
        }
        if note:
            diag["note"] = note
        diagnostics.append(diag)
        if outcome != "accepted":
            failed[rid] = None
            continue
        passed.add(rid)
        existing = out.get(rid)
        if existing:
            # C10: a rule kept from the previous contract stays primary; new one is backup.
            if existing.get("kept_from_previous") and not existing.get("backup"):
                out[rid] = {**existing, "backup": locator}
            continue
        spec = {"tier": "css", "locator": locator, "type": type_,
                "hits": max(len(present), 1), "samples": len(samples)}
        if note == "homepage_only":
            spec["homepage_only"] = True
        out[rid] = spec
    return {
        "fields": out,
        "failed": [fid for fid in failed if fid not in passed],
        "diagnostics": diagnostics[:FIRM_DIAGNOSTICS_CAP],
        "homepageDiffers": [fid for fid in homepage_differs if fid in passed],
    }


def build_firm_profile(
    contract: dict[str, Any],
    home: Any,
    samples: list[Any],
    site_entity_names: set[str],
    opts: dict[str, Any] | None = None,
    prefer_sample_ids: set[str] | None = None,
) -> dict[str, Any]:
    """C9: firm values read on the homepage (else the first sample that has them)."""
    prefer_sample_ids = prefer_sample_ids or set()
    pages = [home, *samples]
    per = [apply_site_contract(doc_of(p), sample_get(p, "url") or "", contract, site_entity_names,
                               opts)["values"] for p in pages]
    ids: list[tuple[str, str, dict[str, Any]]] = [
        *[(fid, fid, f) for fid, f in (contract.get("fields") or {}).items()
          if fid.startswith("firm.")],
        *[(TAX_PREFIX + slug, TAX_PREFIX + slug, f)
          for slug, f in (contract.get("taxonomy_fields") or {}).items()
          if f.get("subject") == "firm"],
    ]
    values: dict[str, Any] = {}
    sources: dict[str, str] = {}
    order = list(range(len(pages)))
    sample_first = [*order[1:], 0]
    for key, fid, f in ids:
        i = next((j for j in (sample_first if fid in prefer_sample_ids else order)
                  if not is_empty_value(per[j].get(fid))), -1)
        if i < 0:
            continue
        values[key] = per[i][fid]
        src = "homepage"
        loc = f.get("locator") or {}
        if f.get("homepage_only"):
            sources[key] = "homepage"
            continue
        if loc.get("tier") == "jsonld" or (
                is_alias(loc)
                and ((contract.get("fields") or {}).get(loc.get("from")) or {}).get("tier")
                == "jsonld"):
            src = "jsonld"
        elif loc.get("tier") == "css" and not is_derived(loc):
            soup = doc_of(pages[i]).soup
            if soup is not None and locator_targets_chrome(soup, loc):
                src = "chrome"
        sources[key] = src
    return {"values": values, "sources": sources, "learned_at": iso_now()}


def _locator_to_rules(fid: str, loc: dict[str, Any]) -> list[dict[str, Any]]:
    """C10: CSS/label locator back to the rule(s) it came from (pair -> two part rules)."""
    pair = loc.get("pair")
    if pair:
        return [{**r, "part": part} for part in ("latitude", "longitude")
                for r in _locator_to_rules(fid, pair[part])]
    r: dict[str, Any] = {"id": fid, "strategy": loc.get("strategy")}
    for k in ("css", "label", "attr"):
        if loc.get(k):
            r[k] = loc[k]
    if loc.get("multi"):
        r["multi"] = True
    if loc.get("split_commas"):
        r["split_commas"] = True
    if loc.get("item_fields"):
        r["item_fields"] = loc["item_fields"]
    return [r]


def _is_plain_css(loc: Any) -> bool:
    return (isinstance(loc, dict) and loc.get("tier") == "css" and not is_derived(loc)
            and loc.get("strategy") in ("css", "label"))


def previous_contract_rules(prev: dict[str, Any] | None) -> dict[str, Any]:
    """C10 sticky rules of a previous contract (v3+); returns ``{rules, backups}``."""
    rules: list[dict[str, Any]] = []
    backups: dict[str, Any] = {}
    if not prev:
        return {"rules": rules, "backups": backups}
    v = prev.get("version")
    if js_number(0 if v is None else v) < 3:  # NaN passes, like `Number(x) < 3` in JS
        return {"rules": rules, "backups": backups}
    entries = [
        *(prev.get("fields") or {}).items(),
        *[(TAX_PREFIX + slug, f) for slug, f in (prev.get("taxonomy_fields") or {}).items()],
        # C14: extra rules are sticky too.
        *[(EXTRA_PREFIX + key, f) for key, f in (prev.get("extra_fields") or {}).items()],
    ]
    for fid, f in entries:
        if not isinstance(f, dict) or not _is_plain_css(f.get("locator")):
            continue
        rules.extend(_locator_to_rules(fid, f["locator"]))
        if _is_plain_css(f.get("backup")):
            backups[fid] = f["backup"]
    return {"rules": rules, "backups": backups}


def mark_kept_fields(fields: dict[str, Any], kept_ids: Any,
                     backups: dict[str, Any] | None = None) -> dict[str, Any]:
    """C10: mark ids kept from the previous contract (and restore their previous backup)."""
    backups = backups or {}
    out = dict(fields)
    for fid in kept_ids:
        f = out.get(fid)
        if not f:
            continue
        nf = {**f, "kept_from_previous": True}
        if not f.get("backup") and backups.get(fid):
            nf["backup"] = backups[fid]
        out[fid] = nf
    return out
