"""NORA skill runner — the pure half of the executor (port of lib/nora-runner.ts).

Every invocation: governance envelope (deterministic, here) → dispatch to capability handlers
→ one exp_skill_run row. No I/O in this module: `runner_server.execute_skill_run` loads the
registry/entity/entitlements, calls these, and persists the row.
"""
from __future__ import annotations

import concurrent.futures
import datetime as _dt
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from surfaces.nora_os.jsutil import date_ms, iso, js_number, js_round, message, now_ms
from surfaces.nora_os.sandbox import estimate_telemetry, model_label

RUN_MODES = ("dry_run", "live")
RUN_TRIGGERS = ("manual", "scripted", "autonomous")

# Capability side effects that publish or write content about the entity → restricted class.
PUBLISH_EFFECTS = frozenset({"public_publish", "content_write"})
# Pseudo tool key some skills declare when they compose no capability.
NO_CAPABILITY = "none"

GovSkill = dict[str, Any]
GovCapability = dict[str, Any]
EntitlementRow = dict[str, Any]


@dataclass
class RunEntity:
    ref: str
    type: str | None
    name: str | None = None
    gcid: str | None = None
    market: str | None = None
    source: str | None = None


@dataclass
class Gate:
    gate: str
    outcome: str  # pass | warn | live | block | pitch
    detail: str

    def as_json(self) -> dict:
        return {"gate": self.gate, "outcome": self.outcome, "detail": self.detail}


@dataclass
class Governance:
    compliance: str
    commercial: str
    gates: list[Gate]
    live_blockers: list[str]
    pitch: dict | None
    capability_keys: list[str]
    unimplemented: list[str]
    pre_verdict: str


def _list(a: Any) -> list:
    return [x for x in (a or []) if x]


def _trim(s: Any) -> str:
    return s.strip() if isinstance(s, str) else ""


def declared_capabilities(skill: GovSkill | None) -> list[str]:
    """Declared capability keys (drops the "none" pseudo key, dedupes, keeps order)."""
    out: list[str] = []
    for t in _list((skill or {}).get("tools_used")):
        if t != NO_CAPABILITY and t not in out:
            out.append(t)
    return out


def _needs_review(skill: GovSkill) -> bool:
    return bool(skill.get("requires_user_approval")) or (
        (skill.get("autonomy") if skill.get("autonomy") is not None else "approve") != "auto"
    )


def compliance_class(skill: GovSkill, caps: list[GovCapability]) -> str:
    """restricted > human-review-required > consent-gated > safe-autonomous."""
    if any(e in PUBLISH_EFFECTS for c in caps for e in _list(c.get("side_effects"))):
        return "restricted"
    if _needs_review(skill):
        return "human-review-required"
    if skill.get("captures_consent") or skill.get("charges_money"):
        return "consent-gated"
    return "safe-autonomous"


def commercial_class(skill: GovSkill) -> str:
    """An entitlement on the skill = paid-unlock; charging money = metered."""
    if _trim(skill.get("requires_entitlement")):
        return "paid-unlock"
    if skill.get("charges_money"):
        return "metered"
    return "free"


def entitlement_state(
    product: str, rows: list[EntitlementRow], now: _dt.datetime | None = None
) -> str:
    """Is a product held (active, not expired) by any of the resolved subjects?"""
    now_t = now.timestamp() * 1000 if now else now_ms()
    mine = [r for r in rows if r.get("product_key") == product]

    def live_row(r: EntitlementRow) -> bool:
        if not r.get("expires_at"):
            return True
        t = date_ms(r.get("expires_at"))
        return t is not None and t > now_t

    live = [r for r in mine if live_row(r)]
    if any(r.get("state") == "active" for r in live):
        return "active"
    if any(r.get("state") == "entitled_unconfigured" for r in live):
        return "entitled_unconfigured"
    if any(r.get("state") in ("active", "entitled_unconfigured") for r in mine):
        return "expired"
    return "not_entitled"


