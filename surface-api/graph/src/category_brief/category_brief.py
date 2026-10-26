"""CATEGORY BRIEF compiler — pure port of `surface-ui/xmp/src/lib/category-brief.ts`.

One engine serves all 4,041 GBP categories: the brief is compiled from category DATA (rows of
gbp_categories, exp_category_shape, exp_category_profile_config, exp_vertical_node_registry,
exp_taxonomy, exp_category_completeness, exp_category_schema_type, exp_category_compliance,
exp_category_ear/eaa/eaq/eav, exp_rings). No per-category code paths. No I/O here; the loader
lives in `surfaces.graph.category_brief.router`. The output keeps the TS camelCase keys.

Fallback rules are documented in the TS module header and are reproduced exactly.
"""
from __future__ import annotations

import math
import re
from collections.abc import Iterable
from decimal import Decimal
from functools import cmp_to_key
from typing import Any

# ── Data-free semantics (schema.org meaning, identical for every category) ──


def humanize(s: str) -> str:
    t = re.sub(r"[._]", " ", s)
    t = re.sub(r"([a-z])([A-Z])", r"\1 \2", t).strip().lower()
    return t[:1].upper() + t[1:]


_RING_KEYS = ["identity", "presence", "location", "authority", "services", "content",
              "reputation", "engagement", "conversion", "entity_graph"]
DEFAULT_RINGS: list[dict[str, Any]] = [
    {"position": i + 1, "ring_key": k, "ring_name": humanize(k), "schema_properties": None}
    for i, k in enumerate(_RING_KEYS)
]

LEGACY_RING_ALIAS = {"media": "content", "social": "presence", "transactions": "conversion"}

