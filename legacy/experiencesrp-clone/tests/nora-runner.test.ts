import { expect, test } from "bun:test";
import {
  SKILL_RUN_COLUMNS,
  buildRunRow,
  commercialClass,
  complianceClass,
  dispatchCapabilities,
  entitlementState,
  evaluateGovernance,
  resolveVerdict,
  runTelemetry,
  statusFor,
  type GovCapability,
  type GovSkill,
  type GovernanceInput,
  type HandlerRegistry,
} from "../src/lib/nora-runner";

const skill = (o: Partial<GovSkill> = {}): GovSkill => ({
  key: "competitor_snapshot",
  status: "published",
  is_active: true,
  version: "0.1.0",
  entity_types: ["professional"],
  tools_used: ["compset_query", "graph_query"],
  autonomy: "auto",
  model_tier: "deterministic",
  reads_state: [],
  requires_entitlement: null,
  charges_money: false,
  captures_consent: false,
  requires_user_approval: false,
  expected_srs_lift: null,
  value_prop: null,
  price_ref: null,
  offer_expected_points: null,
  trial_eligible: false,
  graph_writes: [],
  ...o,
});
const cap = (key: string, o: Partial<GovCapability> = {}): GovCapability => ({
  key,
  status: "draft",
  entitlement_required: null,
  side_effects: [],
  dry_run: true,
  ...o,
});
const base = (o: Partial<GovernanceInput> = {}): GovernanceInput => ({
  mode: "live",
  trigger: "manual",
  skillKey: "competitor_snapshot",
  skill: skill(),
  capabilities: [cap("compset_query"), cap("graph_query")],
  entityRequested: true,
  entity: { ref: "e1", type: "professional" },
  entitlements: [],
  approval: { approved: false, consent: false },
  implemented: ["compset_query", "graph_query"],
  now: new Date("2026-10-11T00:00:00Z"),
  ...o,
});

test("open envelope: live executes, dry run would execute", () => {
  expect(evaluateGovernance(base()).preVerdict).toBe("execute");
  expect(evaluateGovernance(base({ mode: "dry_run" })).preVerdict).toBe("would_execute");
});

test("unregistered skill blocks in both modes", () => {
  const g = evaluateGovernance(base({ skill: null }));
  expect(g.preVerdict).toBe("blocked");
  expect(evaluateGovernance(base({ skill: null, mode: "dry_run" })).preVerdict).toBe("blocked");
});

test("draft skill: live refuses, dry run allowed with a live blocker reported", () => {
  const live = evaluateGovernance(base({ skill: skill({ status: "draft" }) }));
  expect(live.preVerdict).toBe("blocked");
  const dry = evaluateGovernance(base({ mode: "dry_run", skill: skill({ status: "draft" }) }));
  expect(dry.preVerdict).toBe("would_execute");
  expect(dry.liveBlockers.some((b) => b.startsWith("publish_state"))).toBe(true);
});

test("deprecated or inactive skills block even a dry run", () => {
  expect(
    evaluateGovernance(base({ mode: "dry_run", skill: skill({ status: "deprecated" }) }))
      .preVerdict,
  ).toBe("blocked");
  expect(
    evaluateGovernance(base({ mode: "dry_run", skill: skill({ is_active: false }) })).preVerdict,
  ).toBe("blocked");
});

test("entity gates: wrong type blocks, missing entity blocks, none given is live-only", () => {
  expect(evaluateGovernance(base({ entity: { ref: "x", type: "brand" } })).preVerdict).toBe(
    "blocked",
  );
  expect(evaluateGovernance(base({ mode: "dry_run", entity: null })).preVerdict).toBe("blocked");
  const none = base({ entityRequested: false, entity: null });
  expect(evaluateGovernance(none).preVerdict).toBe("blocked");
  expect(evaluateGovernance({ ...none, mode: "dry_run" }).preVerdict).toBe("would_execute");
});

test("capabilities: unregistered blocks; registered without handler is not_implemented", () => {
  expect(evaluateGovernance(base({ capabilities: [cap("graph_query")] })).preVerdict).toBe(
    "blocked",
  );
  const g = evaluateGovernance(base({ implemented: ["graph_query"] }));
  expect(g.preVerdict).toBe("not_implemented");
  expect(g.unimplemented).toEqual(["compset_query"]);
  // "none" is a pseudo tool, not a capability
  expect(
    evaluateGovernance(base({ skill: skill({ tools_used: ["none"] }), capabilities: [] }))
      .preVerdict,
  ).toBe("execute");
});