def evaluate_governance(
    *,
    mode: str,
    trigger: str,
    skill_key: str,
    skill: GovSkill | None,
    capabilities: list[GovCapability],
    entity_requested: bool,
    entity: RunEntity | None,
    entitlements: list[EntitlementRow],
    approval: dict,
    implemented: Iterable[str],
    now: _dt.datetime | None = None,
) -> Governance:
    """The governance envelope. Deterministic; runs before any capability is touched."""
    gates: list[Gate] = []

    def add(gate: str, outcome: str, detail: str) -> None:
        gates.append(Gate(gate, outcome, detail))

    cap_keys = declared_capabilities(skill)
    cap_by_key = {c["key"]: c for c in capabilities}
    caps = [cap_by_key[k] for k in cap_keys if k in cap_by_key]
    impl = set(implemented)

    if not skill:
        add("registered", "block", f"skill {skill_key} is not registered")
        return _finish(gates, "safe-autonomous", "free", None, cap_keys, [], mode)
    compliance = compliance_class(skill, caps)
    commercial = commercial_class(skill)
    version = skill.get("version")
    add("registered", "pass", f"skill {skill.get('key')}@{version if version is not None else '—'}")

    # 1. Lifecycle
    if skill.get("is_active") is False:
        add("active", "block", "skill is inactive")
    status = skill.get("status") if skill.get("status") is not None else "draft"
    if status == "deprecated":
        add("publish_state", "block", "skill is deprecated (yanked)")
    elif status != "published":
        add("publish_state", "live", f"skill is {status} — live runs require a published skill")
    else:
        add("publish_state", "pass", "published")

    # 2. Entity
    types = _list(skill.get("entity_types"))
    if entity_requested and not entity:
        add("entity", "block", "entity not found")
    elif entity:
        et = entity.type if entity.type is not None else "unknown"
        if types and et not in types:
            add("entity", "block", f"skill not valid for {et} (allows {', '.join(types)})")
        else:
            add("entity", "pass", f"{et} {entity.ref}")
    elif types:
        add("entity", "live", "no target entity — live runs require one")

    # 3. Capabilities registered + implemented
    unregistered = [k for k in cap_keys if k not in cap_by_key]
    if unregistered:
        add("capabilities", "block", f"capability not registered: {', '.join(unregistered)}")
    deprecated = [c["key"] for c in caps if c.get("status") == "deprecated"]
    if deprecated:
        add("capabilities", "block", f"capability deprecated: {', '.join(deprecated)}")
    unimplemented = [k for k in cap_keys if k in cap_by_key and k not in impl]
    if not unregistered and not deprecated:
        if unimplemented:
            add("capabilities", "warn", f"no implementation in code: {', '.join(unimplemented)}")
        else:
            add(
                "capabilities",
                "pass",
                f"all {len(cap_keys)} implemented" if cap_keys else "composes no capability",
            )

    # 4. Autonomy gate — autonomous triggers may only run safe-autonomous skills
    if trigger == "autonomous" and compliance != "safe-autonomous":
        add("autonomy", "block", f"autonomous trigger cannot run a {compliance} skill")
    else:
        autonomy = skill.get("autonomy")
        add("autonomy", "pass", f"trigger {trigger} · autonomy {autonomy if autonomy is not None else '—'}")

    # 5. Human review
    if _needs_review(skill):
        add(
            "approval",
            "pass" if approval.get("approved") else "live",
            "owner approval recorded"
            if approval.get("approved")
            else "owner approval required before a live run",
        )

    # 6. Consent
    if skill.get("captures_consent") or skill.get("charges_money"):
        add(
            "consent",
            "pass" if approval.get("consent") else "live",
            "consent recorded" if approval.get("consent") else "consent required before a live run",
        )

    # 7. Compliance (restricted): output must pass the per-category filter before publish.
    if compliance == "restricted":
        add(
            "compliance",
            "live",
            "restricted — the per-category compliance filter (content_compliance_rules + "
            "exp_category_compliance) is not wired into the runner; live publish refused",
        )

    # 8. Dry-run safety: capabilities with side effects are never called in a dry run.
    effectful = [c for c in caps if _list(c.get("side_effects"))]
    if mode == "dry_run" and effectful:
        listed = "; ".join(
            f"{c['key']} [{', '.join(_list(c.get('side_effects')))}]" for c in effectful
        )
        add("side_effects", "pass", f"dry run — will not call: {listed}")

    # 9. Commercial / entitlement (monetization bridge)
    pitch: dict | None = None
    skill_product = _trim(skill.get("requires_entitlement")) or None
    products: dict[str, str] = {}
    if skill_product:
        products[skill_product] = "skill"
    for c in caps:
        req = _trim(c.get("entitlement_required"))
        if req and req not in products:
            products[req] = f"capability {c['key']}"
    for product, by in products.items():
        st = entitlement_state(product, entitlements, now)
        if st == "active":
            add("entitlement", "pass", f"{product} active (required by {by})")
            continue
        if st == "entitled_unconfigured":
            add("entitlement", "live", f"{product} entitled but unconfigured (required by {by})")
            continue
        if by == "skill" and commercial == "paid-unlock":
            lift = js_number(
                skill.get("expected_srs_lift")
                if skill.get("expected_srs_lift") is not None
                else 0
            )
            if lift > 0:
                pitch = {
                    "product_key": product,
                    "value_prop": skill.get("value_prop"),
                    "price_ref": skill.get("price_ref"),
                    "expected_lift": _num(lift),
                    "offer_expected_points": skill.get("offer_expected_points"),
                    "trial_eligible": bool(skill.get("trial_eligible")),
                }
                add(
                    "entitlement",
                    "pitch",
                    f"{product} {st} — paid-unlock: pitch (+{_fmt(lift)} SRS) instead of executing",
                )
            else:
                add(
                    "entitlement",
                    "block",
                    f"{product} {st} — paid-unlock with no expected lift: integrity rule "
                    "forbids a pitch",
                )
            continue
        add("entitlement", "live", f"{product} {st} (required by {by})")
    if not products:
        add("entitlement", "pass", f"{commercial} — no entitlement required")

    return _finish(gates, compliance, commercial, pitch, cap_keys, unimplemented, mode)


