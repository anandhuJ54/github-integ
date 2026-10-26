"""CATEGORY BRIEF — the object every NORA interview step reads (port of lib/category-brief.ts:
compileCategoryBrief / entityBrief / entityBriefForOffice, plus the loader
loadCategoryBriefRows from lib/category-brief.functions.ts).

One engine serves all GBP categories: the brief is compiled from category DATA (exp_category_*,
exp_vertical_node_registry, exp_taxonomy, exp_rings). There is no per-category code here. The
output keeps the TS JSON shape (camelCase keys) so it can be compared with / handed to the UI.

The fallback rules (cardinality from PROPERTY_SEMANTICS, derived identity keys, scope fallback,
ring mapping, label fallbacks) are documented in the TS header and ported unchanged.
"""
from __future__ import annotations

import functools
import math
import re
from typing import Any

from surfaces.nora_os.internal.db import Db

# ── Data-free semantics (schema.org meaning, identical for every category) ──


def _humanize(s: str) -> str:
    t = re.sub(r"([a-z])([A-Z])", r"\1 \2", re.sub(r"[._]", " ", s)).strip().lower()
    return t[:1].upper() + t[1:]


_DEFAULT_RING_KEYS = [
    "identity", "presence", "location", "authority", "services",
    "content", "reputation", "engagement", "conversion", "entity_graph",
]
DEFAULT_RINGS = [
    {"position": i + 1, "ring_key": k, "ring_name": _humanize(k), "schema_properties": None}
    for i, k in enumerate(_DEFAULT_RING_KEYS)
]

# Legacy registry ring keys → canonical exp_rings key (last-resort mapping).
LEGACY_RING_ALIAS = {"media": "content", "social": "presence", "transactions": "conversion"}

_F = {
    "offers": {"key": "offers", "label": "Services"},
    "credentials": {"key": "credentials", "label": "Credentials"},
    "people": {"key": "people", "label": "Team"},
    "affiliations": {"key": "affiliations", "label": "Affiliations"},
    "reviews": {"key": "reviews", "label": "Reviews"},
    "media": {"key": "media", "label": "Photos & videos"},
    "content": {"key": "content", "label": "Articles & content"},
    "profiles": {"key": "profiles", "label": "Profiles & links"},
    "areas": {"key": "areas", "label": "Areas served"},
    "attributes": {"key": "attributes", "label": "Features"},
    "hours": {"key": "hours", "label": "Hours"},
    "contacts": {"key": "contacts", "label": "Contact channels"},
    "actions": {"key": "actions", "label": "Actions"},
}


def _sem(family: str, cardinality: str) -> dict:
    return {"family": _F[family], "cardinality": cardinality}


# Base schema_property → collection family + fallback cardinality.
PROPERTY_SEMANTICS: dict[str, dict] = {
    "hasMenu": _sem("offers", "many"),
    "menu": _sem("offers", "many"),
    "hasMenuItem": _sem("offers", "many"),
    "hasMenuSection": _sem("offers", "many"),
    "hasOfferCatalog": _sem("offers", "few"),
    "makesOffer": _sem("offers", "few"),
    "availableService": _sem("offers", "few"),
    "hasCourse": _sem("offers", "few"),
    "hasCredential": _sem("credentials", "few"),
    "hasCertification": _sem("credentials", "few"),
    "award": _sem("credentials", "few"),
    "awards": _sem("credentials", "few"),
    "alumniOf": _sem("credentials", "few"),
    "employee": _sem("people", "few"),
    "employees": _sem("people", "few"),
    "member": _sem("people", "few"),
    "members": _sem("people", "few"),
    "alumni": _sem("people", "few"),
    "memberOf": _sem("affiliations", "few"),
    "affiliation": _sem("affiliations", "few"),
    "worksFor": _sem("affiliations", "few"),
    "sponsor": _sem("affiliations", "few"),
    "funder": _sem("affiliations", "few"),
    "subOrganization": _sem("affiliations", "few"),
    "review": _sem("reviews", "many"),
    "reviews": _sem("reviews", "many"),
    "comment": _sem("reviews", "many"),
    "photo": _sem("media", "many"),
    "image": _sem("media", "few"),
    "video": _sem("media", "few"),
    "associatedMedia": _sem("media", "few"),
    "author": _sem("content", "few"),
    "subjectOf": _sem("content", "few"),
    "event": _sem("content", "few"),
    "sameAs": _sem("profiles", "few"),
    "areaServed": _sem("areas", "few"),
    "serviceArea": _sem("areas", "few"),
    "containsPlace": _sem("areas", "few"),
    "amenityFeature": _sem("attributes", "few"),
    "servesCuisine": _sem("attributes", "few"),
    "paymentAccepted": _sem("attributes", "few"),
    "knowsAbout": _sem("attributes", "few"),
    "knowsLanguage": _sem("attributes", "few"),
    "currenciesAccepted": _sem("attributes", "few"),
    "openingHoursSpecification": _sem("hours", "few"),
    "specialOpeningHoursSpecification": _sem("hours", "few"),
    "contactPoint": _sem("contacts", "few"),
    "potentialAction": _sem("actions", "few"),
}

