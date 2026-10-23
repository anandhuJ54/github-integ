"""Pure matching helpers shared by the deterministic pass and Haiku validation (port of
lib/nora/extract/match.ts). Nothing here knows a category: properties carry schema.org meaning,
and node / vocabulary matching is token overlap against the brief's own data.
"""
from __future__ import annotations

import functools
import re

from nora_os.nora.organize.parse import _split


def base_prop(p: str | None) -> str:
    return p.split(".")[0] if p else ""


# graph_nodes.node_type by schema.org property — the generic node types the graph already uses.
NODE_TYPE = {
    "name": "identity_name",
    "legalName": "identity_name",
    "alternateName": "identity_alias",
    "telephone": "contact_phone",
    "faxNumber": "contact_fax",
    "email": "contact_email",
    "address": "address",
    "geo": "geo",
    "url": "website",
    "sameAs": "social_profile",
    "description": "bio",
    "logo": "image_logo",
    "image": "image_photo",
    "photo": "image_photo",
    "hasCredential": "credential",
    "hasCertification": "credential",
    "award": "award",
    "makesOffer": "product_service",
    "hasOfferCatalog": "product_service",
    "availableService": "product_service",
    "hasMenu": "menu_item",
    "menu": "menu_item",
    "hasMenuItem": "menu_item",
    "hasMenuSection": "menu_item",
    "review": "review",
    "aggregateRating": "review_aggregate",
    "areaServed": "service_area",
    "openingHoursSpecification": "office_hours",
    "employee": "team_member",
    "knowsLanguage": "language",
    "memberOf": "membership",
}


def node_type_for(schema_property: str) -> str:
    bp = base_prop(schema_property)
    if bp in NODE_TYPE:
        return NODE_TYPE[bp]
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", bp)
    return re.sub(r"[^a-zA-Z0-9]+", "_", s).lower()


_MENU_CHAIN = ["hasMenuItem", "menu", "hasMenu", "hasMenuSection", "makesOffer", "hasOfferCatalog"]
_OFFER_CHAIN = ["makesOffer", "hasOfferCatalog", "availableService", "hasMenu", "menu"]
PROPERTY_CHAIN: dict[str, list[str]] = {
    "hasMenuItem": _MENU_CHAIN,
    "hasMenuSection": _MENU_CHAIN,
    "hasMenu": ["hasMenu", "menu", *_MENU_CHAIN],
    "menu": ["menu", "hasMenu", *_MENU_CHAIN],
    "makesOffer": _OFFER_CHAIN,
    "hasOfferCatalog": ["hasOfferCatalog", *_OFFER_CHAIN],
    "availableService": ["availableService", *_OFFER_CHAIN],
    "hasCredential": ["hasCredential", "hasCertification", "award"],
    "hasCertification": ["hasCertification", "hasCredential", "award"],
    "award": ["award", "awards", "hasCredential"],
    "legalName": ["legalName", "name"],
    "photo": ["photo", "image"],
    "image": ["image", "photo"],
}


def chain_for(prop: str) -> list[str]:
    return list(dict.fromkeys(PROPERTY_CHAIN.get(prop, [prop])))


STOP = frozenset(
    {
        "a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "by", "at", "or",
        "url", "profile", "page", "node", "fallback", "listing", "service", "services", "offer",
        "www", "com", "net", "org", "co", "io", "https", "http", "html", "us",
    }
)
# Short host labels → the name registries use for them.
HOST_ALIAS = {"x": "twitter", "fb": "facebook", "g": "google"}


def tokens(s: str | None) -> list[str]:
    if not s:
        return []
    # (the TS lowercases first, so its camelCase split never fires; kept identical)
    low = s.lower()
    low = re.sub(r"([a-z])([A-Z])", r"\1 \2", low)
    out = []
    for t in re.split(r"[^a-z0-9]+", low):
        t = HOST_ALIAS.get(t, t)
        if len(t) > 1 and t not in STOP:
            out.append(t)
    return out