def _num(x: float) -> float | int:
    return int(x) if float(x).is_integer() else x


def _fmt(x: float) -> str:
    """`${n}` for a JS number."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))


def _finish(
    gates: list[Gate],
    compliance: str,
    commercial: str,
    pitch: dict | None,
    capability_keys: list[str],
    unimplemented: list[str],
    mode: str,
) -> Governance:
    live_blockers = [f"{g.gate}: {g.detail}" for g in gates if g.outcome in ("block", "live")]
    return Governance(
        compliance=compliance,
        commercial=commercial,
        gates=gates,
        live_blockers=live_blockers,
        pitch=pitch,
        capability_keys=capability_keys,
        unimplemented=unimplemented,
        pre_verdict=resolve_verdict([g.outcome for g in gates], unimplemented, mode),
    )


def resolve_verdict(outcomes: list[str], unimplemented: list[str], mode: str) -> str:
    """blocked > pitch > not_implemented > (dry_run: would_execute | live: execute)."""
    if "block" in outcomes:
        return "blocked"
    if mode == "live" and "live" in outcomes:
        return "blocked"
    if "pitch" in outcomes:
        return "pitch"
    if unimplemented:
        return "not_implemented"
    return "would_execute" if mode == "dry_run" else "execute"


def status_for(v: str) -> str:
    """exp_skill_run.status for a final verdict."""
    if v in ("executed", "would_execute"):
        return "succeeded"
    if v == "failed":
        return "failed"
    return "blocked"


# ───────── Capability dispatch ─────────


@dataclass
class HandlerContext:
    mode: str
    entity: RunEntity | None
    inputs: dict[str, Any]
    # Outputs of earlier capabilities in this run, keyed by capability key.
    prior: dict[str, Any] = field(default_factory=dict)
    # The user the run acts for (exp_skill_run.actor). Never taken from inputs.
    actor: str | None = None


@dataclass
class CapabilityHandler:
    """`read_only` handlers are the only ones a dry run may call.

    `run(ctx)` returns `{"outputs": {...}, "graph_writes"?: [...]}`.
    """

    read_only: bool
    run: Callable[[HandlerContext], dict]


HandlerRegistry = dict[str, CapabilityHandler]
TraceFn = Callable[..., None]

CAPABILITY_TIMEOUT_MS = 15_000


def _with_timeout(fn: Callable[[], dict], ms: float, label: str) -> dict:
    """`withTimeout`: the run is abandoned (not killed) when it overruns, as Promise.race did."""
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        fut = pool.submit(fn)
        try:
            return fut.result(timeout=ms / 1000)
        except concurrent.futures.TimeoutError:
            raise TimeoutError(f"{label} timed out after {_fmt(ms)} ms") from None
    finally:
        pool.shutdown(wait=False)


def dispatch_capabilities(
    *,
    mode: str,
    capability_keys: list[str],
    capabilities: list[GovCapability],
    handlers: HandlerRegistry,
    entity: RunEntity | None,
    inputs: dict[str, Any],
    trace: TraceFn,
    actor: str | None = None,
    timeout_ms: float | None = None,
    clock: Callable[[], float] | None = None,
) -> dict:
    """Run the capabilities in declared order.

    Dry run calls a handler only when it is read-only AND the registry declares no side effects
    for it; everything else is traced as "would call". Live runs every capability; the first
    failure stops the run. Returns {outputs, graph_writes, steps, error}.
    """
    clk = clock or now_ms
    cap_by_key = {c["key"]: c for c in capabilities}
    outputs: dict[str, Any] = {}
    graph_writes: list[Any] = []
    steps: list[dict] = []

    def result(error: str | None) -> dict:
        return {"outputs": outputs, "graph_writes": graph_writes, "steps": steps, "error": error}

    for key in capability_keys:
        h = handlers.get(key)
        cap = cap_by_key.get(key)
        if not h or not cap:
            trace("error", f"no implementation for {key}", {"capability": key})
            return result(f"no implementation for {key}")
        effects = _list(cap.get("side_effects"))
        if mode == "dry_run" and (not h.read_only or effects):
            suffix = f": side effects {', '.join(effects)}" if effects else ""
            trace("call", f"would call {key} (dry run — not called{suffix})", {"capability": key})
            steps.append({"capability": key, "ms": 0, "ran": False})
            continue
        t0 = clk()
        ctx = HandlerContext(
            mode=mode, entity=entity, inputs=inputs, prior=dict(outputs), actor=actor
        )
        try:
            r = _with_timeout(
                lambda h=h, ctx=ctx: h.run(ctx),
                timeout_ms if timeout_ms is not None else CAPABILITY_TIMEOUT_MS,
                key,
            )
            ms = _num(clk() - t0)
            outputs[key] = r.get("outputs")
            if r.get("graph_writes"):
                graph_writes.extend(r["graph_writes"])
            steps.append({"capability": key, "ms": ms, "ran": True})
            ro = " (read-only)" if h.read_only else ""
            trace("call", f"call {key}{ro} — ok", {"capability": key, "ms": ms})
        except Exception as exc:  # noqa: BLE001 — the TS caught everything a handler threw
            ms = _num(clk() - t0)
            msg = message(exc)
            steps.append({"capability": key, "ms": ms, "ran": True})
            trace("error", f"call {key} failed: {msg}", {"capability": key, "ms": ms})
            return result(f"{key}: {msg}")
    return result(None)


# ───────── Telemetry ─────────

# USD per million tokens [input, output] — Anthropic list rates for the current tier models.
MODEL_RATES: dict[str, list[float] | None] = {
    "deterministic": [0, 0],
    "haiku": [0.1, 0.5],
    "sonnet": [2, 10],
    "opus": [4, 20],
}


def run_telemetry(
    skill: GovSkill | None, timings: dict[str, float], steps: list[dict] | None = None
) -> dict:
    """Telemetry for a run. No capability calls a model yet, so actuals are 0."""
    est = estimate_telemetry(skill)
    model = model_label((skill or {}).get("model_tier"))
    rate = MODEL_RATES.get(model)
    est_tokens = est["input_tokens"]
    cost = (
        js_round(((est_tokens * rate[0]) / 1e6) * 1e6) / 1e6
        if rate and est_tokens is not None
        else None
    )
    return {
        "model": model,
        "model_tier": (skill or {}).get("model_tier"),
        "model_calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "actual_cost_usd": 0,
        "estimated_input_tokens": est_tokens,
        "estimated_cost_usd": cost,
        "rate_usd_per_mtok": rate,
        **timings,
        "steps": steps or [],
    }


# ───────── Run row ─────────

# The exp_skill_run columns this runner writes (id + created_at are DB defaults).
SKILL_RUN_COLUMNS = (
    "skill_key",
    "skill_version",
    "capability_keys",
    "entity_ref",
    "entity_type",
    "mode",
    "status",
    "trigger",
    "verdict",
    "trace",
    "inputs",
    "outputs",
    "telemetry",
    "graph_writes",
    "expected_srs_lift",
    "actual_srs_delta",
    "error",
    "actor",
    "started_at",
    "finished_at",
)


def build_run_row(
    *,
    skill_key: str,
    skill: GovSkill | None,
    capability_keys: list[str],
    entity: RunEntity | None,
    entity_ref: str | None,
    mode: str,
    trigger: str,
    verdict: str,
    trace: list[dict],
    inputs: dict,
    outputs: dict,
    telemetry: dict,
    graph_writes: list,
    error: str | None,
    actor: str | None,
    started_at: _dt.datetime,
    finished_at: _dt.datetime,
) -> dict:
    """Assemble the exp_skill_run insert — exactly the live columns, nothing else."""
    s = skill or {}
    return {
        "skill_key": skill_key,
        "skill_version": s.get("version"),
        "capability_keys": capability_keys,
        "entity_ref": entity.ref if entity else entity_ref,
        "entity_type": entity.type if entity else None,
        "mode": mode,
        "status": status_for(verdict),
        "trigger": trigger,
        "verdict": verdict,
        "trace": trace,
        "inputs": inputs,
        "outputs": outputs,
        "telemetry": telemetry,
        "graph_writes": graph_writes,
        "expected_srs_lift": s.get("expected_srs_lift"),
        "actual_srs_delta": None,
        "error": error,
        "actor": actor,
        "started_at": iso(started_at),
        "finished_at": iso(finished_at),
    }


def governance_trace(g: Governance, mode: str) -> list[dict]:
    """Trace lines for the governance pass (gate outcome → trace level)."""
    out = []
    for x in g.gates:
        if x.outcome == "block":
            level = "error"
        elif x.outcome == "live":
            level = "error" if mode == "live" else "warn"
        elif x.outcome in ("pitch", "warn"):
            level = "warn"
        else:
            level = "check"
        prefix = "live would block — " if x.outcome == "live" and mode == "dry_run" else ""
        out.append({"level": level, "text": f"gate {x.gate}: {prefix}{x.detail}"})
    return out
