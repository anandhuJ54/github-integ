import { api } from "@v3/ui/lib/server-fn";
import type { Json } from "@v3/ui/integrations/supabase/types";
import { rollupLogoIntelligence, type LogoIntelligence, type LogoCatalogPrice, type LogoClaimSignal } from "@v3/sales/lib/logo-intelligence";

/* ══════════════════ Types ══════════════════ */

export type Stage = { key: string; label: string; sort: number; is_open: boolean | null };

export type StageField = {
  id: string;
  stage_key: string;
  field_label: string;
  field_type: string;
  required: boolean;
  sort: number;
};

export type OppRow = {
  id: string;
  name: string;
  owner: string | null;
  stage: string;
  value: number | null;
  probability: number | null;
  account_id: string | null;
  org_id: string | null;
  expected_close: string | null;
  product_summary: string | null;
  source_owner: string | null;
  source_channel: string | null;
  lost_reason: string | null;
  win_back: boolean | null;
  notes: string | null;
  is_demo: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type OpportunityBrand = {
  name: string;
  gcid: string | null;
  logo_url: string | null;
  locations: number | null;
};

export type OpportunityTeammate = {
  id: string;
  name: string;
  photo_url: string | null;
  role: string | null;
  lane_role: string | null;
  is_nora: boolean;
};

export type OpportunityMeeting = {
  id: string;
  booked_at: string | null;
  objective: string | null;
  agenda: string | null;
  attendees: unknown;
  outcome: string | null;
  attended: boolean | null;
  recording_url: string | null;
  follow_up: string | null;
  disposition: string | null;
  meeting_kind: string | null;
  calendar_status: string | null;
};

export type AccountRow = {
  id: string;
  name: string;
  account_type: string | null;
  account_stage: string | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  active_arr: number | null;
  org_id: string | null;
};

export type OppContact = {
  link_id: string;
  contact_id: string | null;
  role: string | null;
  is_champion: boolean | null;
  is_primary: boolean | null;
  relationship_strength: number | null;
  last_touch_at: string | null;
  source_origin: string | null;
  champion_detail: unknown;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
};

export type OppProduct = {
  id: string;
  product: string | null;
  qty: number | null;
  unit_price: number | null;
  amount: number | null;
};

export type OppNote = {
  id: string;
  body: string | null;
  created_at: string | null;
  created_by: string | null;
  pinned: boolean | null;
  mentions: string[] | null;
};

export type OppTask = {
  id: string;
  title: string | null;
  task_type: string | null;
  due_at: string | null;
  done: boolean | null;
  priority: string | null;
  owner_id: string | null;
  created_at: string | null;
};

export type OppFile = {
  id: string;
  filename: string | null;
  kind: string | null;
  storage_url: string | null;
  size_bytes: number | null;
  uploaded_at: string | null;
  uploaded_by: string | null;
};

export type OppEvent = {
  id: string;
  event_type: string;
  source: string | null;
  actor: string | null;
  occurred_at: string | null;
  value: unknown;
};

export type StageMove = {
  id: string;
  from_stage: string | null;
  to_stage: string | null;
  captured: unknown;
  moved_by: string | null;
  moved_at: string | null;
};

export type OpportunityFile = {
  opp: OppRow;
  account: AccountRow | null;
  ownerName: string | null;
  brand: OpportunityBrand | null;
  team: OpportunityTeammate[];
  meetings: OpportunityMeeting[];
  claimEvents: OppEvent[];
  stages: Stage[];
  contacts: OppContact[];
  products: OppProduct[];
  notes: OppNote[];
  tasks: OppTask[];
  files: OppFile[];
  events: OppEvent[];
  history: StageMove[];
  intelligence: LogoIntelligence | null;
  quoteId: string | null;
};

/* ══════════════════ Helpers ══════════════════ */

export const usd = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n ?? 0);

export function contactName(c: OppContact | null | undefined) {
  if (!c) return "—";
  const n = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return n || c.email || "Unnamed contact";
}

/** The next stage by sort order. An unmapped stage sits before the first one. */
export function nextStage(stages: Stage[], current: string): Stage | null {
  const cur = stages.find((s) => s.key === current);
  if (!cur) return stages[0] ?? null;
  return stages.find((s) => s.sort > cur.sort) ?? null;
}