DEFAULT_EXPECTED_COUNT = {
    "one": {"min": 1, "max": 1},
    "few": {"min": 1, "max": 12},
    "many": {"min": 20, "max": 500},
}
CARD_RANK = {"one": 0, "few": 1, "many": 2}
LANE_VOLUME = {"reviews": "reviews", "articles": "articles", "qa": "qa", "videos": "videos"}
GENERIC_PROPERTIES = frozenset({"additionalProperty", "identifier"})
ORG_SCOPE_FALLBACK = {"brand": "location", "team": "location"}
PROPERTY_LABEL = {
    "name": "Name",
    "address": "Address",
    "telephone": "Phone",
    "email": "Email",
    "url": "Website",
    "parentOrganization": "Parent organization",
    "hasCredential.identifier": "License #",
}
VOCAB_LEVELS = {
    "product_service": "productService",
    "specialization": "specialization",
    "profession_title": "professionTitle",
    "alias": "alias",
    "industry_term": "industryTerm",
}

# ── Helpers ─────────────────────────────────────────────────────────────────


def _base_prop(p: str | None) -> str | None:
    return p.split(".")[0] if p else None


def _to_num(v: Any) -> float | int | None:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        n = v
    else:
        try:
            n = float(str(v).strip()) if str(v).strip() else 0
        except ValueError:
            return None
    if not math.isfinite(n):
        return None
    return int(n) if float(n).is_integer() else n


def _non_empty(s: Any) -> bool:
    return isinstance(s, str) and s.strip() != ""


def _nz(v: Any, d: Any) -> Any:
    return d if v is None else v


def _most_frequent(values: list[str | None]) -> str | None:
    counts: dict[str, int] = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    best, best_n = None, 0
    for k, n in counts.items():
        if n > best_n:
            best, best_n = k, n
    return best


def _locale_cmp(a: str, b: str) -> int:
    """`a.localeCompare(b)` approximation: case-insensitive first, then code points."""
    ka, kb = (a.lower(), a), (b.lower(), b)
    return (ka > kb) - (ka < kb)


def _by_frequency(values: list[str | None]) -> list[str]:
    counts: dict[str, int] = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    items = list(counts.items())
    items.sort(key=functools.cmp_to_key(lambda a, b: (b[1] - a[1]) or _locale_cmp(a[0], b[0])))
    return [k for k, _ in items]


def _canonical_ring(raw: str | None, prop: str | None, rings: list[dict]) -> str:
    if raw and any(r["ring_key"] == raw for r in rings):
        return raw
    bp = _base_prop(prop)
    if bp:
        for r in rings:
            if bp in (r.get("schema_properties") or []):
                return r["ring_key"]
    if raw and raw in LEGACY_RING_ALIAS:
        return LEGACY_RING_ALIAS[raw]
    return raw if raw is not None else "identity"


def _node_cardinality(n: dict) -> tuple[str, str]:
    if n.get("cardinality"):
        return n["cardinality"], "registry"
    bp = _base_prop(n.get("schema_property"))
    sem = PROPERTY_SEMANTICS.get(bp) if bp else None
    return (sem["cardinality"] if sem else "one"), "derived"


