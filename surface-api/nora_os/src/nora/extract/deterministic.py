"""Deterministic pass (no model) — port of lib/nora/extract/deterministic.ts.

JSON-LD properties → registry nodes by schema_property, sameAs → presence nodes, credentials →
hasCredential nodes (+ the brief's credential identity key), NAP → identity nodes. Only
properties the category brief models are kept — the brief drives everything.

A Fact is a dict: prop, value, hint, evidence, confidence, method, item?, extra?.
"""
from __future__ import annotations

import json
from typing import Any

from surfaces.nora_os.nora.extract.match import (
    base_prop,
    host_tokens,
    match_vocabulary,
    node_type_for,
    resolve_node,
    tokens,
)

CONF = {"jsonld": 0.9, "sameAs": 0.9, "nap": 0.85, "credential": 0.8}

# Structural web types that never describe the entity itself.
NON_ENTITY_TYPES = frozenset(
    {
        "WebPage", "WebSite", "BreadcrumbList", "ListItem", "SearchAction", "ReadAction",
        "ImageObject", "VideoObject", "SiteNavigationElement", "WPHeader", "WPFooter",
        "CollectionPage", "AboutPage", "ContactPage", "FAQPage", "Question", "Answer",
        "Article", "BlogPosting", "NewsArticle", "ItemList", "EntryPoint",
    }
)