/* ══════════════════ Reads ══════════════════ */

// FastAPI: surface-api/sales/routers/opportunity_data.py (runs as the signed-in user). The
// opportunity file's reads come back in one response, raw; the joins, the team and contact
// mapping and the logo-intelligence rollup below are unchanged.
const O = "/sales/opportunities";
const enc = (id: string) => encodeURIComponent(id);

type StageRow = { key: string; label: string | null; sort: number | null; is_open: boolean | null };
const toStages = (rows: StageRow[]): Stage[] =>
  (rows ?? []).map((s) => ({
    key: s.key,
    label: s.label ?? s.key,
    sort: s.sort ?? 0,
    is_open: s.is_open,
  }));

export async function loadStages(): Promise<Stage[]> {
  return toStages(await api.get<StageRow[]>(`${O}/stages`));
}

export type OppListRow = OppRow & { accountName: string | null; ownerName: string | null };

export async function loadOpportunityList(): Promise<{ rows: OppListRow[]; stages: Stage[] }> {
  const [stages, res] = await Promise.all([
    loadStages(),
    api.get<{ opps: (OppRow & { created_by: string | null })[]; accounts: { id: string; name: string }[]; reps: { id: string; name: string }[] }>(
      `${O}/list-rows`,
    ),
  ]);
  const accts = new Map((res.accounts ?? []).map((a) => [a.id, a.name]));
  const reps = new Map((res.reps ?? []).map((r) => [r.id, r.name]));
  const rows = (res.opps ?? []).map((o) => ({
    ...(o as OppRow),
    accountName: o.account_id ? accts.get(o.account_id) ?? null : null,
    ownerName: o.owner ? reps.get(o.owner) ?? null : null,
  }));
  return { rows, stages };
}

type LinkRow = {
  id: string;
  contact_id: string | null;
  role: string | null;
  is_champion: boolean | null;
  is_primary: boolean | null;
  relationship_strength: number | null;
  last_touch_at: string | null;
  source_origin: string | null;
  champion_detail: unknown;
};

/** GET /sales/opportunities/{id}/file: every read of the file, raw (null: no such opportunity). */
type FileRows = {
  opp: OppRow & { created_by: string | null };
  stages: StageRow[];
  links: LinkRow[];
  products: OppProduct[];
  notes: OppNote[];
  tasks: OppTask[];
  files: OppFile[];
  events: OppEvent[];
  history: StageMove[];
  account: AccountRow | null;
  ownerRep: { name: string } | null;
  meetings: OpportunityMeeting[];
  brand: { id: string; name: string | null; gcid: string | null; logo_url: string | null } | null;
  claims: LogoClaimSignal[];
  contracts: { id: string; mrr: number | null; status: string | null }[];
  prices: Omit<LogoCatalogPrice, "product_name">[];
  productCatalog: { product_key: string; name: string | null }[];
  quote: { name: string | null } | null;
  people: { id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null; job_title: string | null }[];
  lines: { product_key: string | null }[];
  scores: { entity_id: string; total_score: number | null }[];
  /** The brand's child-organization count; null when skipped or the count failed. */
  locations: number | null;
  territoryLinks: { territory_id: string }[];
  seats: { rep_id: string; lane_role: string | null; is_nora_default: boolean | null }[];
  teamReps: { id: string; name: string; photo_url: string | null; role: string | null; title: string | null }[];
};