def _parse_identity_keys(spec: Any, entity_type: str) -> list[dict]:
    if not spec:
        return []
    lst = spec if isinstance(spec, list) else spec.get(entity_type, [])
    if not isinstance(lst, list):
        return []
    out = []
    for k in lst:
        if isinstance(k, str):
            out.append(
                {"key": k, "label": PROPERTY_LABEL.get(k) or _humanize(k), "schemaProperty": k,
                 "source": "shape"}
            )
        elif isinstance(k, dict) and _non_empty(k.get("key")):
            prop = _nz(k.get("schemaProperty"), k["key"])
            out.append(
                {
                    "key": k["key"],
                    "label": _nz(k.get("label"), PROPERTY_LABEL.get(prop) or _humanize(k["key"])),
                    "schemaProperty": prop,
                    "source": "shape",
                }
            )
    return out


def _derived_identity_keys(entity_type: str, nodes: list[dict], credential_id_label: str) -> list[dict]:
    def k(key: str, schema_property: str | None = None, label: str | None = None) -> dict:
        sp = schema_property or key
        return {
            "key": key,
            "label": _nz(label, PROPERTY_LABEL.get(sp) or _humanize(key)),
            "schemaProperty": sp,
            "source": "derived",
        }

    base = {
        "location": [k("name"), k("address"), k("telephone")],
        "brand": [k("name"), k("url")],
        "team": [k("name"), k("parentOrganization")],
        "professional": [k("name"), k("email")],
    }
    keys = list(base.get(entity_type) or [k("name")])
    verified_credential = entity_type != "location" and any(
        n["requiresVerification"]
        and _base_prop(n["schemaProperty"]) == "hasCredential"
        and n["entityScope"] == entity_type
        for n in nodes
    )
    if verified_credential:
        keys.append(k("credential_id", "hasCredential.identifier", credential_id_label))
    return keys


def _expected(v: Any, vp: Any, band: Any, na: Any) -> dict:
    return {"annual": v, "annualProfessional": vp, "band": band, "notApplicable": bool(na)}


# ── Compile ─────────────────────────────────────────────────────────────────


