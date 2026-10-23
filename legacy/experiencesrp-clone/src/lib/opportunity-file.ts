import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { rollupLogoIntelligence, type LogoIntelligence, type LogoCatalogPrice, type LogoClaimSignal } from "@/lib/logo-intelligence";

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

export async function loadStages(): Promise<Stage[]> {
  const { data, error } = await supabase
    .from("exp_pipeline_stages")
    .select("key,label,sort,is_open")
    .order("sort");
  if (error) throw error;
  return (data ?? []).map((s) => ({
    key: s.key,
    label: s.label ?? s.key,
    sort: s.sort ?? 0,
    is_open: s.is_open,
  }));
}

export type OppListRow = OppRow & { accountName: string | null; ownerName: string | null };

export async function loadOpportunityList(): Promise<{ rows: OppListRow[]; stages: Stage[] }> {
  const [stages, oppRes, acctRes, repRes] = await Promise.all([
    loadStages(),
    supabase
      .from("exp_sales_pipeline")
      .select(
        "id,name,owner,stage,value,probability,account_id,org_id,expected_close,product_summary,source_owner,source_channel,lost_reason,win_back,notes,is_demo,created_at,updated_at,created_by",
      )
      .order("value", { ascending: false })
      .limit(500),
    supabase.from("exp_accounts").select("id,name"),
    supabase.from("exp_sales_reps").select("id,name"),
  ]);
  if (oppRes.error) throw oppRes.error;
  const accts = new Map((acctRes.data ?? []).map((a) => [a.id, a.name]));
  const reps = new Map((repRes.data ?? []).map((r) => [r.id, r.name]));
  const rows = (oppRes.data ?? []).map((o) => ({
    ...(o as OppRow),
    accountName: o.account_id ? accts.get(o.account_id) ?? null : null,
    ownerName: o.owner ? reps.get(o.owner) ?? null : null,
  }));
  return { rows, stages };
}

