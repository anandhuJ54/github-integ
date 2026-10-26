"""execute_skill_run (lib/nora-runner.server.ts) and the capability registry, with a fake Db."""
from __future__ import annotations

import pytest

from surfaces.nora_os import capabilities as caps_mod
from surfaces.nora_os.capabilities import IMPLEMENTED_CAPABILITIES, capability_handlers
from surfaces.nora_os.runner import CapabilityHandler, HandlerContext, RunEntity
from surfaces.nora_os.runner_server import entitlement_subjects, execute_skill_run, resolve_entity
from surfaces.nora_os.testing import FakeDb, echo_insert

E = "11111111-1111-4111-8111-111111111111"
ORG = "22222222-2222-4222-8222-222222222222"
PARENT = "33333333-3333-4333-8333-333333333333"

SKILL = {
    "key": "competitor_snapshot",
    "status": "published",
    "is_active": True,
    "version": "0.1.0",
    "entity_types": ["professional"],
    "tools_used": ["graph_query", "none"],
    "autonomy": "auto",
    "model_tier": "deterministic",
    "reads_state": [],
    "requires_entitlement": None,
    "charges_money": False,
    "captures_consent": False,
    "requires_user_approval": False,
    "expected_srs_lift": 4,
    "value_prop": None,
    "price_ref": None,
    "offer_expected_points": None,
    "trial_eligible": False,
    "graph_writes": ["graph_nodes"],
}
GRAPH_CAP = {"key": "graph_query", "status": "draft", "entitlement_required": None, "side_effects": [], "dry_run": True}


def data(**o):
    d = {
        "skillKey": "competitor_snapshot",
        "entityId": E,
        "mode": "live",
        "inputs": {"x": 1},
        "trigger": "manual",
        "approval": {"approved": False, "consent": False},
    }
    d.update(o)
    return d


def reader(skill=SKILL, **extra):
    routes = [
        ("from exp_skill_registry", [skill] if skill else []),
        ("from exp_capability_registry", [GRAPH_CAP]),
        ("from search_rank_scores", [{"entity_type": "professional", "gcid": "gcid:x", "local_market": "KC"}]),
        ("from exp_entity", [{"entity_type": "professional", "display_name": "Jane"}]),
        ("select primary_org_id from professionals", [{"primary_org_id": ORG}]),
        ("select parent_org_id from organizations", lambda s, p: [{"parent_org_id": PARENT if p[0] == ORG else None}]),
        ("from exp_entitlements", []),
    ]
    return FakeDb(list(extra.items()) + routes, role="authenticated")


def writer():
    return FakeDb([("insert into exp_skill_run", echo_insert)])


def graph_handler(calls):
    def run(ctx):
        calls.append(ctx)
        return {"outputs": {"nodes": 2}}

    return {"graph_query": CapabilityHandler(read_only=True, run=run)}


def test_live_run_executes_and_writes_one_row():
    calls: list = []
    w = writer()
    run = execute_skill_run(db=reader(), writer=w, actor="u1", data=data(), handlers=graph_handler(calls))
    assert len(w.sql("insert into exp_skill_run")) == 1
    assert run["verdict"] == "executed" and run["status"] == "succeeded"
    assert run["capability_keys"] == ["graph_query"]
    assert run["entity_ref"] == E and run["entity_type"] == "professional"
    assert run["actor"] == "u1"
    assert run["inputs"] == {"x": 1, "_approval": {"approved": False, "consent": False}}
    assert run["outputs"]["capabilities"] == {"graph_query": {"nodes": 2}}
    assert run["outputs"]["governance"]["live_ready"] is True
    assert "pitch" not in run["outputs"]
    assert run["expected_srs_lift"] == 4
    assert calls[0].actor == "u1" and calls[0].entity.ref == E
    texts = [s["text"] for s in run["trace"]]
    assert texts[0] == "entity Jane · professional · via search_rank_scores · entitlement subjects 3"
    assert texts[1] == "run competitor_snapshot · live · trigger manual · safe-autonomous · free"
    assert "declared graph writes [graph_nodes] — no capability in this run persisted them" in texts
    assert texts[-1] == "verdict executed"
    assert [s["step"] for s in run["trace"]] == list(range(1, len(texts) + 1))
    t = run["telemetry"]
    assert t["model"] == "deterministic" and t["steps"][0]["capability"] == "graph_query"
    assert all(isinstance(t[k], int) for k in ("ms_total", "ms_load", "ms_governance", "ms_execution"))
    assert run["started_at"].endswith("Z") and run["finished_at"].endswith("Z")