def compile_category_brief(rows: dict) -> dict:
    """CategoryBriefRows (TS keys: gcid, category, shape, profileConfig, nodes, taxonomy,
    completeness, schemaTypes, compliance, ear, eaa, eaq, eav, rings) → CategoryBrief."""
    gcid: str = rows["gcid"]
    category = rows.get("category")
    shape = rows.get("shape")
    pc = rows.get("profileConfig")
    cc = rows.get("compliance")
    raw_rings = rows.get("rings")
    rings = sorted(raw_rings, key=lambda r: r["position"]) if raw_rings else DEFAULT_RINGS
    ring_pos = {r["ring_key"]: r["position"] for r in rings}
    display_name = (
        category.get("display_name")
        if category and category.get("display_name") is not None
        else re.sub(r"^gcid:", "", gcid).replace("_", " ")
    )
    pc = pc or None
    p = pc or {}
    c = cc or {}

    labels_from_config = bool(pc) and _non_empty(p.get("entity_noun")) and _non_empty(
        p.get("service_label")
    )
    labels = {
        "entityNoun": p["entity_noun"] if _non_empty(p.get("entity_noun")) else display_name,
        "serviceLabel": p["service_label"] if _non_empty(p.get("service_label")) else "Services",
        "credentialLabel": p["credential_label"]
        if _non_empty(p.get("credential_label"))
        else "Credentials",
        "credentialIdLabel": c["license_label"]
        if _non_empty(c.get("license_label"))
        else (p["credential_id_label"] if _non_empty(p.get("credential_id_label")) else "License #"),
        "ctaLabel": p["cta_label"] if _non_empty(p.get("cta_label")) else "Contact",
        "source": "profile_config" if labels_from_config else "fallback",
    }

    schema_type = _nz(
        _most_frequent([s.get("schema_type") for s in (rows.get("schemaTypes") or [])]),
        p.get("schema_type"),
    )

    raw_nodes: list[dict] = rows.get("nodes") or []
    all_nodes: list[dict] = []
    for n in raw_nodes:
        card, src = _node_cardinality(n)
        all_nodes.append(
            {
                "nodeId": n.get("id"),
                "nodeSlug": n["node_slug"],
                "nodeName": _nz(n.get("node_name"), _humanize(n["node_slug"])),
                "ring": _canonical_ring(n.get("ring"), n.get("schema_property"), rings),
                "rawRing": n.get("ring"),
                "entityScope": _nz(n.get("entity_scope"), "shared"),
                "nodeClass": n.get("node_class"),
                "connectionMethod": _nz(n.get("connection_method"), "manual"),
                "schemaType": n.get("schema_type"),
                "schemaProperty": n.get("schema_property"),
                "requiredForScore": bool(n.get("required_for_score")),
                "scorePoints": _nz(n.get("score_points"), 0),
                "priority": _nz(n.get("priority"), 0),
                "countsTowardM": bool(n.get("counts_toward_m")),
                "ownsLane": n.get("owns_lane"),
                "requiresVerification": bool(n.get("requires_verification")),
                "cardinality": card,
                "cardinalitySource": src,
            }
        )
    scopes_present = {n["entityScope"] for n in all_nodes}

    vocabulary: dict[str, list[dict]] = {
        "productService": [], "specialization": [], "professionTitle": [], "alias": [],
        "industryTerm": [],
    }
    for t in rows.get("taxonomy") or []:
        bucket = VOCAB_LEVELS.get(t.get("level"))
        if not bucket:
            continue
        term = t["term_display"] if _non_empty(t.get("term_display")) else t.get("term")
        if _non_empty(term):
            vocabulary[bucket].append({"term": term, "scope": _nz(t.get("entity_scope"), "shared")})

    def vol_of(row: dict | None, a: str, b: str, na: str) -> dict:
        r = row or {}
        return _expected(_to_num(r.get(a)), _to_num(r.get(b)), r.get("band"), r.get(na))

    vol = {
        "reviews": vol_of(rows.get("ear"), "ear", "ear_professional", "non_reviewable"),
        "articles": vol_of(rows.get("eaa"), "eaa", "eaa_professional", "non_authored"),
        "qa": vol_of(rows.get("eaq"), "eaq", "eaq_professional", "non_qa"),
        "videos": vol_of(rows.get("eav"), "eav", "eav_professional", "non_video"),
    }

    sh = shape or {}
    allowed: list[str] = sh.get("allowed_entity_types") or []
    required: list[str] = sh.get("required_entity_types") or []
    claimable = set(sh.get("claimable_types") or [])
    monetizable = set(sh.get("monetizable_types") or [])
    shape_name = sh.get("shape")
    primary = next((t for t in required if t in allowed), None)
    if primary is None:
        primary = next(
            (t for t in allowed if isinstance(shape_name, str) and shape_name.startswith(f"{t}_")),
            None,
        )
    if primary is None:
        primary = allowed[0] if allowed else None

    entity_types = [
        _entity_brief(t, all_nodes, scopes_present, sh, labels, vocabulary, vol, raw_nodes,
                      ring_pos, schema_type, required, claimable, monetizable, primary)
        for t in allowed
    ]

    comp = rows.get("completeness") or {}
    return {
        "gcid": gcid,
        "displayName": display_name,
        "joinsGbp": bool(category),
        "shape": sh.get("shape"),
        "primaryEntityType": primary,
        "schemaType": schema_type,
        "labels": labels,
        "entityTypes": entity_types,
        "relationships": sh.get("allowed_relationships") or [],
        "teamsAllowed": bool(sh.get("teams_allowed")),
        "vocabulary": vocabulary,
        "completeness": {
            "totalNodeTypes": comp.get("total_node_types"),
            "coreNodeTypes": comp.get("core_node_types"),
            "expectedM": _to_num(comp.get("expected_m")),
        },
        "expected": vol,
        "compliance": {
            "licenseLabel": c.get("license_label"),
            "requiredDisclaimers": c.get("required_disclaimers") or [],
            "requiredDisclosures": c.get("required_disclosures") or [],
            "contentRestrictions": c.get("content_restrictions") or [],
            "prohibitedPhrases": c.get("prohibited_phrases") or [],
            "regulatedBy": c.get("regulated_by") or [],
            "flags": {
                "hipaa": bool(c.get("hipaa_applies")),
                "glba": bool(c.get("glba_applies")),
                "coppa": bool(c.get("coppa_applies")),
                "ferpa": bool(c.get("ferpa_applies")),
            },
            "ageGate": {
                "required": bool(c.get("age_gate_required")),
                "minimum": c.get("age_gate_minimum"),
            },
            "reviewVerificationRequired": bool(c.get("review_verification_required")),
            "reviewTransactionRequired": bool(c.get("review_transaction_required")),
            "notes": c.get("compliance_notes"),
        },
        "rings": [
            {"key": r["ring_key"], "name": r["ring_name"], "position": r["position"]} for r in rings
        ],
    }


