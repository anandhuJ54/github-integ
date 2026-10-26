"""Port of tests/nora-runner.test.ts (+ the sandbox telemetry helpers the runner uses)."""
from __future__ import annotations

import datetime as dt
import time

import pytest
from surfaces.nora_os.runner import (
    SKILL_RUN_COLUMNS,
    CapabilityHandler,
    RunEntity,
    build_run_row,
    commercial_class,
    compliance_class,
    dispatch_capabilities,
    entitlement_state,
    evaluate_governance,
    governance_trace,
    resolve_verdict,
    run_telemetry,
    status_for,
)
from surfaces.nora_os.sandbox import estimate_telemetry, model_label

NOW = dt.datetime(2026, 10, 11, tzinfo=dt.UTC)


def skill(**o):
    s = {
        "key": "competitor_snapshot",
        "status": "published",
        "is_active": True,
        "version": "0.1.0",
        "entity_types": ["professional"],
        "tools_used": ["compset_query", "graph_query"],
        "autonomy": "auto",
        "model_tier": "deterministic",
        "reads_state": [],
        "requires_entitlement": None,
        "charges_money": False,
        "captures_consent": False,
        "requires_user_approval": False,
        "expected_srs_lift": None,
        "value_prop": None,
        "price_ref": None,
        "offer_expected_points": None,
        "trial_eligible": False,
        "graph_writes": [],
    }
    s.update(o)
    return s


def cap(key, **o):
    c = {"key": key, "status": "draft", "entitlement_required": None, "side_effects": [], "dry_run": True}
    c.update(o)
    return c


def base(**o):
    b = {
        "mode": "live",
        "trigger": "manual",
        "skill_key": "competitor_snapshot",
        "skill": skill(),
        "capabilities": [cap("compset_query"), cap("graph_query")],
        "entity_requested": True,
        "entity": RunEntity(ref="e1", type="professional"),
        "entitlements": [],
        "approval": {"approved": False, "consent": False},
        "implemented": ["compset_query", "graph_query"],
        "now": NOW,
    }
    b.update(o)
    return b


def gov(**o):
    return evaluate_governance(**base(**o))


def test_open_envelope():
    assert gov().pre_verdict == "execute"
    assert gov(mode="dry_run").pre_verdict == "would_execute"


def test_unregistered_skill_blocks_in_both_modes():
    assert gov(skill=None).pre_verdict == "blocked"
    assert gov(skill=None, mode="dry_run").pre_verdict == "blocked"


def test_draft_skill_live_refuses_dry_run_allowed():
    assert gov(skill=skill(status="draft")).pre_verdict == "blocked"
    dry = gov(mode="dry_run", skill=skill(status="draft"))
    assert dry.pre_verdict == "would_execute"
    assert any(b.startswith("publish_state") for b in dry.live_blockers)


def test_deprecated_or_inactive_block_even_dry_run():
    assert gov(mode="dry_run", skill=skill(status="deprecated")).pre_verdict == "blocked"
    assert gov(mode="dry_run", skill=skill(is_active=False)).pre_verdict == "blocked"


def test_entity_gates():
    assert gov(entity=RunEntity(ref="x", type="brand")).pre_verdict == "blocked"
    assert gov(mode="dry_run", entity=None).pre_verdict == "blocked"
    assert gov(entity_requested=False, entity=None).pre_verdict == "blocked"
    assert gov(entity_requested=False, entity=None, mode="dry_run").pre_verdict == "would_execute"


def test_capability_gates():
    assert gov(capabilities=[cap("graph_query")]).pre_verdict == "blocked"
    g = gov(implemented=["graph_query"])
    assert g.pre_verdict == "not_implemented"
    assert g.unimplemented == ["compset_query"]
    # "none" is a pseudo tool, not a capability
    assert gov(skill=skill(tools_used=["none"]), capabilities=[]).pre_verdict == "execute"


def test_approval_and_consent_are_live_only():
    s = skill(autonomy="approve", requires_user_approval=True, captures_consent=True)
    assert gov(skill=s).pre_verdict == "blocked"
    assert gov(skill=s, approval={"approved": True, "consent": False}).pre_verdict == "blocked"
    assert gov(skill=s, approval={"approved": True, "consent": True}).pre_verdict == "execute"
    assert gov(skill=s, mode="dry_run").pre_verdict == "would_execute"


def test_autonomy_gate():
    assert gov(trigger="autonomous").pre_verdict == "execute"
    assert gov(trigger="autonomous", skill=skill(autonomy="approve"), mode="dry_run").pre_verdict == "blocked"