def test_refusals_still_write_a_row():
    w = writer()
    run = execute_skill_run(db=reader(skill=None), writer=w, actor="u1", data=data(), handlers={})
    assert run["verdict"] == "blocked" and run["status"] == "blocked"
    assert run["outputs"]["governance"]["live_blockers"] == ["registered: skill competitor_snapshot is not registered"]
    assert len(w.calls) == 1


def test_dry_run_previews_read_only_when_others_unimplemented():
    calls: list = []
    skill = {**SKILL, "tools_used": ["graph_query", "compset_query"], "status": "draft"}
    r = reader(skill=skill)
    r.routes.insert(0, ("from exp_capability_registry", [GRAPH_CAP, {**GRAPH_CAP, "key": "compset_query"}]))
    run = execute_skill_run(db=r, writer=writer(), actor=None, data=data(mode="dry_run"), handlers=graph_handler(calls))
    assert run["verdict"] == "not_implemented"
    assert len(calls) == 1
    assert run["outputs"]["unimplemented"] == ["compset_query"]
    assert any(s["text"] == "compset_query — not implemented; nothing faked" for s in run["trace"])


def test_handler_failure_is_a_failed_run():
    def boom(ctx):
        raise RuntimeError("db down")

    run = execute_skill_run(
        db=reader(), writer=writer(), actor="u1", data=data(),
        handlers={"graph_query": CapabilityHandler(read_only=True, run=boom)},
    )
    assert run["verdict"] == "failed" and run["status"] == "failed"
    assert run["error"] == "graph_query: db down"


def test_pitch_is_recorded():
    paid = {**SKILL, "requires_entitlement": "voce", "expected_srs_lift": 103}
    run = execute_skill_run(db=reader(skill=paid), writer=writer(), actor="u1", data=data(), handlers={})
    assert run["verdict"] == "pitch"
    assert run["outputs"]["pitch"]["expected_lift"] == 103
    assert run["outputs"]["governance"]["live_ready"] is False


def test_entitlement_query_uses_the_org_chain():
    r = reader()
    execute_skill_run(db=r, writer=writer(), actor="u1", data=data(), handlers=graph_handler([]))
    assert r.sql("from exp_entitlements")[0][1] == ([E, ORG, PARENT],)


def test_resolve_entity_fallbacks():
    db = FakeDb([
        ("from search_rank_scores", []), ("from exp_entity", []),
        ("from professionals", []), ("from organizations", [{"name": "Acme", "gcid": "gcid:a"}]),
    ])
    e = resolve_entity(db, E)
    assert (e.type, e.name, e.source) == ("organization", "Acme", "organizations")
    syn = FakeDb([("from exp_nora_state", [{"entity_type": "location", "name": "S", "category": "gcid:s", "market": "m"}])])
    s = resolve_entity(syn, "demo-ref")
    assert (s.type, s.gcid, s.market, s.source) == ("location", "gcid:s", "m", "exp_nora_state (synthetic)")
    assert not syn.sql("search_rank_scores")  # non-uuid refs skip the uuid tables
    assert resolve_entity(FakeDb([("from exp_nora_state", [])]), "nope") is None
    assert entitlement_subjects(FakeDb(), RunEntity(ref="demo", type="location")) == ["demo"]


def test_capability_registry_keys():
    assert sorted(IMPLEMENTED_CAPABILITIES) == sorted([
        "gbp_list_locations", "claim_precheck", "claim_gate_write", "otp_send", "otp_verify",
        "claim_bind", "claim_unbind", "page_fetch", "source_crawl", "serp_fetch", "geocode",
        "graph_query", "compset_query", "nlp_extract", "graph_upsert",
    ])
    h = capability_handlers(None)
    assert [k for k, v in h.items() if not v.read_only] == [
        "claim_gate_write", "otp_send", "otp_verify", "claim_bind", "claim_unbind", "graph_upsert",
    ]


def ent(**o):
    return RunEntity(**{"ref": E, "type": "professional", "gcid": "gcid:x", **o})


def test_graph_query():
    db = FakeDb([("from graph_nodes", [
        {"ring": None, "ring_key": "identity", "verified": True, "is_active": True, "score_counted": True},
        {"ring": 3, "ring_key": None, "verified": False, "is_active": False, "score_counted": False},
        {"ring": None, "ring_key": None, "verified": None, "is_active": None, "score_counted": None},
    ])])
    out = capability_handlers(db)["graph_query"].run(HandlerContext(mode="live", entity=ent(), inputs={}))["outputs"]
    assert out == {"nodes": 3, "truncated": False, "active": 2, "verified": 1, "score_counted": 1,
                   "by_ring": {"identity": 1, "ring_3": 1, "unassigned": 1}}
    sql, params = db.calls[0]
    assert "entity_type = %s" in sql and params == (E, "professional", 5000)
    with pytest.raises(ValueError, match="graph_query needs a uuid entity reference"):
        capability_handlers(db)["graph_query"].run(HandlerContext(mode="live", entity=None, inputs={}))