def _entity_brief(
    type_: str,
    all_nodes: list[dict],
    scopes_present: set[str],
    shape: dict,
    labels: dict,
    vocabulary: dict,
    vol: dict,
    raw_nodes: list[dict],
    ring_pos: dict[str, int],
    schema_type: str | None,
    required: list[str],
    claimable: set[str],
    monetizable: set[str],
    primary: str | None,
) -> dict:
    scopes = [type_, "shared"]
    scope_fallback = False
    if type_ not in scopes_present:
        scope_fallback = True
        fb = ORG_SCOPE_FALLBACK.get(type_)
        scopes = [fb, "shared"] if fb else ["shared"]
    nodes = [n for n in all_nodes if n["entityScope"] in scopes]

    shape_keys = _parse_identity_keys(shape.get("identity_keys"), type_)
    identity_keys = shape_keys or _derived_identity_keys(type_, nodes, labels["credentialIdLabel"])

    # Add-profile form: identity keys, then manual single-valued identity-ring and required nodes.
    fields: dict[str, dict] = {}
    for k in identity_keys:
        fields[k["schemaProperty"]] = {
            "key": k["key"],
            "label": k["label"],
            "schemaProperty": k["schemaProperty"],
            "required": True,
            "source": "identity_key",
            "nodeSlugs": [],
        }
    for n in nodes:
        if not n["schemaProperty"] or n["cardinality"] != "one" or n["connectionMethod"] != "manual":
            continue
        if n["ring"] != "identity" and not n["requiredForScore"]:
            continue
        bp = _base_prop(n["schemaProperty"])
        dedupe = f"node:{n['nodeSlug']}" if bp in GENERIC_PROPERTIES else n["schemaProperty"]
        existing = fields.get(dedupe)
        if existing:
            existing["nodeSlugs"].append(n["nodeSlug"])
            existing["required"] = existing["required"] or n["requiredForScore"]
            continue
        fields[dedupe] = {
            "key": n["nodeSlug"] if dedupe.startswith("node:") else n["schemaProperty"],
            "label": n["nodeName"],
            "schemaProperty": n["schemaProperty"],
            "required": n["requiredForScore"],
            "source": "identity_ring" if n["ring"] == "identity" else "required_node",
            "nodeSlugs": [n["nodeSlug"]],
        }
    form_fields = sorted(
        fields.values(),
        key=functools.cmp_to_key(
            lambda a, b: (int(b["source"] == "identity_key") - int(a["source"] == "identity_key"))
            or (int(b["required"]) - int(a["required"]))
        ),
    )

    is_claimable = type_ in claimable
    claim = {
        "claimable": is_claimable,
        "keys": identity_keys if is_claimable else [],
        "verifiableNodes": [
            {
                "nodeSlug": n["nodeSlug"],
                "nodeName": n["nodeName"],
                "schemaProperty": n["schemaProperty"],
                "connectionMethod": n["connectionMethod"],
            }
            for n in nodes
            if n["requiresVerification"]
        ]
        if is_claimable
        else [],
    }

    # Collections: list-like nodes grouped by property family.
    groups: dict[str, dict] = {}
    for n in nodes:
        if n["cardinality"] == "one":
            continue
        bp = _base_prop(n["schemaProperty"])
        sem = PROPERTY_SEMANTICS.get(bp) if bp else None
        family = sem["family"] if sem else {
            "key": bp if bp is not None else "other",
            "label": _humanize(bp if bp is not None else "other"),
        }
        g = groups.setdefault(family["key"], {"family": family, "nodes": []})
        g["nodes"].append(n)
    is_professional = type_ == "professional"
    collections = []
    for g in groups.values():
        family, gn = g["family"], g["nodes"]
        cardinality = "one"
        for n in gn:
            if CARD_RANK[n["cardinality"]] > CARD_RANK[cardinality]:
                cardinality = n["cardinality"]
        from_registry = [n for n in gn if n["cardinalitySource"] == "registry"]
        reg_slugs = {n["nodeSlug"] for n in from_registry}
        raw_from_registry = [r for r in raw_nodes if r["node_slug"] in reg_slugs]
        mins = [r["expected_count_min"] for r in raw_from_registry if r.get("expected_count_min") is not None]
        maxs = [r["expected_count_max"] for r in raw_from_registry if r.get("expected_count_max") is not None]
        lane = _most_frequent(
            [n["ownsLane"] if n["ownsLane"] and n["ownsLane"] in LANE_VOLUME else None for n in gn]
        )
        lv = vol[LANE_VOLUME[lane]] if lane else None
        annual = (
            _nz(lv["annualProfessional"] if is_professional else None, lv["annual"]) if lv else None
        )
        if family["key"] == "offers":
            label = labels["serviceLabel"]
        elif family["key"] == "credentials":
            label = labels["credentialLabel"]
        else:
            label = family["label"]
        if family["key"] == "offers":
            vocab = vocabulary["productService"]
        elif family["key"] == "attributes" and is_professional:
            vocab = vocabulary["specialization"]
        else:
            vocab = []
        ring_set = list(dict.fromkeys(n["ring"] for n in gn))
        ring_set.sort(key=lambda r: ring_pos.get(r, 99))
        collections.append(
            {
                "key": family["key"],
                "label": label,
                "rings": ring_set,
                "schemaType": _nz(_most_frequent([n["schemaType"] for n in gn]), schema_type),
                "schemaProperty": _most_frequent([_base_prop(n["schemaProperty"]) for n in gn]),
                "schemaProperties": _by_frequency([n["schemaProperty"] for n in gn]),
                "connectionMethod": _most_frequent([n["connectionMethod"] for n in gn]),
                "connectionMethods": _by_frequency([n["connectionMethod"] for n in gn]),
                "cardinality": cardinality,
                "cardinalitySource": "registry" if from_registry else "derived",
                "expectedCount": {
                    "min": min(mins) if mins else DEFAULT_EXPECTED_COUNT[cardinality]["min"],
                    "max": max(maxs) if maxs else DEFAULT_EXPECTED_COUNT[cardinality]["max"],
                },
                "expectedAnnualVolume": annual,
                "requiredForScore": any(n["requiredForScore"] for n in gn),
                "nodeSlugs": [n["nodeSlug"] for n in gn],
                "vocabulary": [
                    v["term"] for v in vocab if v["scope"] == "shared" or v["scope"] in scopes
                ],
            }
        )
    collections.sort(
        key=functools.cmp_to_key(
            lambda a, b: (int(b["requiredForScore"]) - int(a["requiredForScore"]))
            or (CARD_RANK[b["cardinality"]] - CARD_RANK[a["cardinality"]])
            or (len(b["nodeSlugs"]) - len(a["nodeSlugs"]))
        )
    )

    return {
        "type": type_,
        "required": type_ in required,
        "primary": type_ == primary,
        "claimable": is_claimable,
        "monetizable": type_ in monetizable,
        "nodeScopes": scopes,
        "scopeFallback": scope_fallback,
        "identityKeys": identity_keys,
        "formFields": form_fields,
        "claim": claim,
        "collections": collections,
        "nodes": nodes,
    }