FAMILY: dict[str, dict[str, str]] = {
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


def _sem(family: str, cardinality: str) -> dict[str, Any]:
    return {"family": FAMILY[family], "cardinality": cardinality}


PROPERTY_SEMANTICS: dict[str, dict[str, Any]] = {
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
GENERIC_PROPERTIES = {"additionalProperty", "identifier"}
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


def locale_compare(a: str, b: str) -> int:
    """Approximation of JS `a.localeCompare(b)`: case-insensitive first, lowercase first on ties."""
    ka, kb = (a.casefold(), a.swapcase()), (b.casefold(), b.swapcase())
    return (ka > kb) - (ka < kb)


def base_prop(p: str | None) -> str | None:
    return p.split(".")[0] if p else None


def to_num(v: Any) -> int | float | None:
    if isinstance(v, bool):
        return int(v)
    if v is None or v == "":
        return None
    if isinstance(v, Decimal):
        if not v.is_finite():
            return None
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, int | float):
        return v if math.isfinite(v) else None
    try:
        n = float(str(v).strip() or "0")
    except ValueError:
        return None
    if not math.isfinite(n):
        return None
    return int(n) if n.is_integer() else n


def _non_empty(s: Any) -> bool:
    return isinstance(s, str) and s.strip() != ""


def most_frequent(values: Iterable[str | None]) -> str | None:
    counts: dict[str, int] = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    best, best_n = None, 0
    for k, n in counts.items():
        if n > best_n:
            best, best_n = k, n
    return best


def by_frequency(values: Iterable[str | None]) -> list[str]:
    counts: dict[str, int] = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    items = sorted(counts.items(),
                   key=cmp_to_key(lambda a, b: (b[1] - a[1]) or locale_compare(a[0], b[0])))
    return [k for k, _ in items]


def _canonical_ring(raw: str | None, prop: str | None, rings: list[dict]) -> str:
    if raw and any(r["ring_key"] == raw for r in rings):
        return raw
    bp = base_prop(prop)
    if bp:
        hit = next((r for r in rings if bp in (r.get("schema_properties") or [])), None)
        if hit:
            return hit["ring_key"]
    if raw and raw in LEGACY_RING_ALIAS:
        return LEGACY_RING_ALIAS[raw]
    return raw if raw is not None else "identity"


def _node_cardinality(n: dict) -> tuple[str, str]:
    if n.get("cardinality"):
        return n["cardinality"], "registry"
    bp = base_prop(n.get("schema_property"))
    sem = PROPERTY_SEMANTICS.get(bp) if bp else None
    return (sem["cardinality"] if sem else "one"), "derived"


def _parse_identity_keys(spec: Any, entity_type: str) -> list[dict]:
    if not spec:
        return []
    if isinstance(spec, list):
        lst = spec
    elif isinstance(spec, dict):
        lst = spec.get(entity_type) or []
    else:
        return []
    if not isinstance(lst, list):
        return []
    out = []
    for k in lst:
        if isinstance(k, str):
            out.append({"key": k, "label": PROPERTY_LABEL.get(k) or humanize(k),
                        "schemaProperty": k, "source": "shape"})
        elif isinstance(k, dict) and _non_empty(k.get("key")):
            prop = k.get("schemaProperty") if k.get("schemaProperty") is not None else k["key"]
            label = k.get("label")
            if label is None:
                label = PROPERTY_LABEL.get(prop) or humanize(k["key"])
            out.append({"key": k["key"], "label": label, "schemaProperty": prop,
                        "source": "shape"})
    return out


def _derived_identity_keys(entity_type: str, nodes: list[dict], cred_id_label: str) -> list[dict]:
    def k(key: str, schema_property: str | None = None, label: str | None = None) -> dict:
        sp = schema_property or key
        return {"key": key, "label": label or PROPERTY_LABEL.get(sp) or humanize(key),
                "schemaProperty": sp, "source": "derived"}

    base = {
        "location": [k("name"), k("address"), k("telephone")],
        "brand": [k("name"), k("url")],
        "team": [k("name"), k("parentOrganization")],
        "professional": [k("name"), k("email")],
    }
    keys = list(base.get(entity_type) or [k("name")])
    verified_credential = entity_type != "location" and any(
        n["requiresVerification"] and base_prop(n["schemaProperty"]) == "hasCredential"
        and n["entityScope"] == entity_type
        for n in nodes
    )
    if verified_credential:
        keys.append(k("credential_id", "hasCredential.identifier", cred_id_label))
    return keys


def _expected(v: Any, vp: Any, band: Any, na: Any) -> dict:
    return {"annual": v, "annualProfessional": vp,
            "band": band if band is not None else None, "notApplicable": bool(na)}


def _g(row: dict | None, key: str) -> Any:
    return row.get(key) if row else None


def _nn(v: Any, default: Any) -> Any:
    """JS `v ?? default`."""
    return v if v is not None else default


# ── Compile ─────────────────────────────────────────────────────────────────


def compile_category_brief(rows: dict[str, Any]) -> dict[str, Any]:
    gcid: str = rows["gcid"]
    category = rows.get("category")
    shape = rows.get("shape")
    pc = rows.get("profileConfig")
    cc = rows.get("compliance")
    rings = (sorted(rows["rings"], key=lambda r: r["position"])
             if rows.get("rings") else DEFAULT_RINGS)
    ring_pos = {r["ring_key"]: r["position"] for r in rings}
    display_name = _g(category, "display_name")
    if display_name is None:
        display_name = re.sub(r"^gcid:", "", gcid).replace("_", " ")

    labels_from_config = bool(pc) and _non_empty(pc.get("entity_noun")) and _non_empty(
        pc.get("service_label"))
    labels = {
        "entityNoun": pc["entity_noun"] if _non_empty(_g(pc, "entity_noun")) else display_name,
        "serviceLabel": pc["service_label"] if _non_empty(_g(pc, "service_label")) else "Services",
        "credentialLabel": (pc["credential_label"] if _non_empty(_g(pc, "credential_label"))
                            else "Credentials"),
        "credentialIdLabel": (
            cc["license_label"] if _non_empty(_g(cc, "license_label"))
            else pc["credential_id_label"] if _non_empty(_g(pc, "credential_id_label"))
            else "License #"
        ),
        "ctaLabel": pc["cta_label"] if _non_empty(_g(pc, "cta_label")) else "Contact",
        "source": "profile_config" if labels_from_config else "fallback",
    }

    schema_type = most_frequent(s.get("schema_type") for s in rows.get("schemaTypes") or [])
    if schema_type is None:
        schema_type = _g(pc, "schema_type")

    raw_nodes: list[dict] = rows.get("nodes") or []
    all_nodes: list[dict] = []
    for n in raw_nodes:
        card, card_src = _node_cardinality(n)
        all_nodes.append({
            "nodeId": n.get("id"),
            "nodeSlug": n["node_slug"],
            "nodeName": _nn(n.get("node_name"), None) if n.get("node_name") is not None
            else humanize(n["node_slug"]),
            "ring": _canonical_ring(n.get("ring"), n.get("schema_property"), rings),
            "rawRing": n.get("ring"),
            "entityScope": _nn(n.get("entity_scope"), "shared"),
            "nodeClass": n.get("node_class"),
            "connectionMethod": _nn(n.get("connection_method"), "manual"),
            "schemaType": n.get("schema_type"),
            "schemaProperty": n.get("schema_property"),
            "requiredForScore": bool(n.get("required_for_score")),
            "scorePoints": _nn(n.get("score_points"), 0),
            "priority": _nn(n.get("priority"), 0),
            "countsTowardM": bool(n.get("counts_toward_m")),
            "ownsLane": n.get("owns_lane"),
            "requiresVerification": bool(n.get("requires_verification")),
            "cardinality": card,
            "cardinalitySource": card_src,
        })
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
            vocabulary[bucket].append({"term": term, "scope": _nn(t.get("entity_scope"), "shared")})

    def vol_of(row: dict | None, a: str, ap: str, na: str) -> dict:
        return _expected(to_num(_g(row, a)), to_num(_g(row, ap)), _g(row, "band"), _g(row, na))

    vol = {
        "reviews": vol_of(rows.get("ear"), "ear", "ear_professional", "non_reviewable"),
        "articles": vol_of(rows.get("eaa"), "eaa", "eaa_professional", "non_authored"),
        "qa": vol_of(rows.get("eaq"), "eaq", "eaq_professional", "non_qa"),
        "videos": vol_of(rows.get("eav"), "eav", "eav_professional", "non_video"),
    }

    allowed: list[str] = _g(shape, "allowed_entity_types") or []
    required: list[str] = _g(shape, "required_entity_types") or []
    claimable = set(_g(shape, "claimable_types") or [])
    monetizable = set(_g(shape, "monetizable_types") or [])
    shape_name = _g(shape, "shape")
    primary = next((t for t in required if t in allowed), None)
    if primary is None and shape_name is not None:
        primary = next((t for t in allowed if shape_name.startswith(f"{t}_")), None)
    if primary is None:
        primary = allowed[0] if allowed else None

    entity_types = []
    for etype in allowed:
        scopes = [etype, "shared"]
        scope_fallback = False
        if etype not in scopes_present:
            scope_fallback = True
            fb = ORG_SCOPE_FALLBACK.get(etype)
            scopes = [fb, "shared"] if fb else ["shared"]
        nodes = [n for n in all_nodes if n["entityScope"] in scopes]

        shape_keys = _parse_identity_keys(_g(shape, "identity_keys"), etype)
        identity_keys = shape_keys or _derived_identity_keys(
            etype, nodes, labels["credentialIdLabel"])

        fields: dict[str, dict] = {}
        for k in identity_keys:
            fields[k["schemaProperty"]] = {
                "key": k["key"], "label": k["label"], "schemaProperty": k["schemaProperty"],
                "required": True, "source": "identity_key", "nodeSlugs": [],
            }
        for n in nodes:
            if (not n["schemaProperty"] or n["cardinality"] != "one"
                    or n["connectionMethod"] != "manual"):
                continue
            if n["ring"] != "identity" and not n["requiredForScore"]:
                continue
            bp = base_prop(n["schemaProperty"])
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
            key=lambda f: (-int(f["source"] == "identity_key"), -int(bool(f["required"]))),
        )

        is_claimable = etype in claimable
        claim = {
            "claimable": is_claimable,
            "keys": identity_keys if is_claimable else [],
            "verifiableNodes": [
                {"nodeSlug": n["nodeSlug"], "nodeName": n["nodeName"],
                 "schemaProperty": n["schemaProperty"], "connectionMethod": n["connectionMethod"]}
                for n in nodes if n["requiresVerification"]
            ] if is_claimable else [],
        }

        groups: dict[str, dict] = {}
        for n in nodes:
            if n["cardinality"] == "one":
                continue
            bp = base_prop(n["schemaProperty"])
            sem = PROPERTY_SEMANTICS.get(bp) if bp else None
            family = sem["family"] if sem else {"key": bp or "other",
                                                "label": humanize(bp or "other")}
            g = groups.setdefault(family["key"], {"family": family, "nodes": []})
            g["nodes"].append(n)
        is_professional = etype == "professional"
        collections = []
        for g in groups.values():
            family, gn = g["family"], g["nodes"]
            cardinality = "one"
            for n in gn:
                if CARD_RANK[n["cardinality"]] > CARD_RANK[cardinality]:
                    cardinality = n["cardinality"]
            from_registry = [n for n in gn if n["cardinalitySource"] == "registry"]
            reg_slugs = {n["nodeSlug"] for n in from_registry}
            raw_reg = [r for r in raw_nodes if r["node_slug"] in reg_slugs]
            mins = [r["expected_count_min"] for r in raw_reg
                    if r.get("expected_count_min") is not None]
            maxs = [r["expected_count_max"] for r in raw_reg
                    if r.get("expected_count_max") is not None]
            lane = most_frequent(
                n["ownsLane"] if n["ownsLane"] and n["ownsLane"] in LANE_VOLUME else None
                for n in gn
            )
            lv = vol[LANE_VOLUME[lane]] if lane else None
            if lv:
                pro = lv["annualProfessional"] if is_professional else None
                annual = pro if pro is not None else lv["annual"]
            else:
                annual = None
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
            coll_type = most_frequent(n["schemaType"] for n in gn)
            collections.append({
                "key": family["key"],
                "label": label,
                "rings": sorted(dict.fromkeys(n["ring"] for n in gn),
                                key=lambda r: ring_pos.get(r, 99)),
                "schemaType": coll_type if coll_type is not None else schema_type,
                "schemaProperty": most_frequent(base_prop(n["schemaProperty"]) for n in gn),
                "schemaProperties": by_frequency(n["schemaProperty"] for n in gn),
                "connectionMethod": most_frequent(n["connectionMethod"] for n in gn),
                "connectionMethods": by_frequency(n["connectionMethod"] for n in gn),
                "cardinality": cardinality,
                "cardinalitySource": "registry" if from_registry else "derived",
                "expectedCount": {
                    "min": min(mins) if mins else DEFAULT_EXPECTED_COUNT[cardinality]["min"],
                    "max": max(maxs) if maxs else DEFAULT_EXPECTED_COUNT[cardinality]["max"],
                },
                "expectedAnnualVolume": annual,
                "requiredForScore": any(n["requiredForScore"] for n in gn),
                "nodeSlugs": [n["nodeSlug"] for n in gn],
                "vocabulary": [v["term"] for v in vocab
                               if v["scope"] == "shared" or v["scope"] in scopes],
            })
        collections.sort(key=lambda c: (-int(c["requiredForScore"]),
                                        -CARD_RANK[c["cardinality"]], -len(c["nodeSlugs"])))

        entity_types.append({
            "type": etype,
            "required": etype in required,
            "primary": etype == primary,
            "claimable": is_claimable,
            "monetizable": etype in monetizable,
            "nodeScopes": scopes,
            "scopeFallback": scope_fallback,
            "identityKeys": identity_keys,
            "formFields": form_fields,
            "claim": claim,
            "collections": collections,
            "nodes": nodes,
        })

    completeness = rows.get("completeness")
    return {
        "gcid": gcid,
        "displayName": display_name,
        "joinsGbp": bool(category),
        "shape": shape_name,
        "primaryEntityType": primary,
        "schemaType": schema_type,
        "labels": labels,
        "entityTypes": entity_types,
        "relationships": _g(shape, "allowed_relationships") or [],
        "teamsAllowed": bool(_g(shape, "teams_allowed")),
        "vocabulary": vocabulary,
        "completeness": {
            "totalNodeTypes": _g(completeness, "total_node_types"),
            "coreNodeTypes": _g(completeness, "core_node_types"),
            "expectedM": to_num(_g(completeness, "expected_m")),
        },
        "expected": vol,
        "compliance": {
            "licenseLabel": _g(cc, "license_label"),
            "requiredDisclaimers": _g(cc, "required_disclaimers") or [],
            "requiredDisclosures": _g(cc, "required_disclosures") or [],
            "contentRestrictions": _g(cc, "content_restrictions") or [],
            "prohibitedPhrases": _g(cc, "prohibited_phrases") or [],
            "regulatedBy": _g(cc, "regulated_by") or [],
            "flags": {
                "hipaa": bool(_g(cc, "hipaa_applies")),
                "glba": bool(_g(cc, "glba_applies")),
                "coppa": bool(_g(cc, "coppa_applies")),
                "ferpa": bool(_g(cc, "ferpa_applies")),
            },
            "ageGate": {"required": bool(_g(cc, "age_gate_required")),
                        "minimum": _g(cc, "age_gate_minimum")},
            "reviewVerificationRequired": bool(_g(cc, "review_verification_required")),
            "reviewTransactionRequired": bool(_g(cc, "review_transaction_required")),
            "notes": _g(cc, "compliance_notes"),
        },
        "rings": [{"key": r["ring_key"], "name": r["ring_name"], "position": r["position"]}
                  for r in rings],
    }


