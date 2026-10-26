import { expect, test } from "bun:test";
import { isSuppressed, priorityScore, rankGaps } from "../src/lib/nora-sandbox";

const W = { impact: 1, feasibility: 1, urgency: 1, confidence: 1, effort_penalty: 1 };

test("priority formula", () => {
  // 20*1*0.5*(1+0.5*1)*1 - 2*1 = 13
  expect(priorityScore({ key: "a", label: "a", impact: 20, feasibility: 0.5, urgency: 0.5, effort: 2 }, W)).toBe(13);
});

test("declining the top item drops it below the rest", () => {
  const gaps = [
    { key: "va_article", label: "VA article", impact: 22, feasibility: 0.9, urgency: 0.5, effort: 2 },
    { key: "photo", label: "Photo", impact: 5, feasibility: 1, urgency: 0, effort: 1 },
  ];
  expect(rankGaps(gaps, W)[0].key).toBe("va_article");
  const r = rankGaps(gaps, W, [{ entity_id: "joy", entity_type: null, opportunity_key: "va_article", signal: "declined" }]);
  expect(r[0].key).toBe("photo");
});

test("snooze suppresses only until it expires", () => {
  const fb = [{ opportunity_key: "x", signal: "snoozed", snooze_until: "2026-11-01T00:00:00Z" }];
  expect(isSuppressed("x", fb, new Date("2026-10-10"))).toBe(true);
  expect(isSuppressed("x", fb, new Date("2026-12-01"))).toBe(false);
});

import { buildTrace, estimateTelemetry } from "../src/lib/nora-sandbox";
test("token estimate: 400 + 120/read + 200/tool, 0 when deterministic", () => {
  expect(estimateTelemetry({ key: "s", model_tier: "sonnet", reads_state: ["a", "b"], tools_used: ["t"] }).input_tokens).toBe(840);
  expect(estimateTelemetry({ key: "s", model_tier: "deterministic", tools_used: ["t"] }).input_tokens).toBe(0);
});
test("trace blocks on unmapped skill, wrong entity type, missing capability", () => {
  const g = { key: "g", label: "G" };
  expect(buildTrace(g, undefined, { entity_type: "professional" }, []).verdict).toBe("WOULD BLOCK — 1 issue(s)");
  const sk = { key: "s", entity_types: ["location"], tools_used: ["cap.x"] };
  expect(buildTrace({ ...g, skill_key: "s" }, sk, { entity_type: "professional" }, []).errors).toBe(2);
  const ok = { key: "s", entity_types: ["professional"], tools_used: ["cap.x"] };
  const t = buildTrace({ ...g, skill_key: "s", needs: "voce" }, ok, { entity_type: "professional", state: { features: { voce: { access: "none" } } } }, ["cap.x"]);
  expect(t.verdict).toBe("WOULD EXECUTE");
  expect(t.lines.some((l) => l.level === "warn" && l.text.includes("voce"))).toBe(true);
});

import { srsGapsToGaps } from "../src/lib/nora-sandbox";
test("SRS gaps map to queue items with real points and lane skills", () => {
  const g = srsGapsToGaps([
    { action: "Publish articles", gap: 103, lane: "Articles" },
    { action: "Confirm website", gap: 102, lane: "Website" },
    { action: "Fill profile", gap: 123, lane: "Completeness" },
  ]);
  expect(g[0]).toMatchObject({ key: "lane:Articles", impact: 103, feasibility: 1, skill_key: "write_market_article" });
  expect(g[1].skill_key).toBeNull();
  expect(g[2].skill_key).toBe("publish_bio");
  expect(rankGaps(g, { impact: 1, feasibility: 1, urgency: 1, confidence: 1, effort_penalty: 1 })[0].lane).toBe("Completeness");
});