export async function loadOpportunityFile(oppId: string): Promise<OpportunityFile | null> {
  const { data: opp, error } = await supabase
    .from("exp_sales_pipeline")
    .select(
      "id,name,owner,stage,value,probability,account_id,org_id,expected_close,product_summary,source_owner,source_channel,lost_reason,win_back,notes,is_demo,created_at,updated_at,created_by",
    )
    .eq("id", oppId)
    .maybeSingle();
  if (error) throw error;
  if (!opp) return null;

  const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };
  const [stages, linkRes, prodRes, noteRes, taskRes, fileRes, evRes, histRes, acctRes, repRes, meetingRes, brandRes, claimRes, contractRes, priceRes, productCatalogRes, quoteRes] =
    await Promise.all([
      loadStages(),
      supabase
        .from("exp_opportunity_contacts")
        .select("id,contact_id,role,is_champion,is_primary,relationship_strength,last_touch_at,source_origin,champion_detail")
        .eq("opportunity_id", oppId),
      supabase
        .from("exp_opportunity_products")
        .select("id,product,qty,unit_price,amount")
        .eq("opportunity_id", oppId),
      supabase
        .from("exp_sales_notes")
        .select("id,body,created_at,created_by,pinned,mentions")
        .eq("subject_type", "opportunity")
        .eq("subject_id", oppId)
        .order("created_at", { ascending: false }),
      supabase
        .from("exp_sales_tasks")
        .select("id,title,task_type,due_at,done,priority,owner_id,created_at")
        .eq("opportunity_id", oppId)
        .order("due_at", { ascending: true }),
      supabase
        .from("exp_opportunity_files")
        .select("id,filename,kind,storage_url,size_bytes,uploaded_at,uploaded_by")
        .eq("opportunity_id", oppId)
        .order("uploaded_at", { ascending: false }),
      supabase
        .from("exp_activity_events")
        .select("id,event_type,source,actor,occurred_at,value")
        .or([`and(subject_type.eq.opportunity,subject_id.eq.${oppId})`, ...(opp.account_id ? [`account_id.eq.${opp.account_id}`] : [])].join(","))
        .order("occurred_at", { ascending: false })
        .limit(200),
      supabase
        .from("exp_opportunity_stage_history")
        .select("id,from_stage,to_stage,captured,moved_by,moved_at")
        .eq("opportunity_id", oppId)
        .order("moved_at", { ascending: false }),
      opp.account_id
        ? supabase
            .from("exp_accounts")
            .select("id,name,account_type,account_stage,industry,city,region,active_arr,org_id")
            .eq("id", opp.account_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
      opp.owner
        ? /^[0-9a-f-]{36}$/i.test(opp.owner)
          ? supabase.from("exp_sales_reps").select("name").eq("id", opp.owner).maybeSingle()
          : supabase.from("exp_sales_reps").select("name").eq("name", opp.owner).maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
      db.from("exp_sales_demos").select("id,booked_at,objective,agenda,attendees,outcome,attended,recording_url,follow_up,disposition,meeting_kind,calendar_status").eq("opportunity_id", oppId).order("booked_at", { ascending: true }),
      opp.org_id && /^[0-9a-f-]{36}$/i.test(opp.org_id)
        ? db.from("organizations").select("id,name,gcid,logo_url").eq("id", opp.org_id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
      opp.org_id && /^[0-9a-f-]{36}$/i.test(opp.org_id)
        ? db.from("exp_claim_events").select("id,entity_id,entity_label,entity_type,event_type,occurred_at,nora_engagement,upgraded").eq("logo_org_id", opp.org_id).order("occurred_at", { ascending: false }).limit(10000)
        : Promise.resolve({ data: [], error: null } as const),
      opp.org_id ? db.from("exp_contracts").select("id,mrr,status").eq("org_id", opp.org_id).in("status", ["active", "won"]) : Promise.resolve({ data: [], error: null } as const),
      db.from("exp_price_book").select("product_key,scope,unit,billing_type,list_price"),
      db.from("exp_products").select("product_key,name"),
      db.from("exp_quotes").select("name").eq("opportunity_id", oppId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

  let brand: OpportunityBrand | null = null;
  let team: OpportunityTeammate[] = [];
  if (brandRes.data && opp.org_id) {
    const [locationsRes, linksRes] = await Promise.all([
      db.from("organizations").select("id", { count: "exact", head: true }).eq("parent_org_id", opp.org_id),
      db.from("exp_territory_brand").select("territory_id").eq("org_id", opp.org_id),
    ]);
    brand = {
      name: brandRes.data.name ?? opp.name,
      gcid: brandRes.data.gcid ?? null,
      logo_url: brandRes.data.logo_url ?? null,
      locations: locationsRes.error ? null : locationsRes.count ?? 0,
    };
    const territoryIds = [...new Set((linksRes.data ?? []).map((row: { territory_id: string }) => row.territory_id))];
    const seatRes = territoryIds.length
      ? await db.from("exp_territory_seats").select("rep_id,lane_role,is_nora_default").in("territory_id", territoryIds)
      : { data: [], error: null };
    const repIds = [...new Set([...(seatRes.data ?? []).map((row: { rep_id: string }) => row.rep_id), opp.owner].filter((id): id is string => !!id))];
    if (repIds.length) {
      const repsRes = await db.from("exp_sales_reps").select("id,name,photo_url,role,title").in("id", repIds);
      const seatByRep = new Map((seatRes.data ?? []).map((row: { rep_id: string; lane_role: string | null; is_nora_default: boolean | null }) => [row.rep_id, row]));
      team = (repsRes.data ?? []).map((rep: { id: string; name: string; photo_url: string | null; role: string | null; title: string | null }) => {
        const seat = seatByRep.get(rep.id) as { lane_role?: string | null; is_nora_default?: boolean | null } | undefined;
        return { id: rep.id, name: rep.name, photo_url: rep.photo_url, role: rep.title ?? rep.role, lane_role: seat?.lane_role ?? (rep.id === opp.owner ? "Owner" : null), is_nora: !!seat?.is_nora_default || /nora/i.test(rep.name) };
      });
    }
  }

  const links = linkRes.data ?? [];
  const contactIds = links.map((l) => l.contact_id).filter((x): x is string => !!x);
  let people = new Map<string, any>();
  if (contactIds.length) {
    const { data } = await supabase
      .from("exp_contacts")
      .select("id,first_name,last_name,email,phone,job_title")
      .in("id", contactIds);
    people = new Map((data ?? []).map((p) => [p.id, p]));
  }

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

  const activeContracts = (contractRes.data ?? []) as { id: string; mrr: number | null; status: string | null }[];
  const contractIds = activeContracts.map((row) => row.id);
  const lineRes = contractIds.length ? await db.from("exp_contract_line_items").select("product_key").in("contract_id", contractIds) : { data: [], error: null };
  const claimSignals = (claimRes.data ?? []) as LogoClaimSignal[];
  const scoreIds = [...new Set(claimSignals.map((row) => row.entity_id).filter((id): id is string => !!id && /^[0-9a-f-]{36}$/i.test(id)))];
  const scoreRes = scoreIds.length ? await db.from("search_rank_scores").select("entity_id,total_score").in("entity_id", scoreIds) : { data: [], error: null };
  const scoreMap = new Map<string, number>(((scoreRes.data ?? []) as { entity_id: string; total_score: number | null }[]).flatMap((row) => row.total_score == null ? [] : [[row.entity_id, Number(row.total_score)]]));
  const productNames = new Map<string, string>(((productCatalogRes.data ?? []) as { product_key: string; name: string | null }[]).map((row) => [row.product_key, row.name ?? row.product_key]));
  const intelligence = opp.org_id ? rollupLogoIntelligence({
    claims: claimSignals,
    catalog: ((priceRes.data ?? []) as Omit<LogoCatalogPrice, "product_name">[]).map((row) => ({ ...row, product_name: row.product_key ? productNames.get(row.product_key) ?? row.product_key : null })),
    ownedProductKeys: ((lineRes.data ?? []) as { product_key: string | null }[]).map((row) => row.product_key).filter((key): key is string => !!key),
    currentArr: activeContracts.reduce((sum, row) => sum + Number(row.mrr ?? 0) * 12, 0),
    likelyProductKeys: (prodRes.data ?? []).map((row) => row.product).filter((key): key is string => !!key),
    scores: scoreMap,
  }) : null;

  return {
    opp: opp as OppRow,
    account: (acctRes.data as AccountRow | null) ?? null,
    ownerName: (repRes.data as { name: string } | null)?.name ?? null,
    brand,
    team,
    meetings: (meetingRes.data ?? []) as OpportunityMeeting[],
    claimEvents: claimSignals.slice(0, 200).map((row) => ({ id: row.id, event_type: row.event_type ?? "claim", source: "claim", actor: row.entity_label, occurred_at: row.occurred_at, value: row.nora_engagement == null ? null : { engagement: row.nora_engagement } })),
    stages,
    contacts,
    products: (prodRes.data ?? []) as OppProduct[],
    notes: (noteRes.data ?? []) as OppNote[],
    tasks: (taskRes.data ?? []) as OppTask[],
    files: (fileRes.data ?? []) as OppFile[],
    events: (evRes.data ?? []) as OppEvent[],
    history: (histRes.data ?? []) as StageMove[],
    intelligence,
    quoteId: (quoteRes.data as { name: string | null } | null)?.name ?? null,
  };
}

export async function loadStageRequirements(stageKey: string): Promise<StageField[]> {
  const { data, error } = await supabase
    .from("exp_stage_requirements")
    .select("id,stage_key,field_label,field_type,required,sort")
    .eq("stage_key", stageKey)
    .order("sort");
  if (error) throw error;
  return (data ?? []).map((f) => ({
    id: f.id,
    stage_key: f.stage_key ?? stageKey,
    field_label: f.field_label ?? "Field",
    field_type: f.field_type ?? "text",
    required: !!f.required,
    sort: f.sort ?? 0,
  }));
}

/* ══════════════════ Writes ══════════════════ */

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
  const { data, error } = await supabase
    .from("exp_contacts")
    .insert({
      account_id: input.accountId,
      first_name: input.firstName || null,
      last_name: input.lastName || null,
      email: input.email || null,
      phone: input.phone || null,
      job_title: input.jobTitle || null,
      source_origin: "manual",
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: linkError } = await supabase.from("exp_opportunity_contacts").insert({
    opportunity_id: input.opportunityId,
    contact_id: data.id,
    role: input.role || null,
    is_champion: input.isChampion,
    is_primary: input.isPrimary,
    relationship_strength: input.relationshipStrength,
    last_touch_at: input.lastTouchAt,
    source_origin: "manual",
    champion_detail: input.championDetail,
  });
  if (linkError) throw linkError;
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
  const { data, error } = await supabase.from("exp_sales_notes").insert({
    subject_type: "opportunity",
    subject_id: input.opportunityId,
    subject_label: input.subjectLabel,
    seller_id: input.sellerId,
    created_by: input.sellerId,
    body: input.body,
    pinned: input.pinned ?? false,
    mentions: input.mentions ?? [],
  }).select("id").single();
  if (error) throw error;
  await auditOpportunityWrite(input.opportunityId, "opportunity_note_added", { note_id: data.id, pinned: input.pinned ?? false });
  return data.id;
}

export async function updateOppNote(input: { opportunityId: string; noteId: string; body: string; pinned: boolean; mentions: string[] }) {
  const { error } = await supabase.from("exp_sales_notes").update({ body: input.body, pinned: input.pinned, mentions: input.mentions }).eq("id", input.noteId).eq("subject_type", "opportunity").eq("subject_id", input.opportunityId);
  if (error) throw error;
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
  const { data, error } = await supabase.from("exp_sales_tasks").insert({
    opportunity_id: input.opportunityId,
    account_id: input.accountId,
    owner_id: input.ownerId,
    title: input.title,
    task_type: input.taskType,
    due_at: input.dueAt,
    priority: input.priority,
    done: false,
  }).select("id").single();
  if (error) throw error;
  await auditOpportunityWrite(input.opportunityId, "opportunity_task_added", { task_id: data.id, task_type: input.taskType });
  return data.id;
}

export async function setTaskDone(opportunityId: string, taskId: string, done: boolean) {
  const { error } = await supabase.from("exp_sales_tasks").update({ done }).eq("id", taskId);
  if (error) throw error;
  await auditOpportunityWrite(opportunityId, done ? "opportunity_task_completed" : "opportunity_task_reopened", { task_id: taskId });
}

export async function convertNoteToTask(input: { opportunityId: string; accountId: string | null; ownerId: string | null; noteId: string; title: string; dueAt: string | null }) {
  const taskId = await addOppTask({ opportunityId: input.opportunityId, accountId: input.accountId, ownerId: input.ownerId, title: input.title, taskType: "note_follow_up", dueAt: input.dueAt, priority: "normal" });
  await auditOpportunityWrite(input.opportunityId, "opportunity_note_converted_to_task", { note_id: input.noteId, task_id: taskId });
  return taskId;
}

export async function updateOpportunityContact(input: { opportunityId: string; linkId: string; isChampion: boolean; relationshipStrength: number | null; lastTouchAt: string | null; championDetail: Json | null }) {
  const { error } = await supabase.from("exp_opportunity_contacts").update({ is_champion: input.isChampion, relationship_strength: input.relationshipStrength, last_touch_at: input.lastTouchAt, champion_detail: input.championDetail }).eq("id", input.linkId).eq("opportunity_id", input.opportunityId);
  if (error) throw error;
  await auditOpportunityWrite(input.opportunityId, "opportunity_contact_updated", { link_id: input.linkId, is_champion: input.isChampion });
}

export async function logOpportunityActivity(input: { opportunityId: string; accountId: string | null; eventType: string; actor: string | null; value?: Json }) {
  await recordOpportunityActivity(input.opportunityId, input.accountId, input.eventType, input.value ?? {}, input.actor);
}

export async function bookOpportunityDemo(input: { opportunityId: string; sellerId: string | null; bookedAt: string; objective: string; agenda: string; attendees: string[] }) {
  const { data, error } = await supabase.from("exp_sales_demos").insert({ opportunity_id: input.opportunityId, seller_id: input.sellerId, booked_at: input.bookedAt, objective: input.objective, agenda: input.agenda || null, attendees: input.attendees, is_demo: false }).select("id").single();
  if (error) throw error;
  await auditOpportunityWrite(input.opportunityId, "opportunity_demo_booked", { demo_id: data.id, booked_at: input.bookedAt });
  return data.id;
}

export async function completeOpportunityDemo(input: { opportunityId: string; demoId: string; outcome: string; followUp: string | null; disposition: string; recordingUrl: string | null }) {
  const { error } = await supabase.from("exp_sales_demos").update({ attended: true, outcome: input.outcome, follow_up: input.followUp, disposition: input.disposition, recording_url: input.recordingUrl }).eq("id", input.demoId).eq("opportunity_id", input.opportunityId);
  if (error) throw error;
  await auditOpportunityWrite(input.opportunityId, "opportunity_demo_completed", { demo_id: input.demoId, disposition: input.disposition });
}

async function recordOpportunityActivity(opportunityId: string, accountId: string | null, eventType: string, value: Json, actor: string | null = null) {
  const { error } = await supabase.from("exp_activity_events").insert({ event_type: eventType, subject_type: "opportunity", subject_id: opportunityId, account_id: accountId, actor, source: "manual", occurred_at: new Date().toISOString(), value });
  if (error) throw error;
  await auditOpportunityWrite(opportunityId, eventType, value);
}

async function auditOpportunityWrite(opportunityId: string, action: string, fieldChanges: Json) {
  const { error } = await supabase.from("audit_log").insert({ action, entity_type: "opportunity", entity_id: opportunityId, field_changes: fieldChanges });
  if (error) throw error;
}

/** Records the file row only — storage upload is not wired yet. */
export async function recordOppFile(input: {
  opportunityId: string;
  filename: string;
  kind: string;
  sizeBytes: number | null;
  uploadedBy: string | null;
}) {
  const { error } = await supabase.from("exp_opportunity_files").insert({
    opportunity_id: input.opportunityId,
    filename: input.filename,
    kind: input.kind,
    size_bytes: input.sizeBytes,
    uploaded_by: input.uploadedBy,
  });
  if (error) throw error;
}

/** Captures the current stage's gate answers, then moves the opportunity forward. */
export async function advanceStage(input: {
  opportunityId: string;
  toStage: string;
  captured: Record<string, unknown>;
}) {
  const db = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any };
  const { data, error } = await db.rpc("exp_opp_advance_stage", { p_opp: input.opportunityId, p_target: input.toStage, p_captured: input.captured });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function closeOpportunityLost(input: { opportunityId: string; reason: string; competitor: string | null; revisit: string | null }) {
  const db = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any };
  const { data, error } = await db.rpc("exp_opp_close_lost", { p_opp: input.opportunityId, p_reason: input.reason, p_competitor: input.competitor, p_revisit: input.revisit });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function closeOpportunityWon(input: { opportunityId: string; captured: Record<string, unknown> }) {
  const db = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => any };
  const { data, error } = await db.rpc("exp_opp_close_won", { p_opp: input.opportunityId, p_captured: input.captured });
  if (error) throw new Error(error.message);
  return data as string;
}