export async function loadOpportunityFile(oppId: string): Promise<OpportunityFile | null> {
  const r = await api.get<FileRows | null>(`${O}/${enc(oppId)}/file`);
  if (!r) return null;
  const opp = r.opp;
  const stages = toStages(r.stages);

  let brand: OpportunityBrand | null = null;
  let team: OpportunityTeammate[] = [];
  if (r.brand && opp.org_id) {
    brand = {
      name: r.brand.name ?? opp.name,
      gcid: r.brand.gcid ?? null,
      logo_url: r.brand.logo_url ?? null,
      locations: r.locations,
    };
    const repIds = [...new Set([...(r.seats ?? []).map((row) => row.rep_id), opp.owner].filter((id): id is string => !!id))];
    if (repIds.length) {
      const seatByRep = new Map((r.seats ?? []).map((row) => [row.rep_id, row]));
      team = (r.teamReps ?? []).map((rep) => {
        const seat = seatByRep.get(rep.id) as { lane_role?: string | null; is_nora_default?: boolean | null } | undefined;
        return { id: rep.id, name: rep.name, photo_url: rep.photo_url, role: rep.title ?? rep.role, lane_role: seat?.lane_role ?? (rep.id === opp.owner ? "Owner" : null), is_nora: !!seat?.is_nora_default || /nora/i.test(rep.name) };
      });
    }
  }

  const links = r.links ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const people = new Map<string, any>((r.people ?? []).map((p) => [p.id, p]));

  const contacts: OppContact[] = links.map((l) => {
    const p = l.contact_id ? people.get(l.contact_id) : null;
    return {
      link_id: l.id,
      contact_id: l.contact_id,
      role: l.role,
      is_champion: l.is_champion,
      is_primary: l.is_primary,
      relationship_strength: l.relationship_strength,
      last_touch_at: l.last_touch_at,
      source_origin: l.source_origin ?? p?.source_origin ?? null,
      champion_detail: l.champion_detail,
      first_name: p?.first_name ?? null,
      last_name: p?.last_name ?? null,
      email: p?.email ?? null,
      phone: p?.phone ?? null,
      job_title: p?.job_title ?? null,
    };
  });

  const activeContracts = r.contracts ?? [];
  const claimSignals = r.claims ?? [];
  const scoreMap = new Map<string, number>((r.scores ?? []).flatMap((row) => row.total_score == null ? [] : [[row.entity_id, Number(row.total_score)]]));
  const productNames = new Map<string, string>((r.productCatalog ?? []).map((row) => [row.product_key, row.name ?? row.product_key]));
  const intelligence = opp.org_id ? rollupLogoIntelligence({
    claims: claimSignals,
    catalog: (r.prices ?? []).map((row) => ({ ...row, product_name: row.product_key ? productNames.get(row.product_key) ?? row.product_key : null })),
    ownedProductKeys: (r.lines ?? []).map((row) => row.product_key).filter((key): key is string => !!key),
    currentArr: activeContracts.reduce((sum, row) => sum + Number(row.mrr ?? 0) * 12, 0),
    likelyProductKeys: (r.products ?? []).map((row) => row.product).filter((key): key is string => !!key),
    scores: scoreMap,
  }) : null;

  return {
    opp: opp as OppRow,
    account: r.account ?? null,
    ownerName: r.ownerRep?.name ?? null,
    brand,
    team,
    meetings: r.meetings ?? [],
    claimEvents: claimSignals.slice(0, 200).map((row) => ({ id: row.id, event_type: row.event_type ?? "claim", source: "claim", actor: row.entity_label, occurred_at: row.occurred_at, value: row.nora_engagement == null ? null : { engagement: row.nora_engagement } })),
    stages,
    contacts,
    products: r.products ?? [],
    notes: r.notes ?? [],
    tasks: r.tasks ?? [],
    files: r.files ?? [],
    events: r.events ?? [],
    history: r.history ?? [],
    intelligence,
    quoteId: r.quote?.name ?? null,
  };
}

export async function loadStageRequirements(stageKey: string): Promise<StageField[]> {
  const data = await api.get<{ id: string; stage_key: string | null; field_label: string | null; field_type: string | null; required: boolean | null; sort: number | null }[]>(
    `${O}/stage-requirements`,
    { params: { stage_key: stageKey } },
  );
  return (data ?? []).map((f) => ({
    id: f.id,
    stage_key: f.stage_key ?? stageKey,
    field_label: f.field_label ?? "Field",
    field_type: f.field_type ?? "text",
    required: !!f.required,
    sort: f.sort ?? 0,
  }));
}

export type OwnerChange = { id: string; from_owner: string | null; to_owner: string | null; changed_by: string | null; changed_at: string };
export type PromoRedemption = { id: string; code: string; redeemed_at: string | null };

/** AuditPanel (opportunity-automation.tsx): owner changes, newest first, and the quote's promo
 *  redemptions (none without a quote). Errors read as empty, as before. */