test("approval and consent are live-only gates", () => {
  const s = skill({ autonomy: "approve", requires_user_approval: true, captures_consent: true });
  expect(evaluateGovernance(base({ skill: s })).preVerdict).toBe("blocked");
  expect(
    evaluateGovernance(base({ skill: s, approval: { approved: true, consent: false } })).preVerdict,
  ).toBe("blocked");
  expect(
    evaluateGovernance(base({ skill: s, approval: { approved: true, consent: true } })).preVerdict,
  ).toBe("execute");
  expect(evaluateGovernance(base({ skill: s, mode: "dry_run" })).preVerdict).toBe("would_execute");
});

test("autonomy gate: autonomous trigger only runs safe-autonomous skills", () => {
  expect(evaluateGovernance(base({ trigger: "autonomous" })).preVerdict).toBe("execute");
  const s = skill({ autonomy: "approve" });
  expect(
    evaluateGovernance(base({ trigger: "autonomous", skill: s, mode: "dry_run" })).preVerdict,
  ).toBe("blocked");
});

test("compliance class derivation", () => {
  const s = skill();
  expect(complianceClass(s, [cap("a")])).toBe("safe-autonomous");
  expect(complianceClass({ ...s, captures_consent: true }, [])).toBe("consent-gated");
  expect(complianceClass({ ...s, autonomy: "approve" }, [])).toBe("human-review-required");
  expect(complianceClass(s, [cap("p", { side_effects: ["public_publish"] })])).toBe("restricted");
});

test("restricted skills never publish live (compliance filter not wired)", () => {
  const caps = [cap("compset_query", { side_effects: ["content_write"] }), cap("graph_query")];
  const g = evaluateGovernance(base({ capabilities: caps }));
  expect(g.compliance).toBe("restricted");
  expect(g.preVerdict).toBe("blocked");
});

test("commercial class + entitlement state", () => {
  expect(commercialClass({ requires_entitlement: "voce", charges_money: true })).toBe(
    "paid-unlock",
  );
  expect(commercialClass({ requires_entitlement: null, charges_money: true })).toBe("metered");
  expect(commercialClass({ requires_entitlement: " ", charges_money: false })).toBe("free");
  const now = new Date("2026-10-11");
  expect(entitlementState("voce", [{ product_key: "voce", state: "active" }], now)).toBe("active");
  expect(
    entitlementState(
      "voce",
      [{ product_key: "voce", state: "active", expires_at: "2026-01-01" }],
      now,
    ),
  ).toBe("expired");
  expect(
    entitlementState("voce", [{ product_key: "voce", state: "entitled_unconfigured" }], now),
  ).toBe("entitled_unconfigured");
  expect(entitlementState("voce", [{ product_key: "nora", state: "active" }], now)).toBe(
    "not_entitled",
  );
});

test("paid-unlock without entitlement pitches instead of executing — only with positive lift", () => {
  const paid = skill({
    requires_entitlement: "voce",
    expected_srs_lift: 103,
    value_prop: "Articles",
    price_ref: "voce",
  });
  const g = evaluateGovernance(base({ skill: paid }));
  expect(g.preVerdict).toBe("pitch");
  expect(g.pitch).toMatchObject({ product_key: "voce", expected_lift: 103 });
  expect(evaluateGovernance(base({ skill: paid, mode: "dry_run" })).preVerdict).toBe("pitch");
  // integrity rule: no lift → no pitch
  expect(evaluateGovernance(base({ skill: { ...paid, expected_srs_lift: 0 } })).preVerdict).toBe(
    "blocked",
  );
  // entitled → executes
  const ok = evaluateGovernance(
    base({ skill: paid, entitlements: [{ product_key: "voce", state: "active" }] }),
  );
  expect(ok.preVerdict).toBe("execute");
  // owned but unconfigured → never pitched, live refused
  const unc = evaluateGovernance(
    base({ skill: paid, entitlements: [{ product_key: "voce", state: "entitled_unconfigured" }] }),
  );
  expect(unc.pitch).toBeNull();
  expect(unc.preVerdict).toBe("blocked");
});

test("capability entitlement missing is live-only (not a pitch)", () => {
  const caps = [cap("compset_query", { entitlement_required: "srp" }), cap("graph_query")];
  expect(evaluateGovernance(base({ capabilities: caps })).preVerdict).toBe("blocked");
  const dry = evaluateGovernance(base({ capabilities: caps, mode: "dry_run" }));
  expect(dry.preVerdict).toBe("would_execute");
  expect(dry.pitch).toBeNull();
});