def test_compliance_class():
    s = skill()
    assert compliance_class(s, [cap("a")]) == "safe-autonomous"
    assert compliance_class({**s, "captures_consent": True}, []) == "consent-gated"
    assert compliance_class({**s, "autonomy": "approve"}, []) == "human-review-required"
    assert compliance_class(s, [cap("p", side_effects=["public_publish"])]) == "restricted"


def test_restricted_never_publishes_live():
    caps = [cap("compset_query", side_effects=["content_write"]), cap("graph_query")]
    g = gov(capabilities=caps)
    assert g.compliance == "restricted"
    assert g.pre_verdict == "blocked"


def test_commercial_class_and_entitlement_state():
    assert commercial_class({"requires_entitlement": "voce", "charges_money": True}) == "paid-unlock"
    assert commercial_class({"requires_entitlement": None, "charges_money": True}) == "metered"
    assert commercial_class({"requires_entitlement": " ", "charges_money": False}) == "free"
    now = dt.datetime(2026, 10, 11, tzinfo=dt.UTC)
    assert entitlement_state("voce", [{"product_key": "voce", "state": "active"}], now) == "active"
    expired = [{"product_key": "voce", "state": "active", "expires_at": "2026-01-01"}]
    assert entitlement_state("voce", expired, now) == "expired"
    unc = [{"product_key": "voce", "state": "entitled_unconfigured"}]
    assert entitlement_state("voce", unc, now) == "entitled_unconfigured"
    assert entitlement_state("voce", [{"product_key": "nora", "state": "active"}], now) == "not_entitled"


def test_paid_unlock_pitches_only_with_positive_lift():
    paid = skill(requires_entitlement="voce", expected_srs_lift=103, value_prop="Articles", price_ref="voce")
    g = gov(skill=paid)
    assert g.pre_verdict == "pitch"
    assert g.pitch["product_key"] == "voce" and g.pitch["expected_lift"] == 103
    assert any("pitch (+103 SRS)" in x.detail for x in g.gates)
    assert gov(skill=paid, mode="dry_run").pre_verdict == "pitch"
    assert gov(skill={**paid, "expected_srs_lift": 0}).pre_verdict == "blocked"
    ok = gov(skill=paid, entitlements=[{"product_key": "voce", "state": "active"}])
    assert ok.pre_verdict == "execute"
    unc = gov(skill=paid, entitlements=[{"product_key": "voce", "state": "entitled_unconfigured"}])
    assert unc.pitch is None
    assert unc.pre_verdict == "blocked"


def test_capability_entitlement_missing_is_live_only():
    caps = [cap("compset_query", entitlement_required="srp"), cap("graph_query")]
    assert gov(capabilities=caps).pre_verdict == "blocked"
    dry = gov(capabilities=caps, mode="dry_run")
    assert dry.pre_verdict == "would_execute"
    assert dry.pitch is None


def test_verdict_precedence_and_status_mapping():
    assert resolve_verdict(["pitch", "block"], [], "dry_run") == "blocked"
    assert resolve_verdict(["pitch"], ["x"], "live") == "pitch"
    assert resolve_verdict(["live"], ["x"], "dry_run") == "not_implemented"
    assert status_for("executed") == "succeeded"
    assert status_for("would_execute") == "succeeded"
    assert status_for("pitch") == "blocked"
    assert status_for("not_implemented") == "blocked"
    assert status_for("failed") == "failed"


def test_governance_trace_levels():
    g = gov(mode="dry_run", skill=skill(status="draft"))
    lines = governance_trace(g, "dry_run")
    pub = next(x for x in lines if "publish_state" in x["text"])
    assert pub == {
        "level": "warn",
        "text": "gate publish_state: live would block — skill is draft — live runs require a "
        "published skill",
    }
    assert lines[0] == {"level": "check", "text": "gate registered: skill competitor_snapshot@0.1.0"}


def fake_handlers(calls):
    def graph_query(ctx):
        calls.append("graph_query")
        return {"outputs": {"nodes": 3}}

    def writer(ctx):
        calls.append("writer")
        return {"outputs": {}, "graph_writes": [{"n": 1}]}

    def boom(ctx):
        raise RuntimeError("nope")

    return {
        "graph_query": CapabilityHandler(read_only=True, run=graph_query),
        "writer": CapabilityHandler(read_only=False, run=writer),
        "boom": CapabilityHandler(read_only=True, run=boom),
    }


def test_dry_run_never_calls_side_effect_handlers():
    calls: list[str] = []
    lines: list[str] = []
    r = dispatch_capabilities(
        mode="dry_run",
        capability_keys=["graph_query", "writer"],
        capabilities=[cap("graph_query"), cap("writer", side_effects=["writes_graph"])],
        handlers=fake_handlers(calls),
        entity=None,
        inputs={},
        trace=lambda _l, t, *_: lines.append(t),
    )
    assert calls == ["graph_query"]
    assert r["graph_writes"] == []
    assert any(x.startswith("would call writer") for x in lines)
    calls2: list[str] = []
    dispatch_capabilities(
        mode="dry_run",
        capability_keys=["graph_query"],
        capabilities=[cap("graph_query", side_effects=["writes_score"])],
        handlers=fake_handlers(calls2),
        entity=None,
        inputs={},
        trace=lambda *_: None,
    )
    assert calls2 == []