# ── Accessors ───────────────────────────────────────────────────────────────


def entity_brief(brief: dict, entity_type: str | None = None) -> dict | None:
    t = entity_type if entity_type is not None else brief["primaryEntityType"]
    return next((e for e in brief["entityTypes"] if e["type"] == t), None)


def next_gaps(brief: dict, filled: Iterable[str | dict], entity_type: str | None = None
              ) -> list[dict]:
    """Registry node types not yet filled for an entity type, most valuable first."""
    eb = entity_brief(brief, entity_type)
    if not eb:
        return []
    done = {f if isinstance(f, str) else f["nodeSlug"] for f in filled}
    pos = {r["key"]: r["position"] for r in brief["rings"]}

    def cmp(a: dict, b: dict) -> int:
        return (
            int(b["requiredForScore"]) - int(a["requiredForScore"])
            or _sign(b["scorePoints"] - a["scorePoints"])
            or int(bool(b["ownsLane"])) - int(bool(a["ownsLane"]))
            or pos.get(a["ring"], 99) - pos.get(b["ring"], 99)
            or _sign(a["priority"] - b["priority"])
            or locale_compare(a["nodeSlug"], b["nodeSlug"])
        )

    return sorted((n for n in eb["nodes"] if n["nodeSlug"] not in done), key=cmp_to_key(cmp))