test("verdict precedence and status mapping", () => {
  expect(resolveVerdict([{ outcome: "pitch" }, { outcome: "block" }], [], "dry_run")).toBe(
    "blocked",
  );
  expect(resolveVerdict([{ outcome: "pitch" }], ["x"], "live")).toBe("pitch");
  expect(resolveVerdict([{ outcome: "live" }], ["x"], "dry_run")).toBe("not_implemented");
  expect(statusFor("executed")).toBe("succeeded");
  expect(statusFor("would_execute")).toBe("succeeded");
  expect(statusFor("pitch")).toBe("blocked");
  expect(statusFor("not_implemented")).toBe("blocked");
  expect(statusFor("failed")).toBe("failed");
});

const fakeHandlers = (calls: string[]): HandlerRegistry => ({
  graph_query: {
    readOnly: true,
    run: async () => (calls.push("graph_query"), { outputs: { nodes: 3 } }),
  },
  writer: {
    readOnly: false,
    run: async () => (calls.push("writer"), { outputs: {}, graph_writes: [{ n: 1 }] }),
  },
  boom: {
    readOnly: true,
    run: async () => {
      throw new Error("nope");
    },
  },
});

test("dry run never calls a handler with side effects (handler or registry)", async () => {
  const calls: string[] = [];
  const lines: string[] = [];
  const r = await dispatchCapabilities({
    mode: "dry_run",
    capabilityKeys: ["graph_query", "writer"],
    capabilities: [cap("graph_query"), cap("writer", { side_effects: ["writes_graph"] })],
    handlers: fakeHandlers(calls),
    entity: null,
    inputs: {},
    trace: (_l, t) => lines.push(t),
  });
  expect(calls).toEqual(["graph_query"]);
  expect(r.graph_writes).toEqual([]);
  expect(lines.some((l) => l.startsWith("would call writer"))).toBe(true);
  // registry declares side effects on a read-only handler → still not called
  const calls2: string[] = [];
  await dispatchCapabilities({
    mode: "dry_run",
    capabilityKeys: ["graph_query"],
    capabilities: [cap("graph_query", { side_effects: ["writes_score"] })],
    handlers: fakeHandlers(calls2),
    entity: null,
    inputs: {},
    trace: () => {},
  });
  expect(calls2).toEqual([]);
});

test("live dispatch runs in order, collects writes, stops at first failure", async () => {
  const calls: string[] = [];
  const r = await dispatchCapabilities({
    mode: "live",
    capabilityKeys: ["writer", "boom", "graph_query"],
    capabilities: [cap("writer"), cap("boom"), cap("graph_query")],
    handlers: fakeHandlers(calls),
    entity: null,
    inputs: {},
    trace: () => {},
  });
  expect(calls).toEqual(["writer"]);
  expect(r.graph_writes).toEqual([{ n: 1 }]);
  expect(r.error).toBe("boom: nope");
});

test("run row carries exactly the live exp_skill_run columns", () => {
  const row = buildRunRow({
    skillKey: "s",
    skill: { version: "1.0.0", expected_srs_lift: 9 },
    capabilityKeys: ["graph_query"],
    entity: { ref: "e1", type: "professional" },
    entityRef: "e1",
    mode: "dry_run",
    trigger: "manual",
    verdict: "would_execute",
    trace: [],
    inputs: {},
    outputs: {},
    telemetry: runTelemetry(null, { ms_total: 1, ms_load: 0, ms_governance: 0, ms_execution: 1 }),
    graphWrites: [],
    error: null,
    actor: "u",
    startedAt: new Date(0),
    finishedAt: new Date(1),
  });
  expect(Object.keys(row).sort()).toEqual([...SKILL_RUN_COLUMNS].sort());
  expect(row.status).toBe("succeeded");
  expect(row.expected_srs_lift).toBe(9);
});

test("telemetry: no model calls yet; cost estimate from tier rate", () => {
  const t = runTelemetry(
    { key: "s", model_tier: "sonnet", reads_state: ["a"], tools_used: ["t"] },
    { ms_total: 5, ms_load: 1, ms_governance: 1, ms_execution: 3 },
  );
  expect(t.model_calls).toBe(0);
  expect(t.actual_cost_usd).toBe(0);
  expect(t.estimated_input_tokens).toBe(720);
  expect(t.estimated_cost_usd).toBeCloseTo((720 * 2) / 1e6, 9);
  expect(
    runTelemetry(
      { key: "d", model_tier: "deterministic", reads_state: [], tools_used: ["t"] },
      { ms_total: 0, ms_load: 0, ms_governance: 0, ms_execution: 0 },
    ).estimated_cost_usd,
  ).toBe(0);
});