export async function loadOpportunityAuditTrail(opportunityId: string, quoteId: string | null): Promise<{ owners: OwnerChange[]; promos: PromoRedemption[] }> {
  const r = await api.get<{ owners: OwnerChange[]; promos: PromoRedemption[] }>(`${O}/${enc(opportunityId)}/audit-trail`, {
    params: { quote_id: quoteId || undefined },
  });
  return { owners: r.owners ?? [], promos: r.promos ?? [] };
}

/* ══════════════════ Writes ══════════════════ */
// One request per former supabase-js call, in the same order (row → activity → audit_log), so a
// failed audit row still leaves the row written, as before. Constant columns (subject_type,
// source "manual", done false, …) and occurred_at (server clock) are set by the server.

export async function addContact(input: {
  opportunityId: string;
  accountId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  role: string | null;
  isChampion: boolean;
  isPrimary: boolean;
  relationshipStrength: number | null;
  lastTouchAt: string | null;
  championDetail: Json | null;
}) {
  const data = await api.post<{ id: string }>(`${O}/contacts`, {
    account_id: input.accountId,
    first_name: input.firstName || null,
    last_name: input.lastName || null,
    email: input.email || null,
    phone: input.phone || null,
    job_title: input.jobTitle || null,
  });

  await api.post(`${O}/${enc(input.opportunityId)}/contact-links`, {
    contact_id: data.id,
    role: input.role || null,
    is_champion: input.isChampion,
    is_primary: input.isPrimary,
    relationship_strength: input.relationshipStrength,
    last_touch_at: input.lastTouchAt,
    champion_detail: input.championDetail,
  });
  await recordOpportunityActivity(input.opportunityId, input.accountId, "contact_added", { contact_id: data.id, role: input.role });
}

export async function addOppNote(input: {
  opportunityId: string;
  subjectLabel: string;
  sellerId: string | null;
  body: string;
  pinned?: boolean;
  mentions?: string[];
}) {
  const data = await api.post<{ id: string }>(`${O}/${enc(input.opportunityId)}/notes`, {
    subject_label: input.subjectLabel,
    seller_id: input.sellerId,
    created_by: input.sellerId,
    body: input.body,
    pinned: input.pinned ?? false,
    mentions: input.mentions ?? [],
  });
  await auditOpportunityWrite(input.opportunityId, "opportunity_note_added", { note_id: data.id, pinned: input.pinned ?? false });
  return data.id;
}

export async function updateOppNote(input: { opportunityId: string; noteId: string; body: string; pinned: boolean; mentions: string[] }) {
  await api.patch(`${O}/${enc(input.opportunityId)}/notes/${enc(input.noteId)}`, { body: input.body, pinned: input.pinned, mentions: input.mentions });
  await auditOpportunityWrite(input.opportunityId, "opportunity_note_updated", { note_id: input.noteId, pinned: input.pinned });
}

export async function addOppTask(input: {
  opportunityId: string;
  accountId: string | null;
  ownerId: string | null;
  title: string;
  taskType: string;
  dueAt: string | null;
  priority: string;
}) {
  const data = await api.post<{ id: string }>(`${O}/${enc(input.opportunityId)}/tasks`, {
    account_id: input.accountId,
    owner_id: input.ownerId,
    title: input.title,
    task_type: input.taskType,
    due_at: input.dueAt,
    priority: input.priority,
  });
  await auditOpportunityWrite(input.opportunityId, "opportunity_task_added", { task_id: data.id, task_type: input.taskType });
  return data.id;
}

export async function setTaskDone(opportunityId: string, taskId: string, done: boolean) {
  await api.patch(`${O}/tasks/${enc(taskId)}`, { done });
  await auditOpportunityWrite(opportunityId, done ? "opportunity_task_completed" : "opportunity_task_reopened", { task_id: taskId });
}

export async function convertNoteToTask(input: { opportunityId: string; accountId: string | null; ownerId: string | null; noteId: string; title: string; dueAt: string | null }) {
  const taskId = await addOppTask({ opportunityId: input.opportunityId, accountId: input.accountId, ownerId: input.ownerId, title: input.title, taskType: "note_follow_up", dueAt: input.dueAt, priority: "normal" });
  await auditOpportunityWrite(input.opportunityId, "opportunity_note_converted_to_task", { note_id: input.noteId, task_id: taskId });
  return taskId;
}

