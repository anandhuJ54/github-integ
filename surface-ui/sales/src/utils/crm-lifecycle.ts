// Pure CRM lifecycle helpers shared by the Opportunity Workspace and the test harness.

export type GateField = { field_label: string; field_type: string; required: boolean };
export type TimelineCategory = "Sales" | "Product engagement" | "Claims" | "Revenue" | "NORA";
export type TimelineItem = { id: string; eventType: string; category: TimelineCategory; source: string | null; actor: string | null; occurredAt: string | null; detail?: string | null; pinned?: boolean };

/** Required evidence labels still missing for a stage gate (mirrors exp_opp_advance_stage). */
export function missingRequired(fields: GateField[], values: Record<string, unknown>): string[] {
  return fields.filter((f) => f.required).filter((f) => {
    const v = values[f.field_label];
    if (f.field_type === "bool") return v !== true;
    if (Array.isArray(v)) return v.length === 0;
    return v == null || String(v).trim() === "";
  }).map((f) => f.field_label);
}

/** One-open-per-logo: the existing open opportunity for a logo, if any (mirrors exp_opp_create). */
export function openOpportunityForLogo<T extends { org_id: string | null; stage: string | null; created_at: string | null }>(rows: T[], orgId: string): T | null {
  return rows.filter((r) => r.org_id === orgId && !["won", "lost"].includes(r.stage ?? "")).sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""))[0] ?? null;
}

/** Territory membership after a close: only Closed Won hands a logo to Success. */
export function territoryAfterClose(stage: "won" | "lost", brand: { success_handoff_at: string | null }, now: string) {
  return stage === "won" && !brand.success_handoff_at ? { ...brand, success_handoff_at: now } : brand;
}

export function categoryFor(eventType: string): TimelineCategory {
  const value = eventType.toLowerCase();
  if (value.includes("nora")) return "NORA";
  if (value.includes("claim")) return "Claims";
  if (["upgrade", "downgrade", "payment", "contract", "revenue", "won"].some((p) => value.includes(p))) return "Revenue";
  if (["engagement", "profile", "view", "click", "session", "product"].some((p) => value.includes(p))) return "Product engagement";
  return "Sales";
}

function jsonSummary(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item != null && item !== "").slice(0, 3);
  return entries.length ? entries.map(([key, item]) => `${key.replaceAll("_", " ")}: ${Array.isArray(item) ? item.join(", ") : String(item)}`).join(" · ") : null;
}

export type TimelineSources = {
  events: { id: string; event_type: string; source: string | null; actor: string | null; occurred_at: string | null; value?: unknown }[];
  claimEvents: { id: string; event_type: string; source: string | null; actor: string | null; occurred_at: string | null; value?: unknown }[];
  notes: { id: string; pinned: boolean | null; created_by: string | null; created_at: string | null; body: string | null }[];
  tasks: { id: string; done: boolean | null; task_type: string | null; owner_id: string | null; due_at: string | null; created_at: string | null; title: string | null }[];
  meetings: { id: string; attended: boolean | null; outcome: string | null; disposition: string | null; booked_at: string | null; objective: string | null; meeting_kind?: string | null; calendar_status?: string | null }[];
  history: { id: string; moved_by: string | null; moved_at: string | null; from_stage: string | null; to_stage: string | null }[];
};

/** Union of every opportunity record type into one newest-first timeline. */
export function buildTimeline(data: TimelineSources): TimelineItem[] {
  const activity = [...data.events, ...data.claimEvents].map((e) => ({ id: e.id, eventType: e.event_type, category: categoryFor(e.event_type), source: e.source, actor: e.actor, occurredAt: e.occurred_at, detail: jsonSummary(e.value) }));
  const notes = data.notes.map((n) => ({ id: n.id, eventType: n.pinned ? "pinned_note" : "note", category: "Sales" as const, source: "note", actor: n.created_by, occurredAt: n.created_at, detail: n.body, pinned: !!n.pinned }));
  const tasks = data.tasks.map((t) => ({ id: t.id, eventType: t.done ? "task_completed" : "task_created", category: "Sales" as const, source: t.task_type, actor: t.owner_id, occurredAt: t.done ? t.due_at : t.created_at, detail: t.title }));
  const demos = data.meetings.map((m) => { const kind = m.meeting_kind === "meeting" ? "meeting" : "demo"; return { id: m.id, eventType: m.attended && m.outcome ? `${kind}_completed` : `${kind}_booked`, category: "Sales" as const, source: m.calendar_status ? `calendar ${m.calendar_status}` : (m.disposition ?? kind), actor: null, occurredAt: m.booked_at, detail: m.outcome ?? m.objective }; });
  const stages = data.history.map((h) => ({ id: h.id, eventType: "stage_changed", category: "Sales" as const, source: "stage engine", actor: h.moved_by, occurredAt: h.moved_at, detail: `${h.from_stage ?? "—"} → ${h.to_stage ?? "—"}` }));
  return [...activity, ...notes, ...tasks, ...demos, ...stages].sort((a, b) => Date.parse(b.occurredAt ?? "") - Date.parse(a.occurredAt ?? ""));
}
