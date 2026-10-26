"""Facet groups and per-result enrichments for search results.

Port of legacy `lib/search-presentation.server.ts`. Public (anon) reads only; graph tables
are read, never written.
"""
from __future__ import annotations

from typing import Any

from surfaces.search.pg import safe

from _base.db.session import role_connection


def _label_for(item: Any) -> str | None:
    if isinstance(item, bool):
        return None
    if isinstance(item, (str, int, float)):
        text = _js_str(item).strip()
        return text or None
    if not isinstance(item, dict):
        return None
    candidate = None
    for key in ("label", "name", "value", "title"):
        if item.get(key) is not None:
            candidate = item[key]
            break
    if isinstance(candidate, (str, int, float)) and not isinstance(candidate, bool):
        return _js_str(candidate).strip() or None
    return None


def _js_str(value: Any) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def strings(value: Any) -> list[str]:
    """Option labels from a jsonb value_options (array, or object of label/name/value)."""
    if isinstance(value, list):
        values: list[Any] = value
    elif isinstance(value, dict):
        values = [_label_for(item) or key for key, item in value.items()]
    else:
        values = []
    return [s for s in (_label_for(v) for v in values) if s][:8]


def group_facets(facet_rows: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for row in facet_rows:
        group = str(row.get("facet_group") or "").strip() or "More filters"
        grouped.setdefault(group, []).append(
            {
                "attributeId": row.get("attribute_id"),
                "label": str(row.get("facet_label") or "").strip() or row.get("attribute_id"),
                "options": strings(row.get("value_options")),
            }
        )
    return [{"name": name, "facets": facets} for name, facets in grouped.items()]


def collect_tags(node_rows: list[dict]) -> dict[str, list[str]]:
    by_entity: dict[str, list[str]] = {}
    for row in node_rows:
        value = str(row.get("title") or "").strip()
        if not value:
            continue
        key = str(row.get("entity_id"))
        tags = by_entity.get(key, [])
        if not any(t.lower() == value.lower() for t in tags):
            tags.append(value)
        by_entity[key] = tags[:4]
    return by_entity


def load_search_presentation(gcid: str | None, results: list[dict]) -> dict:
    with role_connection("anon") as conn:
        facet_rows = (
            safe(
                conn,
                "select attribute_id, facet_group, facet_label, value_options "
                "from exp_search_facets_v where gcid = %s",
                [gcid],
                [],
            )
            if gcid
            else []
        )

        quotes: dict[str, str | None] = {}
        for doc in results[:20]:
            entity_type = "professional" if doc["entity_type"] == "professional" else "organization"
            found = safe(
                conn,
                "select body from reviews where entity_type = %s and entity_id = %s "
                "and body is not null order by is_verified desc, review_date desc limit 1",
                [entity_type, doc["entity_id"]],
                [],
            )
            body = found[0].get("body") if found else None
            quotes[doc["id"]] = (str(body).strip() or None) if body else None

        enrichments: dict[str, dict] = {
            doc["id"]: {"reviewQuote": None, "tags": []} for doc in results
        }
        for doc_id, quote in quotes.items():
            if doc_id in enrichments:
                enrichments[doc_id] = {**enrichments[doc_id], "reviewQuote": quote}

        if gcid and results:
            map_rows = safe(
                conn,
                "select attribute_id, node_slug from exp_registry_attribute_map where gcid = %s",
                [gcid],
                [],
            )
            facet_ids = {r.get("attribute_id") for r in facet_rows}
            slugs = [r["node_slug"] for r in map_rows if r.get("attribute_id") in facet_ids]
            if slugs:
                registry = safe(
                    conn,
                    "select id, node_slug from exp_vertical_node_registry "
                    "where gcid = %s and node_slug = any(%s)",
                    [gcid, slugs],
                    [],
                )
                node_ids = [str(r["id"]) for r in registry]
                if node_ids:
                    entity_ids = [str(d["entity_id"]) for d in results[:20]]
                    nodes = safe(
                        conn,
                        "select entity_id, node_registry_id, title from graph_nodes "
                        "where entity_id = any(%s) and node_registry_id = any(%s) "
                        "and is_active = true and title is not null limit 200",
                        [entity_ids, node_ids],
                        [],
                    )
                    by_entity = collect_tags(nodes)
                    for doc in results:
                        if doc["id"] in enrichments:
                            enrichments[doc["id"]] = {
                                **enrichments[doc["id"]],
                                "tags": by_entity.get(str(doc["entity_id"]), []),
                            }

    return {"facetGroups": group_facets(facet_rows), "enrichments": enrichments}
