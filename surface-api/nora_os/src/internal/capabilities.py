"""Capability implementations — exp_capability_registry.key → handler (port of
lib/nora-capabilities.server.ts).

Only capabilities with a real implementation appear here. Anything absent makes the runner
return verdict "not_implemented"; nothing is ever faked. Handlers receive the caller's Db
(RLS-scoped for the console, service role for the claim gate) and declare read_only honestly:
the runner only calls read-only handlers in a dry run (and double-checks the registry's
side_effects).
"""
from __future__ import annotations

import os
from typing import Any

from surfaces.nora_os.internal.category_brief import (
    compile_category_brief,
    load_category_brief_rows,
)
from surfaces.nora_os.internal.db import Db
from surfaces.nora_os.internal.jsutil import js_number, nz
from surfaces.nora_os.internal.runner import CapabilityHandler, HandlerContext, HandlerRegistry
from surfaces.nora_os.internal.runner_server import is_uuid
from surfaces.nora_os.nora.claim_capabilities import claim_capability_handlers
from surfaces.nora_os.nora.extract.haiku import haiku_extractor
from surfaces.nora_os.nora.extract.index import extract_facts, graph_entity_type
from surfaces.nora_os.nora.graph_upsert import GRAPH_SOURCES, TRUST_TIERS, upsert_graph_nodes
from surfaces.nora_os.nora.organize.handlers import organize_handlers

NODE_CAP = 5000
COMPSET_CAP = 25


def _str(v: Any) -> str | None:
    return v.strip() if isinstance(v, str) and v.strip() else None


def pages_from(inputs: dict[str, Any], prior: dict[str, Any]) -> list[dict]:
    """Pages come from inputs.pages, else from the organize capabilities earlier in the run
    (page_fetch → outputs.facts, source_crawl → outputs.pages[].facts)."""
    if isinstance(inputs.get("pages"), list):
        return inputs["pages"]
    out: list[dict] = []
    pf = (prior.get("page_fetch") or {}).get("facts")
    if pf:
        out.append(pf)
    for p in (prior.get("source_crawl") or {}).get("pages") or []:
        if p.get("facts"):
            out.append(p["facts"])
    return out


