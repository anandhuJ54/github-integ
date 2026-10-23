"""Client side of the governed graph write (port of lib/nora/graph-upsert.ts).

All writes go through the DB function exp_graph_upsert_nodes (migration 0022_graph_upsert.sql):
it checks the caller, is idempotent on (entity, registry node or node_type, value hash), never
lowers trust, and is the only path allowed to change owner-confirmed facts. Nothing here writes
graph_nodes directly.
"""
from __future__ import annotations

from nora_os.db import Db

TRUST_TIERS = ("self_declared", "imported", "platform_observed", "authority_verified", "owner_verified")
GRAPH_SOURCES = ("oauth", "etl", "crm_sync", "api", "manual", "rss", "platform", "user")


def to_upsert_payload(nodes: list[dict], gcid: str | None) -> list[dict]:
    """ProposedNode[] → the jsonb array exp_graph_upsert_nodes reads."""
    return [
        {
            "value": n.get("value"),
            "title": n.get("title"),
            "node_type": n.get("node_type"),
            "schema_property": n.get("schema_property"),
            "ring": n.get("ring"),
            "registry_node_id": n.get("registry_node_id"),
            "registry_node_slug": n.get("registry_node_slug"),
            "gcid": gcid,
            "source_url": n.get("source_url"),
            "fetched_at": n.get("fetched_at"),
            "extracted_data": n.get("extracted_data"),
            "evidence": n.get("evidence"),
            "confidence": n.get("confidence"),
            "method": n.get("method"),
        }
        for n in nodes
    ]


def upsert_graph_nodes(
    db: Db,
    *,
    entity_type: str,
    entity_id: str,
    nodes: list[dict],
    gcid: str | None,
    source: str,
    trust: str,
) -> dict:
    """→ UpsertResult {inserted, updated, kept, skipped, ids, trust_tier, source}."""
    if trust not in TRUST_TIERS:
        raise ValueError(f"unknown trust tier {trust}")
    if source not in GRAPH_SOURCES:
        raise ValueError(f"unknown source {source}")
    return db.rpc(
        "exp_graph_upsert_nodes",
        {
            "p_entity_type": entity_type,
            "p_entity_id": entity_id,
            "p_nodes": to_upsert_payload(nodes, gcid),
            "p_source": source,
            "p_trust": trust,
        },
    )
