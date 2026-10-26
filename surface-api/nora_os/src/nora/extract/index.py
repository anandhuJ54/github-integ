"""Category-aware extractor (port of lib/nora/extract/index.ts).

Everything category-specific comes from the CategoryBrief (collections, cardinality + expected
counts, vocabulary): there is no per-category code. Order: deterministic mapping first; then ONE
Haiku call per page, only for collections the deterministic pass left empty; every Haiku value
must quote page text or it is dropped.
"""
from __future__ import annotations

from collections.abc import Callable

from surfaces.nora_os.internal.category_brief import entity_brief
from surfaces.nora_os.nora.extract.deterministic import deterministic_facts, to_proposal
from surfaces.nora_os.nora.extract.match import (
    item_prop_for,
    normalize_value,
    resolve_node,
    squash,
    tokens,
)

# Connection methods whose facts can appear on the entity's own web pages.
PAGE_OBSERVABLE = frozenset({"manual", "etl"})
CONF_HAIKU = 0.6

# Injectable model call: one call per page → {collection key: [LlmItem]}.
LlmExtractFn = Callable[[dict], dict]

__all__ = [
    "deterministic_facts",
    "extract_facts",
    "graph_entity_type",
    "llm_collections",
    "merge_proposals",
    "validate_llm_items",
]


def _page_text(p: dict) -> str:
    return squash("\n".join(b["text"] for b in p["text"]))


def llm_collections(collections: list[dict], filled: set[str]) -> list[dict]:
    """Collections worth asking the model for on this page."""
    return [
        {
            "key": c["key"],
            "label": c["label"],
            "cardinality": c["cardinality"],
            "expected": c["expectedCount"],
            "vocabulary": c["vocabulary"],
        }
        for c in collections
        if c["key"] not in filled and any(m in PAGE_OBSERVABLE for m in c["connectionMethods"])
    ]


def validate_llm_items(page: dict, collection: dict, items: list[dict]) -> tuple[list[dict], list[dict]]:
    """Keep only items whose evidence is verbatim page text and whose name is inside it.

    Returns (kept, rejected) — the TS {kept, rejected}.
    """
    text = _page_text(page)
    kept: list[dict] = []
    rejected: list[dict] = []

    def on_page(s: str | None) -> str | None:
        return s if s and squash(s) in text else None

    for it in items[: collection["expectedCount"]["max"]]:
        name = (it.get("name") or "").strip()
        evidence = squash(it.get("evidence") or "")
        if not name:
            continue
        if len(evidence) < 3 or evidence not in text:
            rejected.append({"name": name, "reason": "evidence not found in page text"})
            continue
        if squash(name) not in evidence:
            rejected.append({"name": name, "reason": "name not inside its evidence"})
            continue
        price = it.get("price")
        vt = it.get("vocabulary_term")
        kept.append(
            {
                "name": name,
                "evidence": it["evidence"].strip(),
                "price": price if price and squash(price) in evidence else None,
                "detail": on_page(it.get("detail")),
                "section": on_page(it.get("section")),
                "vocabulary_term": vt if vt and vt in collection["vocabulary"] else None,
            }
        )
    return kept, rejected


def merge_proposals(all_: list[dict]) -> tuple[list[dict], list[dict]]:
    """Dedupe proposals and split single-valued nodes with several values into conflicts.

    Returns (nodes, conflicts).
    """

    def group_key(p: dict) -> str:
        slug = p["registry_node_slug"]
        return slug if slug is not None else f"{p['node_type']}:{p['schema_property']}"

    best: dict[str, dict] = {}
    for p in all_:
        coll = p["cardinality_group"]["collection"]
        k = f"{group_key(p)}|{coll if coll is not None else ''}|" + normalize_value(
            p["schema_property"], p["value"]
        )
        cur = best.get(k)
        if cur is None or p["confidence"] > cur["confidence"]:
            best[k] = p
    ones: dict[str, list[dict]] = {}
    nodes: list[dict] = []
    for p in best.values():
        if p["cardinality_group"]["cardinality"] != "one":
            nodes.append(p)
            continue
        ones.setdefault(group_key(p), []).append(p)
    conflicts: list[dict] = []
    for key, ps in ones.items():
        if len(ps) == 1:
            nodes.append(ps[0])
            continue
        top = ps[0]
        conflicts.append(
            {
                "key": key,
                "registry_node_id": top["registry_node_id"],
                "registry_node_slug": top["registry_node_slug"],
                "node_type": top["node_type"],
                "schema_property": top["schema_property"],
                "candidates": [
                    {
                        "value": p["value"],
                        "evidence": p["evidence"],
                        "source_url": p["source_url"],
                        "method": p["method"],
                        "confidence": p["confidence"],
                    }
                    for p in sorted(ps, key=lambda p: -p["confidence"])
                ],
            }
        )
    return nodes, conflicts


def extract_facts(
    *, brief: dict, pages: list[dict], entity_type: str | None = None, llm: LlmExtractFn | None = None
) -> dict:
    """ExtractResult: {gcid, entity_type, nodes, conflicts, llm_requested, rejected, stats}."""
    eb = entity_brief(brief, entity_type)
    if not eb:
        raise ValueError(f"category {brief['gcid']} has no entity type {_js(entity_type)}")
    proposals: list[dict] = []
    stats = {"deterministic": 0, "haiku": 0, "pages": len(pages), "llm_calls": 0}

    for page in pages:
        for f in deterministic_facts(page):
            p = to_proposal(eb, f, page)
            if p:
                proposals.append(p)
    stats["deterministic"] = len(proposals)

    filled = {p["cardinality_group"]["collection"] for p in proposals if p["cardinality_group"]["collection"]}
    requested = llm_collections(eb["collections"], filled)
    rejected: list[dict] = []

    if llm and requested:
        for page in pages:
            if page.get("blocked") or not any(b["text"].strip() for b in page["text"]):
                continue
            stats["llm_calls"] += 1
            out = llm({"page": page, "categoryName": brief["displayName"], "collections": requested})
            for req in requested:
                collection = next(c for c in eb["collections"] if c["key"] == req["key"])
                kept, rej = validate_llm_items(page, collection, out.get(req["key"]) or [])
                rejected.extend({"collection": req["key"], **r} for r in rej)
                prop = item_prop_for(collection)
                for it in kept:
                    fact = {
                        "prop": prop,
                        "value": it["name"],
                        "hint": tokens(it["name"]),
                        "evidence": it["evidence"],
                        "confidence": CONF_HAIKU,
                        "method": "haiku",
                        "item": {
                            "name": it["name"],
                            "price": it["price"],
                            "section": it["section"],
                            "description": it["detail"],
                            "vocabulary_term": it["vocabulary_term"],
                        },
                    }
                    p = to_proposal(eb, fact, page, resolve_node(eb, prop, fact["hint"], collection))
                    if p:
                        proposals.append(p)
                        stats["haiku"] += 1

    nodes, conflicts = merge_proposals(proposals)
    return {
        "gcid": brief["gcid"],
        "entity_type": eb["type"],
        "nodes": nodes,
        "conflicts": conflicts,
        "llm_requested": [r["key"] for r in requested],
        "rejected": rejected,
        "stats": stats,
    }


def _js(v: object) -> str:
    return "undefined" if v is None else str(v)


def graph_entity_type(brief_type: str) -> str:
    """Brief entity type → graph_nodes.entity_type (professional | organization)."""
    return "professional" if brief_type == "professional" else "organization"