def _sign(x: Any) -> int:
    return (x > 0) - (x < 0)


def brief_failures(brief: dict) -> list[str]:
    """Structural gate (tools/category_brief/compile_all.ts)."""
    f = []
    if not brief["joinsGbp"]:
        f.append("no_gbp_join")
    if not brief["entityTypes"]:
        f.append("no_entity_type")
    if any(not e["identityKeys"] for e in brief["entityTypes"]):
        f.append("no_identity_key")
    if not brief["entityTypes"] or any(not e["collections"] for e in brief["entityTypes"]):
        f.append("no_collections")
    if brief["labels"]["source"] != "profile_config":
        f.append("no_labels")
    return f


LISTING_RING = "location"


def _is_listing_collection(c: dict) -> bool:
    return len(c["rings"]) > 0 and all(r == LISTING_RING for r in c["rings"])


def entity_brief_for_office(brief: dict, mode: str | None, entity_type: str | None = None
                            ) -> dict | None:
    """Office-mode-aware view: in single_pro mode act as professional, list as location."""
    pro = entity_brief(brief, "professional")
    loc = entity_brief(brief, "location")
    single = mode == "single_pro" and bool(pro) and bool(loc)
    act = pro if single else entity_brief(brief, entity_type)
    lst = loc if single else act
    if not act or not lst:
        return None

    def tag(e: dict, c: dict) -> dict:
        return {**c, "sourceEntityType": e["type"]}

    listing = [tag(lst, c) for c in lst["collections"] if _is_listing_collection(c)]
    if single:
        collections = [tag(act, c) for c in act["collections"]
                       if not _is_listing_collection(c)] + listing
    else:
        collections = [tag(act, c) for c in act["collections"]]
    return {
        "mode": mode,
        "singlePro": single,
        "actAs": act["type"],
        "listAs": lst["type"],
        "identityKeys": act["identityKeys"],
        "formFields": act["formFields"],
        "claim": {**act["claim"], "listingKeys": lst["identityKeys"],
                  "listingEntityType": lst["type"]},
        "napKeys": lst["identityKeys"],
        "collections": collections,
        "listingCollections": listing,
    }
