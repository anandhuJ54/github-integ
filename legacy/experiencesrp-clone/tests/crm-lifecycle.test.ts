import { describe, expect, test } from "bun:test";
import { buildTimeline, missingRequired, openOpportunityForLogo, territoryAfterClose } from "../src/lib/crm-lifecycle";

describe("stage gate", () => {
  const fields = [
    { field_label: "Why now", field_type: "text", required: true },
    { field_label: "Plan agreed", field_type: "bool", required: true },
    { field_label: "Buy-in from", field_type: "multiselect", required: true },
    { field_label: "Notes", field_type: "text", required: false },
  ];
  test("blocks when required evidence is missing", () => {
    expect(missingRequired(fields, {})).toEqual(["Why now", "Plan agreed", "Buy-in from"]);
    expect(missingRequired(fields, { "Why now": "  ", "Plan agreed": false, "Buy-in from": [] })).toHaveLength(3);
  });
  test("passes when all required evidence is captured; optional ignored", () => {
    expect(missingRequired(fields, { "Why now": "growth", "Plan agreed": true, "Buy-in from": ["CFO"] })).toEqual([]);
  });
});

describe("one open opportunity per logo", () => {
  const rows = [
    { id: "a", org_id: "L1", stage: "won", created_at: "2026-01-01" },
    { id: "b", org_id: "L1", stage: "design", created_at: "2026-03-01" },
    { id: "c", org_id: "L1", stage: "qualification", created_at: "2026-02-01" },
    { id: "d", org_id: "L2", stage: "lost", created_at: "2026-01-01" },
  ];
  test("returns the oldest open opportunity for the logo", () => expect(openOpportunityForLogo(rows, "L1")?.id).toBe("c"));
  test("closed-only logos have no open opportunity", () => expect(openOpportunityForLogo(rows, "L2")).toBeNull());
});

describe("closed-won territory removal", () => {
  const now = "2026-10-03T00:00:00Z";
  test("won hands the logo to Success", () => expect(territoryAfterClose("won", { success_handoff_at: null }, now).success_handoff_at).toBe(now));
  test("lost keeps the logo in territory", () => expect(territoryAfterClose("lost", { success_handoff_at: null }, now).success_handoff_at).toBeNull());
  test("handoff is not overwritten", () => expect(territoryAfterClose("won", { success_handoff_at: "2026-01-01" }, now).success_handoff_at).toBe("2026-01-01"));
});

describe("timeline union", () => {
  const t = buildTimeline({
    events: [{ id: "e1", event_type: "email_queued", source: "gmail", actor: "rep", occurred_at: "2026-10-01T10:00:00Z", value: { status: "pending" } }],
    claimEvents: [{ id: "c1", event_type: "claim_upgraded", source: "claim", actor: null, occurred_at: "2026-10-02T10:00:00Z" }],
    notes: [{ id: "n1", pinned: true, created_by: "rep", created_at: "2026-09-30T10:00:00Z", body: "hi" }],
    tasks: [{ id: "t1", done: false, task_type: "reminder", owner_id: "rep", due_at: null, created_at: "2026-09-29T10:00:00Z", title: "call" }],
    meetings: [{ id: "m1", attended: false, outcome: null, disposition: null, booked_at: "2026-10-05T10:00:00Z", objective: "demo", meeting_kind: "meeting", calendar_status: "pending" }],
    history: [{ id: "h1", moved_by: "u", moved_at: "2026-09-28T10:00:00Z", from_stage: "qualification", to_stage: "discovery" }],
  });
  test("includes every source, newest first", () => {
    expect(t.map((i) => i.id)).toEqual(["m1", "c1", "e1", "n1", "t1", "h1"]);
  });
  test("categorizes and labels", () => {
    expect(t.find((i) => i.id === "c1")?.category).toBe("Claims");
    expect(t.find((i) => i.id === "m1")?.eventType).toBe("meeting_booked");
    expect(t.find((i) => i.id === "m1")?.source).toBe("calendar pending");
    expect(t.find((i) => i.id === "n1")?.pinned).toBe(true);
  });
});