def capability_handlers(db: Db | None) -> HandlerRegistry:
    def graph_query(ctx: HandlerContext) -> dict:
        """Read the entity's expertise-graph footprint from graph_nodes (by ring, verified, active)."""
        entity = ctx.entity
        if not entity or not is_uuid(entity.ref):
            raise ValueError("graph_query needs a uuid entity reference")
        sql = (
            "select ring, ring_key, node_type, verified, is_active, score_counted"
            " from graph_nodes where entity_id = %s"
        )
        params: list[Any] = [entity.ref]
        if entity.type:
            sql += " and entity_type = %s"
            params.append(entity.type)
        sql += " limit %s"
        params.append(NODE_CAP)
        rows = db.rows(sql, tuple(params), what="graph_nodes")
        by_ring: dict[str, int] = {}
        for r in rows:
            if r.get("ring_key") is not None:
                k = r["ring_key"]
            elif r.get("ring") is not None:
                k = f"ring_{r['ring']}"
            else:
                k = "unassigned"
            by_ring[k] = by_ring.get(k, 0) + 1
        return {
            "outputs": {
                "nodes": len(rows),
                "truncated": len(rows) >= NODE_CAP,
                "active": len([r for r in rows if r.get("is_active") is not False]),
                "verified": len([r for r in rows if r.get("verified")]),
                "score_counted": len([r for r in rows if r.get("score_counted")]),
                "by_ring": by_ring,
            }
        }

    def compset_query(ctx: HandlerContext) -> dict:
        """Competitive set from search_rank_scores: same gcid (and market when known), ranked."""
        entity = ctx.entity
        if not entity or not is_uuid(entity.ref):
            raise ValueError("compset_query needs a uuid entity reference")
        cols = "entity_id, entity_type, gcid, local_market, total_score"
        me = db.maybe_one(
            f"select {cols} from search_rank_scores where entity_id = %s"
            " order by calculated_at desc limit 1",
            (entity.ref,),
            what="search_rank_scores",
        )
        if not me:
            return {"outputs": {"scored": False, "reason": "entity has no Search Rank Score"}}
        if not me.get("gcid"):
            return {"outputs": {"scored": True, "reason": "entity has no gcid — no category set"}}
        sql = f"select {cols} from search_rank_scores where gcid = %s"
        params: list[Any] = [me["gcid"]]
        if me.get("local_market"):
            sql += " and local_market = %s"
            params.append(me["local_market"])
        sql += " order by total_score desc limit %s"
        params.append(COMPSET_CAP)
        peers = db.rows(sql, tuple(params), what="search_rank_scores")
        set_ = list(peers)
        if not any(p["entity_id"] == me["entity_id"] for p in set_):
            set_.append(me)
        set_.sort(key=lambda p: -js_number(nz(p.get("total_score"), 0)))
        ids = [p["entity_id"] for p in set_]
        names: dict[str, str] = {}
        try:  # the TS read `nm.data ?? []` without checking the error
            nm = db.rows(
                "select entity_id, display_name from exp_entity where entity_id::text = any(%s::text[])",
                (ids,),
                what="exp_entity",
            )
        except Exception:  # noqa: BLE001
            nm = []
        for r in nm:
            if r.get("display_name"):
                names[str(r["entity_id"])] = r["display_name"]
        idx = next(i for i, p in enumerate(set_) if p["entity_id"] == me["entity_id"])

        def view(p: dict | None) -> dict | None:
            if not p:
                return None
            return {
                "entity_id": p["entity_id"],
                "entity_type": p.get("entity_type"),
                "name": names.get(p["entity_id"]),
                "total_score": p.get("total_score"),
            }

        leader = set_[0] if set_ else None
        gap = js_number(nz((leader or {}).get("total_score"), 0)) - js_number(
            nz(me.get("total_score"), 0)
        )
        return {
            "outputs": {
                "scored": True,
                "scope": {"gcid": me["gcid"], "market": me.get("local_market")},
                "set_size": len(set_),
                "truncated": len(peers) >= COMPSET_CAP,
                "rank": idx + 1,
                "score": me.get("total_score"),
                "leader": view(leader),
                "gap_to_leader": gap,
                "next_above": view(set_[idx - 1] if idx > 0 else None),
                "competitors": [view(p) for p in set_ if p["entity_id"] != me["entity_id"]],
            }
        }

    def nlp_extract(ctx: HandlerContext) -> dict:
        """Category-aware extraction: organize-step pages → ProposedNode[] + conflicts, driven by
        the category brief. Read-only. Dry run is deterministic only (no model call); live adds
        one Haiku call per page for unfilled collections."""
        entity, inputs = ctx.entity, ctx.inputs
        gcid = nz(_str(inputs.get("gcid")), entity.gcid if entity else None)
        if not gcid:
            raise ValueError("nlp_extract needs a gcid (inputs.gcid or entity.gcid)")
        pages = pages_from(inputs, ctx.prior)
        if not pages:
            raise ValueError("nlp_extract needs organized pages (inputs.pages)")
        brief = compile_category_brief(load_category_brief_rows(db, gcid))
        entity_type = nz(_str(inputs.get("entity_type")), entity.type if entity else None)
        use_model = ctx.mode != "dry_run" and inputs.get("use_model") is not False
        llm = haiku_extractor() if use_model and os.environ.get("ANTHROPIC_API_KEY") else None
        result = extract_facts(brief=brief, entity_type=entity_type, pages=pages, llm=llm)
        return {
            "outputs": {**result, "model_used": use_model and result["stats"]["llm_calls"] > 0}
        }

    def graph_upsert(ctx: HandlerContext) -> dict:
        """Governed graph write through exp_graph_upsert_nodes (idempotent, never lowers trust,
        the only path allowed to touch owner facts). Live only. Conflicted single-valued nodes
        are never written — they wait for the resolve step."""
        entity, inputs = ctx.entity, ctx.inputs
        if not entity or not is_uuid(entity.ref):
            raise ValueError("graph_upsert needs a uuid entity reference")
        extracted = ctx.prior.get("nlp_extract")
        nodes = (
            inputs["nodes"]
            if isinstance(inputs.get("nodes"), list)
            else nz((extracted or {}).get("nodes"), [])
        )
        trust = nz(_str(inputs.get("trust")), "self_declared")
        source = nz(_str(inputs.get("source")), "platform")
        if trust not in TRUST_TIERS:
            raise ValueError(f"unknown trust tier {trust}")
        if source not in GRAPH_SOURCES:
            raise ValueError(f"unknown source {source}")
        entity_type = graph_entity_type(
            nz(_str(inputs.get("entity_type")), entity.type, (extracted or {}).get("entity_type"), "")
        )
        result = upsert_graph_nodes(
            db,
            entity_type=entity_type,
            entity_id=entity.ref,
            nodes=nodes,
            gcid=nz(_str(inputs.get("gcid")), (extracted or {}).get("gcid"), entity.gcid),
            source=source,
            trust=trust,
        )
        return {
            "outputs": {
                **result,
                "held_conflicts": len(extracted["conflicts"]) if extracted else 0,
            },
            "graph_writes": [
                {"table": "graph_nodes", "id": id_, "trust": trust, "source": source}
                for id_ in result["ids"]
            ],
        }

    return {
        # Claim gate (nora/claim_capabilities.py).
        **claim_capability_handlers(db),
        # Interview step 2 "organize the internet" — source layer.
        **organize_handlers(db),
        "graph_query": CapabilityHandler(read_only=True, run=graph_query),
        "compset_query": CapabilityHandler(read_only=True, run=compset_query),
        "nlp_extract": CapabilityHandler(read_only=True, run=nlp_extract),
        "graph_upsert": CapabilityHandler(read_only=False, run=graph_upsert),
    }


# Keys with an implementation — usable without a client (governance only needs the keys).
IMPLEMENTED_CAPABILITIES = list(capability_handlers(None).keys())
