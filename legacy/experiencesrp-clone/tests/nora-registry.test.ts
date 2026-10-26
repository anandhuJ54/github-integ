import { describe, expect, test } from "bun:test";
import { agentCard, capabilityUsage, missingCapabilities, skillCoverage } from "../src/lib/nora-registry";

describe("nora registry rules", () => {
  test("agent card is key · status · version", () => {
    expect(agentCard({ key: "renewal_nudge", status: "published", version: "1.2.0" })).toBe("renewal_nudge · published · 1.2.0");
  });
  test("flags tool keys with no capability row", () => {
    expect(missingCapabilities(["send_email", "create_task"], ["send_email"])).toEqual(["create_task"]);
  });
});

test("skillCoverage splits covered and missing tools", () => {
  const { covered, missing } = skillCoverage(["a", "b", "c"], ["a", "c"]);
  expect(covered).toEqual(["a", "c"]);
  expect(missing).toEqual(["b"]);
});

test("capabilityUsage maps capability keys to referencing skills", () => {
  const usedBy = capabilityUsage([
    { key: "s1", tools_used: ["cap.a", "cap.b"] },
    { key: "s2", tools_used: ["cap.a"] },
    { key: "s3", tools_used: null },
  ]);
  expect(usedBy.get("cap.a")).toEqual(["s1", "s2"]);
  expect(usedBy.get("cap.b")).toEqual(["s1"]);
  expect(usedBy.get("cap.c")).toBeUndefined();
});

import { publishBlockers } from "../src/lib/nora-registry";
test("publish gate opens only with coverage, entity types and all-pass evals", () => {
  const ok = { tools_used: ["a"], entity_types: ["professional"], triggers: ["t"] };
  expect(publishBlockers(ok, ["a"], [{ name: "e1", status: "pass" }])).toEqual([]);
  expect(publishBlockers({ ...ok, tools_used: ["b"] }, ["a"], [{ name: "e1", status: "pass" }]).length).toBe(1);
  expect(publishBlockers({ ...ok, entity_types: [] }, ["a"], [{ name: "e1", status: "pass" }])).toEqual(["No entity types set"]);
  expect(publishBlockers(ok, ["a"], [])).toEqual(["No eval fixtures exist"]);
  expect(publishBlockers(ok, ["a"], [{ name: "e1", status: "pass" }, { name: "e2", status: "untested" }])).toEqual(["Evals not passing: e2"]);
});

import { skillReadiness } from "../src/lib/nora-registry";
const base = { entity_types: ["professional"], triggers: ["t"] };
test("readiness: entity types and a trigger are required", () => {
  expect(skillReadiness(base).blockers).toEqual([]);
  expect(skillReadiness({ ...base, triggers: [] }).blockers).toEqual(["At least one trigger is required"]);
});
test("readiness: graph writes need lanes and expected lift", () => {
  expect(skillReadiness({ ...base, graph_writes: ["article"] }).blockers.length).toBe(2);
  expect(skillReadiness({ ...base, graph_writes: ["article"], affects_lanes: ["Articles"], expected_srs_lift: 20 }).blockers).toEqual([]);
});
test("readiness: entitlement needs value prop, points, price ref, mute ≥ 1; permanent dismiss only warns", () => {
  const r = skillReadiness({ ...base, requires_entitlement: "voce", decline_mute_days: 0 });
  expect(r.blockers.length).toBe(4);
  const ok = skillReadiness({ ...base, requires_entitlement: "voce", value_prop: "v", offer_expected_points: 22, price_ref: "voce_pro", decline_mute_days: 14, permanently_dismissible: true });
  expect(ok.blockers).toEqual([]);
  expect(ok.warnings.length).toBe(1);
});
test("readiness: charging money requires approval and consent", () => {
  expect(skillReadiness({ ...base, charges_money: true }).blockers.length).toBe(2);
  expect(skillReadiness({ ...base, charges_money: true, requires_user_approval: true, captures_consent: true }).blockers).toEqual([]);
});
test("readiness: tracking results requires metrics, recommends digest", () => {
  expect(skillReadiness({ ...base, tracks_results: true }).blockers).toEqual(["Tracks results but no result metrics listed"]);
  expect(skillReadiness({ ...base, tracks_results: true, result_metrics: ["srs_delta"] }).warnings.length).toBe(1);
});