def test_live_dispatch_order_writes_and_first_failure():
    calls: list[str] = []
    r = dispatch_capabilities(
        mode="live",
        capability_keys=["writer", "boom", "graph_query"],
        capabilities=[cap("writer"), cap("boom"), cap("graph_query")],
        handlers=fake_handlers(calls),
        entity=None,
        inputs={},
        trace=lambda *_: None,
    )
    assert calls == ["writer"]
    assert r["graph_writes"] == [{"n": 1}]
    assert r["error"] == "boom: nope"


def test_prior_outputs_and_actor_reach_handlers():
    seen = {}

    def second(ctx):
        seen.update(prior=dict(ctx.prior), actor=ctx.actor)
        return {"outputs": {}}

    handlers = {
        "a": CapabilityHandler(read_only=True, run=lambda ctx: {"outputs": {"x": 1}}),
        "b": CapabilityHandler(read_only=True, run=second),
    }
    dispatch_capabilities(
        mode="live", capability_keys=["a", "b"], capabilities=[cap("a"), cap("b")],
        handlers=handlers, entity=None, inputs={}, actor="u1", trace=lambda *_: None,
    )
    assert seen == {"prior": {"a": {"x": 1}}, "actor": "u1"}


def test_handler_timeout():
    slow = CapabilityHandler(read_only=True, run=lambda ctx: time.sleep(0.5) or {"outputs": {}})
    r = dispatch_capabilities(
        mode="live", capability_keys=["slow"], capabilities=[cap("slow")],
        handlers={"slow": slow}, entity=None, inputs={}, trace=lambda *_: None, timeout_ms=50,
    )
    assert r["error"] == "slow: slow timed out after 50 ms"


def test_run_row_carries_exactly_the_live_columns():
    row = build_run_row(
        skill_key="s",
        skill={"version": "1.0.0", "expected_srs_lift": 9},
        capability_keys=["graph_query"],
        entity=RunEntity(ref="e1", type="professional"),
        entity_ref="e1",
        mode="dry_run",
        trigger="manual",
        verdict="would_execute",
        trace=[],
        inputs={},
        outputs={},
        telemetry=run_telemetry(None, {"ms_total": 1, "ms_load": 0, "ms_governance": 0, "ms_execution": 1}),
        graph_writes=[],
        error=None,
        actor="u",
        started_at=dt.datetime(1970, 1, 1, tzinfo=dt.UTC),
        finished_at=dt.datetime(1970, 1, 1, 0, 0, 0, 1000, tzinfo=dt.UTC),
    )
    assert sorted(row) == sorted(SKILL_RUN_COLUMNS)
    assert row["status"] == "succeeded"
    assert row["expected_srs_lift"] == 9
    assert row["started_at"] == "1970-01-01T00:00:00.000Z"
    assert row["finished_at"] == "1970-01-01T00:00:00.001Z"


def test_telemetry_estimates_from_tier_rate():
    t = run_telemetry(
        {"key": "s", "model_tier": "sonnet", "reads_state": ["a"], "tools_used": ["t"]},
        {"ms_total": 5, "ms_load": 1, "ms_governance": 1, "ms_execution": 3},
    )
    assert t["model_calls"] == 0
    assert t["actual_cost_usd"] == 0
    assert t["estimated_input_tokens"] == 720
    assert t["estimated_cost_usd"] == pytest.approx(720 * 2 / 1e6, abs=1e-9)
    d = run_telemetry(
        {"key": "d", "model_tier": "deterministic", "reads_state": [], "tools_used": ["t"]},
        {"ms_total": 0, "ms_load": 0, "ms_governance": 0, "ms_execution": 0},
    )
    assert d["estimated_cost_usd"] == 0
    assert list(t)[:9] == [
        "model", "model_tier", "model_calls", "input_tokens", "output_tokens", "actual_cost_usd",
        "estimated_input_tokens", "estimated_cost_usd", "rate_usd_per_mtok",
    ]


def test_sandbox_helpers():
    assert model_label("claude-haiku-5-5") == "haiku"
    assert model_label(None) == "deterministic"
    assert model_label("gpt") == "gpt"
    assert estimate_telemetry({"key": "k", "model_tier": "opus", "reads_state": ["a", "b"]})["input_tokens"] == 640