def host_tokens(url: str) -> list[str]:
    """Host labels of a URL ("https://www.facebook.com/x" → ["facebook"])."""
    u = _split(url)
    if u is None:
        return []
    h = re.sub(r"^www\.", "", (u.hostname or "")).split(".")
    return tokens(" ".join(h[: max(1, len(h) - 1)]))


def _node_match(node: dict, hint: set[str]) -> float:
    nt = set(tokens(node["nodeSlug"])) | set(tokens(node["nodeName"]))
    if not nt or not hint:
        return 0
    return sum(1 for t in nt if t in hint) / len(nt)


def _locale_cmp(a: str, b: str) -> int:
    ka, kb = (a.lower(), a), (b.lower(), b)
    return (ka > kb) - (ka < kb)


def _by_value(a: dict, b: dict) -> int:
    return (
        (int(b["requiredForScore"]) - int(a["requiredForScore"]))
        or _sign(b["scorePoints"] - a["scorePoints"])
        or _sign(a["priority"] - b["priority"])
        or _locale_cmp(a["nodeSlug"], b["nodeSlug"])
    )


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


_BY_VALUE = functools.cmp_to_key(_by_value)


def resolve_node(
    eb: dict, prop: str, hint: list[str] | None = None, within: dict | None = None
) -> dict | None:
    """Registry node for a fact found under `prop` → {node, collection, tier} or None.

    Walks the property chain; within the first tier that has nodes, picks the node whose own
    name the hint covers (≥ 50%). When nothing matches: a single-valued tier takes its most
    valuable node; a list tier with several nodes leaves the node unresolved (None).
    """
    h = set(hint or [])
    pool = [n for n in eb["nodes"] if n["nodeSlug"] in within["nodeSlugs"]] if within else eb["nodes"]
    for tier in chain_for(prop):
        exact = [n for n in pool if n["schemaProperty"] == tier]
        cands = exact or [n for n in pool if base_prop(n["schemaProperty"]) == tier]
        if not cands:
            continue
        ranked = sorted(cands, key=_BY_VALUE)
        best, best_score = None, 0.0
        for n in ranked:
            s = _node_match(n, h)
            if s >= 0.5 and s > best_score:
                best, best_score = n, s
        node = best
        if node is None and (len(cands) == 1 or all(n["cardinality"] == "one" for n in cands)):
            node = ranked[0]
        collection = within
        if not collection and node:
            collection = next(
                (c for c in eb["collections"] if node["nodeSlug"] in c["nodeSlugs"]), None
            )
        if not collection:
            collection = next(
                (
                    c
                    for c in eb["collections"]
                    if any(n["nodeSlug"] in c["nodeSlugs"] for n in cands)
                ),
                None,
            )
        return {"node": node, "collection": collection, "tier": tier}
    return {"node": None, "collection": within, "tier": within["schemaProperty"]} if within else None


_MENU_PROPS = frozenset({"hasMenu", "menu", "hasMenuItem", "hasMenuSection"})


def item_prop_for(c: dict) -> str:
    """Property a single collection item is filed under (schema.org meaning, not category)."""
    if any(base_prop(p) in _MENU_PROPS for p in c["schemaProperties"]):
        return "hasMenuItem"
    return c["schemaProperty"]


def match_vocabulary(name: str, vocabulary: list[str]) -> str | None:
    """Vocabulary term an item name matches: one token set contains the other; best Jaccard."""
    it = set(tokens(name))
    if not it:
        return None
    best, best_j = None, 0.0
    for term in vocabulary:
        tt = set(tokens(term))
        if not tt:
            continue
        inter = len([t for t in it if t in tt])
        if not (inter == len(it) or inter == len(tt)):
            continue
        j = inter / len(it | tt)
        if j > best_j:
            best, best_j = term, j
    return best


def normalize_value(schema_property: str, value: str) -> str:
    """Normalised comparison key: phones by last 10 digits, everything else alnum-lowercase."""
    bp = base_prop(schema_property)
    if bp in ("telephone", "faxNumber"):
        d = re.sub(r"\D", "", value)
        return d[-10:] if len(d) >= 10 else d
    if bp in ("url", "sameAs"):
        return re.sub(r"/+$", "", re.sub(r"^https?://(www\.)?", "", value.lower()))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower()).strip()