# ── Accessors ───────────────────────────────────────────────────────────────


def entity_brief(brief: dict, entity_type: str | None = None) -> dict | None:
    t = entity_type if entity_type is not None else brief["primaryEntityType"]
    return next((e for e in brief["entityTypes"] if e["type"] == t), None)


LISTING_RING = "location"


def _is_listing_collection(c: dict) -> bool:
    return len(c["rings"]) > 0 and all(r == LISTING_RING for r in c["rings"])


def entity_brief_for_office(
    brief: dict, mode: str | None, entity_type: str | None = None
) -> dict | None:
    """Office-mode-aware view: in single_pro mode act as the professional, list as the location;
    otherwise the requested entity type on both sides, unchanged."""
    pro = entity_brief(brief, "professional")
    loc = entity_brief(brief, "location")
    single = mode == "single_pro" and bool(pro) and bool(loc)
    act = pro if single else entity_brief(brief, entity_type)
    lst = loc if single else act
    if not act or not lst:
        return None

    def tag(e: dict):
        return lambda c: {**c, "sourceEntityType": e["type"]}

    listing = [tag(lst)(c) for c in lst["collections"] if _is_listing_collection(c)]
    collections = (
        [tag(act)(c) for c in act["collections"] if not _is_listing_collection(c)] + listing
        if single
        else [tag(act)(c) for c in act["collections"]]
    )
    return {
        "mode": mode,
        "singlePro": single,
        "actAs": act["type"],
        "listAs": lst["type"],
        "identityKeys": act["identityKeys"],
        "formFields": act["formFields"],
        "claim": {
            **act["claim"],
            "listingKeys": lst["identityKeys"],
            "listingEntityType": lst["type"],
        },
        "napKeys": lst["identityKeys"],
        "collections": collections,
        "listingCollections": listing,
    }