def test_compset_query():
    me = {"entity_id": E, "entity_type": "professional", "gcid": "gcid:x", "local_market": "KC", "total_score": 50}
    peers = [
        {"entity_id": "a", "entity_type": "professional", "gcid": "gcid:x", "local_market": "KC", "total_score": 80},
        {"entity_id": "b", "entity_type": "professional", "gcid": "gcid:x", "local_market": "KC", "total_score": 60},
    ]
    db = FakeDb([
        ("where entity_id = %s order by calculated_at", [me]),
        ("where gcid = %s", peers),
        ("from exp_entity", [{"entity_id": "a", "display_name": "Alpha"}]),
    ])
    out = capability_handlers(db)["compset_query"].run(HandlerContext(mode="live", entity=ent(), inputs={}))["outputs"]
    assert out["rank"] == 3 and out["set_size"] == 3
    assert out["leader"] == {"entity_id": "a", "entity_type": "professional", "name": "Alpha", "total_score": 80}
    assert out["gap_to_leader"] == 30
    assert out["next_above"]["entity_id"] == "b"
    assert [c["entity_id"] for c in out["competitors"]] == ["a", "b"]
    assert db.sql("where gcid = %s")[0][1] == ("gcid:x", "KC", 25)
    none = FakeDb([("from search_rank_scores", [])])
    assert capability_handlers(none)["compset_query"].run(HandlerContext(mode="live", entity=ent(), inputs={}))[
        "outputs"] == {"scored": False, "reason": "entity has no Search Rank Score"}


def test_graph_upsert_goes_through_the_governed_function():
    result = {"inserted": 1, "updated": 0, "kept": 0, "skipped": 0, "ids": ["n1"], "trust_tier": "owner_verified",
              "source": "user"}
    db = FakeDb([("rpc:exp_graph_upsert_nodes", result)])
    nodes = [{"value": "v", "title": "t", "node_type": "bio", "schema_property": "description", "ring": None,
              "registry_node_id": None, "registry_node_slug": None, "source_url": "u", "fetched_at": "f",
              "extracted_data": {}, "evidence": "e", "confidence": 0.9, "method": "deterministic",
              "cardinality_group": {}}]
    r = capability_handlers(db)["graph_upsert"].run(
        HandlerContext(mode="live", entity=ent(type="location"), inputs={"nodes": nodes, "trust": "owner_verified",
                                                                         "source": "user"},
                       prior={"nlp_extract": {"conflicts": [{}, {}], "gcid": "gcid:y", "entity_type": "location"}})
    )
    (key, args), = db.calls
    assert key == "rpc:exp_graph_upsert_nodes"
    assert args["p_entity_type"] == "organization" and args["p_entity_id"] == E
    assert args["p_source"] == "user" and args["p_trust"] == "owner_verified"
    assert args["p_nodes"][0]["gcid"] == "gcid:y" and "cardinality_group" not in args["p_nodes"][0]
    assert r["outputs"]["held_conflicts"] == 2
    assert r["graph_writes"] == [{"table": "graph_nodes", "id": "n1", "trust": "owner_verified", "source": "user"}]
    with pytest.raises(ValueError, match="unknown trust tier bogus"):
        capability_handlers(db)["graph_upsert"].run(HandlerContext(mode="live", entity=ent(), inputs={"trust": "bogus"}))
    # graph_nodes is never written directly
    assert not [c for c in db.calls if "graph_nodes" in c[0] and not c[0].startswith("rpc:")]


def test_nlp_extract_dry_run_never_calls_the_model(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    seen = {}
    monkeypatch.setattr(caps_mod, "load_category_brief_rows", lambda db, gcid: {"gcid": gcid})
    monkeypatch.setattr(caps_mod, "compile_category_brief", lambda rows: {"gcid": rows["gcid"]})

    def fake_extract(**kw):
        seen.update(kw)
        return {"stats": {"llm_calls": 0}}

    monkeypatch.setattr(caps_mod, "extract_facts", fake_extract)
    h = capability_handlers(FakeDb())["nlp_extract"]
    out = h.run(HandlerContext(mode="dry_run", entity=ent(), inputs={"pages": [{"p": 1}]}))["outputs"]
    assert seen["llm"] is None and seen["entity_type"] == "professional"
    assert out["model_used"] is False
    with pytest.raises(ValueError, match="nlp_extract needs organized pages"):
        h.run(HandlerContext(mode="dry_run", entity=ent(), inputs={}))