export async function updateOpportunityContact(input: { opportunityId: string; linkId: string; isChampion: boolean; relationshipStrength: number | null; lastTouchAt: string | null; championDetail: Json | null }) {
  await api.patch(`${O}/${enc(input.opportunityId)}/contact-links/${enc(input.linkId)}`, { is_champion: input.isChampion, relationship_strength: input.relationshipStrength, last_touch_at: input.lastTouchAt, champion_detail: input.championDetail });
  await auditOpportunityWrite(input.opportunityId, "opportunity_contact_updated", { link_id: input.linkId, is_champion: input.isChampion });
}

export async function logOpportunityActivity(input: { opportunityId: string; accountId: string | null; eventType: string; actor: string | null; value?: Json }) {
  await recordOpportunityActivity(input.opportunityId, input.accountId, input.eventType, input.value ?? {}, input.actor);
}

export async function bookOpportunityDemo(input: { opportunityId: string; sellerId: string | null; bookedAt: string; objective: string; agenda: string; attendees: string[] }) {
  const data = await api.post<{ id: string }>(`${O}/${enc(input.opportunityId)}/demos`, { seller_id: input.sellerId, booked_at: input.bookedAt, objective: input.objective, agenda: input.agenda || null, attendees: input.attendees });
  await auditOpportunityWrite(input.opportunityId, "opportunity_demo_booked", { demo_id: data.id, booked_at: input.bookedAt });
  return data.id;
}

export async function completeOpportunityDemo(input: { opportunityId: string; demoId: string; outcome: string; followUp: string | null; disposition: string; recordingUrl: string | null }) {
  await api.post(`${O}/${enc(input.opportunityId)}/demos/${enc(input.demoId)}/complete`, { outcome: input.outcome, follow_up: input.followUp, disposition: input.disposition, recording_url: input.recordingUrl });
  await auditOpportunityWrite(input.opportunityId, "opportunity_demo_completed", { demo_id: input.demoId, disposition: input.disposition });
}

async function recordOpportunityActivity(opportunityId: string, accountId: string | null, eventType: string, value: Json, actor: string | null = null) {
  await api.post(`${O}/${enc(opportunityId)}/activity`, { event_type: eventType, account_id: accountId, actor, value });
  await auditOpportunityWrite(opportunityId, eventType, value);
}

async function auditOpportunityWrite(opportunityId: string, action: string, fieldChanges: Json) {
  await api.post(`${O}/${enc(opportunityId)}/audit`, { action, field_changes: fieldChanges });
}

/** Records the file row only — storage upload is not wired yet. */
export async function recordOppFile(input: {
  opportunityId: string;
  filename: string;
  kind: string;
  sizeBytes: number | null;
  uploadedBy: string | null;
}) {
  await api.post(`${O}/${enc(input.opportunityId)}/files`, {
    filename: input.filename,
    kind: input.kind,
    size_bytes: input.sizeBytes,
    uploaded_by: input.uploadedBy,
  });
}

/** The allow-listed exp_opp_* functions (role-checked SECURITY DEFINER), as the signed-in user. */
const oppRpc = (name: string, args: Record<string, unknown>) => api.post<string>(`${O}/rpc/${name}`, { args });

/** Captures the current stage's gate answers, then moves the opportunity forward. */
export async function advanceStage(input: {
  opportunityId: string;
  toStage: string;
  captured: Record<string, unknown>;
}) {
  return oppRpc("exp_opp_advance_stage", { p_opp: input.opportunityId, p_target: input.toStage, p_captured: input.captured });
}

export async function closeOpportunityLost(input: { opportunityId: string; reason: string; competitor: string | null; revisit: string | null }) {
  return oppRpc("exp_opp_close_lost", { p_opp: input.opportunityId, p_reason: input.reason, p_competitor: input.competitor, p_revisit: input.revisit });
}

export async function closeOpportunityWon(input: { opportunityId: string; captured: Record<string, unknown> }) {
  return oppRpc("exp_opp_close_won", { p_opp: input.opportunityId, p_captured: input.captured });
}