def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def _arr(v: Any) -> list:
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _num_str(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def _str(v: Any) -> str | None:
    if isinstance(v, str) and v.strip():
        return v.strip()
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return _num_str(v)
    return None


def _types(o: dict) -> list[str]:
    return [t for t in _arr(o.get("@type")) if isinstance(t, str)]


def _clip(s: str, n: int = 280) -> str:
    return f"{s[:n]}…" if len(s) > n else s


def _js_json(v: Any) -> str:
    """JSON.stringify (compact, no ASCII escaping)."""
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def _ev(prop: str, frag: Any) -> str:
    return _clip(f"JSON-LD {prop}: {_js_json(frag)}")


def entity_objects(jsonld: list) -> list[dict]:
    """Entity objects in a page's JSON-LD (flattens @graph, skips structural web types)."""
    out: list[dict] = []

    def visit(v: Any) -> None:
        for x in _arr(v):
            if not _is_obj(x):
                continue
            if x.get("@graph"):
                visit(x["@graph"])
            t = _types(x)
            if t and all(y in NON_ENTITY_TYPES for y in t):
                continue
            if t:
                out.append(x)

    visit(jsonld)
    return out


def _format_address(v: Any) -> str | None:
    if isinstance(v, str):
        return _str(v)
    if not _is_obj(v):
        return None
    region_zip = " ".join(x for x in (_str(v.get("addressRegion")), _str(v.get("postalCode"))) if x)
    country = v.get("addressCountry")
    parts = [
        v.get("streetAddress"),
        v.get("addressLocality"),
        region_zip,
        country if country and isinstance(country, str) else None,
    ]
    out = [s for s in (_str(p) for p in parts) if s]
    return ", ".join(out) if out else None


def _price_of(o: dict) -> str | None:
    for off in _arr(o.get("offers")):
        if not _is_obj(off):
            continue
        p = _str(off.get("price"))
        if p:
            cur = off.get("priceCurrency")
            dollar = "$" if _str(cur) == "USD" or not cur else ""
            return f"{dollar}{p}"
    return _str(o.get("price"))


def _scalar(prop: str, v: Any) -> str | None:
    """Summarise a nested value for a single-valued property."""
    if base_prop(prop) == "address":
        return _format_address(v)
    if _is_obj(v):
        if base_prop(prop) == "geo" and v.get("latitude") is not None and v.get("longitude") is not None:
            return f"{_js_template(v['latitude'])},{_js_template(v['longitude'])}"
        for k in ("name", "url", "text", "@id"):
            s = _str(v.get(k))
            if s is not None:
                return s
        return None
    return _str(v)


def _js_template(v: Any) -> str:
    """`${v}` for a JSON scalar."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return _num_str(v)
    return str(v)


def _fact(prop: str, value: str, hint: list[str], evidence: str, confidence: float, **kw: Any) -> dict:
    f = {
        "prop": prop,
        "value": value,
        "hint": hint,
        "evidence": evidence,
        "confidence": confidence,
        "method": "deterministic",
    }
    f.update(kw)
    return f


def _menu_facts(prop: str, menu: Any) -> list[dict]:
    facts: list[dict] = []

    def walk(node: Any, section: str | None) -> None:
        for x in _arr(node):
            if isinstance(x, str):
                # hasMenu as a URL: a single menu link, not an item.
                facts.append(_fact(prop, x, tokens("menu"), _ev(prop, x), CONF["jsonld"]))
                continue
            if not _is_obj(x):
                continue
            t = _types(x)
            sec = (_str(x.get("name")) or section) if "MenuSection" in t else section
            if x.get("hasMenuSection"):
                walk(x["hasMenuSection"], sec)
            if x.get("hasMenuItem"):
                walk(x["hasMenuItem"], sec)
            if "MenuItem" in t or (
                not t and x.get("name") and not x.get("hasMenuItem") and not x.get("hasMenuSection")
            ):
                name = _str(x.get("name"))
                if not name:
                    continue
                facts.append(
                    _fact(
                        "hasMenuItem",
                        name,
                        tokens(name),
                        _ev("hasMenuItem", x),
                        CONF["jsonld"],
                        item={
                            "name": name,
                            "price": _price_of(x),
                            "section": sec,
                            "description": _str(x.get("description")),
                        },
                    )
                )

    walk(menu, None)
    return facts


def _offer_facts(prop: str, v: Any) -> list[dict]:
    facts: list[dict] = []

    def walk(x: Any) -> None:
        for o in _arr(x):
            if isinstance(o, str):
                facts.append(
                    _fact(prop, o, tokens(o), _ev(prop, o), CONF["jsonld"], item={"name": o})
                )
                continue
            if not _is_obj(o):
                continue
            if o.get("itemListElement"):
                walk(o["itemListElement"])
                continue
            if _is_obj(o.get("itemOffered")):
                inner = o["itemOffered"]
            elif _is_obj(o.get("item")):
                inner = o["item"]
            else:
                inner = o
            name = _str(inner.get("name")) or _str(o.get("name"))
            if not name:
                continue
            facts.append(
                _fact(
                    prop,
                    name,
                    tokens(name),
                    _ev(prop, o),
                    CONF["jsonld"],
                    item={
                        "name": name,
                        "price": _price_of(o),
                        "description": _str(inner.get("description")) or _str(o.get("description")),
                    },
                )
            )

    walk(v)
    return facts


def _credential_fact(c: dict, evidence: str, confidence: float) -> list[dict]:
    issuer = c.get("issuer")
    valid_in = c.get("validIn")
    identifier = c.get("identifier")
    facts = [
        _fact(
            "hasCredential",
            c["text"],
            tokens(f"{c['text']} {issuer if issuer is not None else ''}"),
            evidence,
            confidence,
            item={"name": c["text"]},
            extra={"identifier": identifier, "issuer": issuer, "valid_in": valid_in},
        )
    ]
    if identifier:
        facts.append(
            _fact(
                "hasCredential.identifier",
                identifier,
                tokens(f"{c['text']} identifier number"),
                evidence,
                confidence,
                extra={"credential": c["text"], "issuer": issuer, "valid_in": valid_in},
            )
        )
    return facts


def deterministic_facts(page: dict) -> list[dict]:
    """All deterministic facts on one page (before brief resolution)."""
    facts: list[dict] = []
    for o in entity_objects(page.get("jsonld") or []):
        for prop, v in o.items():
            if prop.startswith("@") or v is None:
                continue
            if prop in ("hasMenu", "menu", "hasMenuSection", "hasMenuItem"):
                facts.extend(_menu_facts(prop, v))
            elif prop in ("makesOffer", "hasOfferCatalog", "availableService"):
                facts.extend(_offer_facts(prop, v))
            elif prop == "sameAs":
                for u in (s for s in (_str(x) for x in _arr(v)) if s):
                    facts.append(_fact(prop, u, host_tokens(u), _ev(prop, u), CONF["jsonld"]))
            elif prop in ("hasCredential", "hasCertification"):
                for c in _arr(v):
                    if _is_obj(c):
                        text = _str(c.get("name")) or _str(c.get("credentialCategory"))
                    else:
                        text = _str(c)
                    if not text:
                        continue
                    ident = None
                    issuer = None
                    valid_in = None
                    if _is_obj(c):
                        ident = _str(c.get("identifier"))
                        if ident is None and _is_obj(c.get("identifier")):
                            ident = _str(c["identifier"].get("value"))
                        if _is_obj(c.get("recognizedBy")):
                            issuer = _str(c["recognizedBy"].get("name"))
                        if _is_obj(c.get("validIn")):
                            valid_in = _str(c["validIn"].get("name"))
                    facts.extend(
                        _credential_fact(
                            {"text": text, "identifier": ident, "issuer": issuer, "validIn": valid_in},
                            _ev(prop, c),
                            CONF["jsonld"],
                        )
                    )
            else:
                for x in _arr(v):
                    value = _scalar(prop, x)
                    if not value:
                        continue
                    facts.append(
                        _fact(prop, value, tokens(f"{prop} {value}"), _ev(prop, x), CONF["jsonld"])
                    )
    for s in page.get("sameAs") or []:
        u = _str(s.get("url"))
        if u:
            via = "page link" if s.get("via") == "page_link" else "JSON-LD sameAs"
            facts.append(
                _fact(
                    "sameAs",
                    u,
                    [*host_tokens(u), *tokens(s.get("platform"))],
                    f"{via}: {u}",
                    CONF["sameAs"],
                )
            )
    # JSON-LD credentials were read above; organize's page-text credentials add the rest.
    for c in page.get("credentials") or []:
        if c.get("via") != "jsonld_hasCredential" and _str(c.get("text")):
            parsed = c.get("parsed") or {}
            facts.extend(
                _credential_fact(
                    {
                        "text": c["text"],
                        "identifier": parsed.get("number"),
                        "issuer": parsed["issuer"]
                        if parsed.get("issuer") is not None
                        else c.get("label"),
                        "validIn": parsed.get("state"),
                    },
                    _clip(c["text"]),
                    CONF["credential"],
                )
            )
    nap = page.get("nap") or {}
    addr = nap.get("address")
    nap_parts = [
        ("name", _str(nap.get("name"))),
        (
            "address",
            (_format_address(addr) or _str(addr.get("text"))) if addr else None,
        ),
        ("telephone", _str(nap.get("phone"))),
    ]
    for prop, value in nap_parts:
        if value:
            facts.append(
                _fact(prop, value, tokens(prop), f"NAP {prop}: {value}", CONF["nap"])
            )
    return facts


def to_proposal(eb: dict, fact: dict, page: dict, resolved: dict | None = None) -> dict | None:
    """Turn one fact into a ProposedNode against the entity brief (None = not modelled)."""
    r = resolved or resolve_node(eb, fact["prop"], fact["hint"])
    if not r:
        return None
    node, collection = r["node"], r["collection"]
    cardinality = (node or {}).get("cardinality") or (collection or {}).get("cardinality") or "one"
    in_collection = collection if cardinality != "one" and collection else None
    vocab = (in_collection or {}).get("vocabulary") or []
    item = fact.get("item")
    proposed = (item or {}).get("vocabulary_term")
    vocabulary_term = proposed if proposed and proposed in vocab else None
    if vocabulary_term is None:
        vocabulary_term = (
            match_vocabulary((item or {}).get("name") or fact["value"], vocab) if vocab else None
        )
    schema_property = node["schemaProperty"] if node and node.get("schemaProperty") is not None else r["tier"]
    extracted: dict[str, Any] = {"value": fact["value"]}
    if item:
        extracted.update(
            {
                "name": item["name"],
                "price": item.get("price"),
                "section": item.get("section"),
                "description": item.get("description"),
            }
        )
    extracted.update(fact.get("extra") or {})
    extracted.update(
        {
            "collection": (in_collection or {}).get("key"),
            "vocabulary_term": vocabulary_term,
            "found_under": fact["prop"],
        }
    )
    ring = (node or {}).get("ring")
    if ring is None and in_collection and in_collection["rings"]:
        ring = in_collection["rings"][0]
    return {
        "registry_node_id": (node or {}).get("nodeId"),
        "registry_node_slug": (node or {}).get("nodeSlug"),
        "node_type": node_type_for(fact["prop"]),
        "schema_property": schema_property,
        "ring": ring,
        "title": (item or {}).get("name") or fact["value"],
        "value": fact["value"],
        "extracted_data": extracted,
        "source_url": page["source_url"],
        "fetched_at": page["fetched_at"],
        "confidence": min(1, fact["confidence"] + 0.1)
        if vocabulary_term and fact["method"] == "haiku"
        else fact["confidence"],
        "method": fact["method"],
        "evidence": fact["evidence"],
        "cardinality_group": {
            "collection": (in_collection or {}).get("key"),
            "cardinality": in_collection["cardinality"] if in_collection else "one",
            "vocabulary_term": vocabulary_term,
        },
    }