# ── Loader (lib/category-brief.functions.ts loadCategoryBriefRows) ─────────

_VOCAB_LEVEL_KEYS = list(VOCAB_LEVELS.keys())
_NODE_COLUMNS = (
    "id, node_slug, node_name, ring, entity_scope, node_class, connection_method, schema_type,"
    " schema_property, required_for_score, score_points, priority, counts_toward_m, owns_lane,"
    " requires_verification"
)
# (key in CategoryBriefRows, table, columns) — every one filtered by gcid, `.maybeSingle()`.
_ONE = (
    ("category", "gbp_categories", "gcid, display_name, slug, entity_type, status"),
    (
        "shape",
        "exp_category_shape",
        ("gcid, shape, allowed_entity_types, required_entity_types, claimable_types,"
        " monetizable_types, teams_allowed, multi_affiliation_allowed, identity_keys,"
        " allowed_relationships"),
    ),
    (
        "profileConfig",
        "exp_category_profile_config",
        ("gcid, entity_noun, service_label, credential_label, credential_id_label, cta_label,"
        " schema_type, show_prequalify"),
    ),
    ("completeness", "exp_category_completeness", "total_node_types, core_node_types, expected_m"),
    (
        "compliance",
        "exp_category_compliance",
        ("license_label, required_disclaimers, content_restrictions, prohibited_phrases,"
        " required_disclosures, regulated_by, hipaa_applies, glba_applies, coppa_applies,"
        " ferpa_applies, age_gate_required, age_gate_minimum, review_verification_required,"
        " review_transaction_required, compliance_notes"),
    ),
    ("ear", "exp_category_ear", "ear, ear_professional, band, non_reviewable"),
    ("eaa", "exp_category_eaa", "eaa, eaa_professional, band, non_authored"),
    ("eaq", "exp_category_eaq", "eaq, eaq_professional, band, non_qa"),
    ("eav", "exp_category_eav", "eav, eav_professional, band, non_video"),
)


def _soft(fn) -> Any:
    """supabase-js `.data` without checking `.error`: a failed read is simply null."""
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return None


def load_category_brief_rows(db: Db, gcid: str) -> dict:
    """The category's rows for compile_category_brief. gcid is used verbatim.

    Mirrors the TS: the single-row reads and the schema-type / ring reads ignore their errors
    (null data); the paged registry + taxonomy reads throw on error. Paging is unnecessary in
    SQL (PostgREST capped responses at 1000 rows) — the full ordered set is read at once.
    """
    out: dict[str, Any] = {"gcid": gcid}
    for key, table, cols in _ONE:
        out[key] = _soft(
            lambda table=table, cols=cols: db.maybe_one(
                f"select {cols} from {table} where gcid = %s", (gcid,), what=table
            )
        )
    out["schemaTypes"] = _soft(
        lambda: db.rows(
            "select schema_type, confidence, rule from exp_category_schema_type where gcid = %s",
            (gcid,),
            what="exp_category_schema_type",
        )
    )
    out["rings"] = _soft(
        lambda: db.rows(
            "select position, ring_key, ring_name, schema_properties from exp_rings"
            " order by position",
            (),
            what="exp_rings",
        )
    )
    out["nodes"] = db.rows(
        f"select {_NODE_COLUMNS} from exp_vertical_node_registry"
        " where gcid = %s and is_active = true order by node_slug",
        (gcid,),
        what="exp_vertical_node_registry",
    )
    out["taxonomy"] = db.rows(
        "select level, term, term_display, entity_scope, schema_property, is_required, priority"
        " from exp_taxonomy where gcid = %s and is_active = true and level = any(%s::text[])"
        " order by level, priority, term",
        (gcid, _VOCAB_LEVEL_KEYS),
        what="exp_taxonomy",
    )
    return out
