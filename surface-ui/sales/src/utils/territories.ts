import { api } from "@v3/state/api/server-fn";
// Territories module: CRUD, dual-lane owners, quotas, ramps, proposals — see bottom of file.
// Sales lib (moved from _base, surface audit §11 row 5, 2026-10-25). Admin has its own territory chip
// calling the label endpoint (surface-ui/admin/src/components/territory-chip.tsx).
// FastAPI: surface-api/sales/routers/territories_data.py (runs as the signed-in user).

/* ────────────────────────────────────────────────────────────
   Territory management data layer.
   Real-only: every row here is read from the territory tables.
   ──────────────────────────────────────────────────────────── */

const T = "/sales/territories";
const enc = encodeURIComponent;

export const TERRITORY_TIERS = ["ENT", "MM", "SMB", "SRE", "CATCHALL"] as const;
export type TerritoryTier = (typeof TERRITORY_TIERS)[number];

export const TIER_LABEL: Record<string, string> = {
  ENT: "Enterprise",
  MM: "Mid-Market",
  SMB: "Small Business",
  SRE: "Search Rank Expert",
  CATCHALL: "Catch-all",
};

export const CATCHALL_GCID = "*";

export type TerritorySlot = {
  id: string;
  label: string;
  gcid: string;
  tier: string;
  seq: number | null;
  seller_id: string | null;
  status: string;
  is_catchall: boolean | null;
  brand_count: number | null;
  office_count: number | null;
  agent_count: number | null;
};

export type TerritoryRule = {
  tier: string;
  min_users: number | null;
  max_users: number | null;
  logos_per_territory: number | null;
  agents_per_territory: number | null;
  owns_individuals: boolean | null;
  notes: string | null;
};

export type TerritoryRep = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  group_key: string;
  on_duty: boolean | null;
  backup_rep_id: string | null;
  is_demo: boolean | null;
};

export type QuotaRow = {
  id: string;
  rep_id: string | null;
  period_type: string | null;
  period_start: string | null;
  target: number | null;
  actual: number | null;
  is_demo: boolean | null;
};

export type RoutingState = {
  id: string;
  gcid: string;
  tier: string;
  last_seller_id: string | null;
  last_assigned_at: string | null;
};

export type CategoryOption = { gcid: string; label: string; slots: number };

/* ─────────── Reads ─────────── */

export async function loadTerritoryCategories(): Promise<CategoryOption[]> {
  // The slots' gcids, then (names read only when there is a non-catch-all gcid) their names.
  const { territories: data, cats } = await api.get<{
    territories: { gcid: string }[];
    cats: { gcid: string; display_name: string | null }[];
  }>(`${T}/categories`);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { gcid: string }[]) {
    counts.set(r.gcid, (counts.get(r.gcid) ?? 0) + 1);
  }
  const gcids = [...counts.keys()].filter((g) => g !== CATCHALL_GCID);
  let names: Record<string, string> = {};
  if (gcids.length) {
    names = Object.fromEntries(
      ((cats ?? []) as { gcid: string; display_name: string | null }[]).map((c) => [
        c.gcid,
        c.display_name ?? c.gcid,
      ]),
    );
  }
  const out: CategoryOption[] = gcids.map((g) => ({
    gcid: g,
    label: names[g] ?? g,
    slots: counts.get(g) ?? 0,
  }));
  out.sort((a, b) => a.label.localeCompare(b.label));
  if (counts.has(CATCHALL_GCID)) {
    out.push({
      gcid: CATCHALL_GCID,
      label: "Catch-all (any category)",
      slots: counts.get(CATCHALL_GCID) ?? 0,
    });
  }
  return out;
}

export async function loadTerritories(gcid?: string): Promise<TerritorySlot[]> {
  const data = await api.get<TerritorySlot[]>(`${T}/slots`, { params: { gcid: gcid || null } });
  return (data ?? []) as TerritorySlot[];
}

export async function loadTerritoryRules(): Promise<TerritoryRule[]> {
  const data = await api.get<TerritoryRule[]>(`${T}/rules`);
  const order = ["ENT", "MM", "SMB", "SRE", "CATCHALL"];
  return ((data ?? []) as TerritoryRule[]).sort(
    (a, b) => order.indexOf(a.tier) - order.indexOf(b.tier),
  );
}

export async function loadTerritoryReps(): Promise<TerritoryRep[]> {
  const data = await api.get<TerritoryRep[]>(`${T}/reps`);
  return (data ?? []) as TerritoryRep[];
}

export function currentPeriodStart(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function loadCurrentQuotas(): Promise<QuotaRow[]> {
  const data = await api.get<QuotaRow[]>(`${T}/quotas`, { params: { period_start: currentPeriodStart() } });
  return (data ?? []) as QuotaRow[];
}

export async function loadRoutingState(): Promise<RoutingState[]> {
  const data = await api.get<RoutingState[]>(`${T}/routing-state`);
  return (data ?? []) as RoutingState[];
}

export async function loadTerritoryBrands(territoryIds: string[]) {
  if (!territoryIds.length) return [] as { territory_id: string; org_id: string; lane: string }[];
  const data = await api.post<{ territory_id: string; org_id: string; lane: string }[]>(`${T}/brands/search`, {
    territory_ids: territoryIds,
  });
  return (data ?? []) as { territory_id: string; org_id: string; lane: string }[];
}

/** Territory label for a single entity chip. */
export async function loadTerritoryLabel(territoryId: string | null | undefined) {
  if (!territoryId) return null;
  // A failed read (or 2+ rows) is null, as before.
  const data = await api.get<unknown>(`${T}/slots/${enc(territoryId)}/label`).catch(() => null);
  return (data ?? null) as { id: string; label: string; tier: string; seller_id: string | null } | null;
}

/* ─────────── Writes ─────────── */

export async function generateTerritories(gcid: string) {
  const data = await api.post<unknown>(`${T}/rpc/exp_generate_territories`, { args: { p_gcid: gcid } });
  return data as unknown;
}

/** Onboard / reassign: map a rep into a territory slot. */
export async function assignTerritory(input: {
  territoryId: string;
  repId: string;
  quotaTarget?: number | null;
}) {
  await api.patch(`${T}/slots/${enc(input.territoryId)}`, { seller_id: input.repId, status: "assigned" });

  if (input.quotaTarget != null && Number.isFinite(input.quotaTarget)) {
    // This month's quota row for the rep (server clock): update its target, else insert it (one request).
    await api.put(`${T}/quotas`, { rep_id: input.repId, target: input.quotaTarget });
  }
}

/** Offboarding: leave the slot open. */
export async function unassignTerritory(territoryId: string) {
  await api.patch(`${T}/slots/${enc(territoryId)}`, { seller_id: null, status: "unassigned" });
}

export async function setRepDuty(repId: string, onDuty: boolean) {
  await api.patch(`${T}/reps/${enc(repId)}`, { on_duty: onDuty });
}

export async function setRepBackup(repId: string, backupRepId: string | null) {
  await api.patch(`${T}/reps/${enc(repId)}`, { backup_rep_id: backupRepId });
}

/* ─────────── Routing explanation (derived, not fabricated) ─────────── */

export type RouteExplain = {
  lane: string;
  trigger: string;
  destination: string;
  fallback: string;
};

export function routingExplainer(rules: TerritoryRule[]): RouteExplain[] {
  const owns = (tier: string) => rules.find((r) => r.tier === tier)?.owns_individuals === true;
  return [
    {
      lane: "SRE",
      trigger: "Individual professional claim / self-serve signup",
      destination: owns("SRE")
        ? "The category's SRE territory seller, when on duty"
        : "SRE lane (rules say SRE does not own individuals in this config)",
      fallback:
        "Off duty → their backup rep, else the round-robin pool for gcid × SRE. Individuals belonging to an ENT/MM brand are flagged PRIORITY.",
    },
    {
      lane: "ENT",
      trigger: `Brand lead with ${rules.find((r) => r.tier === "ENT")?.min_users ?? "—"}+ users`,
      destination: "The assigned Enterprise territory seller",
      fallback: "Unassigned or off duty → round-robin across ENT sellers; a single seller receives all.",
    },
    {
      lane: "MM",
      trigger: "Brand lead in the Mid-Market user band",
      destination: "The assigned Mid-Market territory seller",
      fallback: "Unassigned or off duty → round-robin across MM sellers; a single seller receives all.",
    },
    {
      lane: "SMB",
      trigger: "Brand lead in the SMB user band",
      destination: owns("SMB")
        ? "The assigned SMB seller — who also owns that brand's individuals"
        : "The assigned SMB territory seller",
      fallback: "Unassigned or off duty → round-robin across SMB sellers.",
    },
    {
      lane: "CATCHALL",
      trigger: "Any lead from a category with no team yet",
      destination: "The vertical-agnostic Catch-all territory for that tier",
      fallback: "Round-robin inside the catch-all pool until the category gets its own territories.",
    },
  ];
}

/* ════════════════════════════════════════════════════════════
   Territories module (Growth Hub): flat list, CRUD, dual-lane
   ownership, quotas, ramps and propose-then-approve.
   A logo has TWO owners — one per lane:
     seller lane  → exp_sales_assignments.assignment_type='account'
                    (+ exp_territories.seller_id for non-SRE tiers)
     SRE lane     → exp_sales_assignments.assignment_type='claims_queue'
   target_ref = territory id. One owner per lane, never two.
   ════════════════════════════════════════════════════════════ */

export type Lane = "seller" | "sre";
export const LANE_ASSIGNMENT: Record<Lane, string> = { seller: "account", sre: "claims_queue" };
export const GEO_SCOPES = ["national", "region"] as const;

export type TerritoryRamp = {
  id: string;
  territory_id: string;
  rep_id: string | null;
  month_offset: number;
  ramp_pct: number;
  created_at: string | null;
  is_demo: boolean | null;
};

export type TerritoryListRow = TerritorySlot & {
  group_key: string | null;
  geo_scope: string | null;
  region: string | null;
  groupLabel: string;
  seller: TerritoryRep | null;
  sre: TerritoryRep | null;
  quotaTarget: number | null;
  quotaActual: number | null;
  ramps: TerritoryRamp[];
  rampStatus: string;
  brands: { org_id: string; lane: string }[];
};

export function rampStatus(ramps: TerritoryRamp[], now = new Date()): string {
  if (!ramps.length) return "No ramp";
  const sorted = [...ramps].sort((a, b) => a.month_offset - b.month_offset);
  const start = new Date(
    Math.min(...sorted.map((r) => (r.created_at ? Date.parse(r.created_at) : now.getTime()))),
  );
  const months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
  const step = [...sorted].reverse().find((r) => r.month_offset <= months) ?? sorted[0];
  return step.ramp_pct >= 100 ? "Fully ramped" : `Ramping · ${Math.round(step.ramp_pct)}%`;
}

export async function loadAllTerritories(): Promise<TerritoryListRow[]> {
  // One request: territories, groups, reps, lane assignments, this period's quotas, ramps and the
  // territories' open brand links (groups / assignments / quotas / ramps errors ignored, as before).
  const all = await api.get<{
    territories: any[];
    groups: any[];
    reps: TerritoryRep[];
    assignments: any[];
    quotas: any[];
    ramps: TerritoryRamp[];
    brands: { territory_id: string; org_id: string; lane: string }[];
  }>(`${T}/list`, { params: { period_start: currentPeriodStart() } });
  const groups = { data: all.groups };
  const reps = all.reps ?? [];
  const asg = { data: all.assignments };
  const quotas = { data: all.quotas };
  const ramps = { data: all.ramps };
  const rows = (all.territories ?? []) as any[];
  const groupLabel = new Map(
    ((groups.data ?? []) as any[]).map((g) => [g.group_key as string, g.label as string]),
  );
  const repById = new Map(reps.map((r) => [r.id, r]));
  const owner = new Map<string, string>(); // `${type}:${territoryId}` -> rep
  for (const a of (asg.data ?? []) as any[]) {
    if (a.target_ref && a.rep_id) owner.set(`${a.assignment_type}:${a.target_ref}`, a.rep_id);
  }
  const quotaBy = new Map<string, { target: number; actual: number }>();
  for (const q of (quotas.data ?? []) as any[]) {
    const k = `${q.rep_id}:${q.group_key ?? ""}`;
    const cur = quotaBy.get(k) ?? { target: 0, actual: 0 };
    cur.target += Number(q.target ?? 0);
    cur.actual += Number(q.actual ?? 0);
    quotaBy.set(k, cur);
  }
  const rampBy = new Map<string, TerritoryRamp[]>();
  for (const r of (ramps.data ?? []) as TerritoryRamp[]) {
    const l = rampBy.get(r.territory_id) ?? [];
    l.push({ ...r, month_offset: Number(r.month_offset), ramp_pct: Number(r.ramp_pct) });
    rampBy.set(r.territory_id, l);
  }
  const brands = all.brands ?? [];
  return rows.map((t) => {
    const sellerId =
      owner.get(`account:${t.id}`) ?? (t.tier !== "SRE" ? (t.seller_id as string | null) : null);
    const sreId = owner.get(`claims_queue:${t.id}`) ?? (t.tier === "SRE" ? t.seller_id : null);
    const quotaRep = t.tier === "SRE" ? sreId : sellerId;
    const q = quotaRep ? quotaBy.get(`${quotaRep}:${t.group_key ?? ""}`) : undefined;
    const tr = rampBy.get(t.id) ?? [];
    return {
      ...t,
      groupLabel: groupLabel.get(t.group_key) ?? t.group_key ?? "—",
      seller: sellerId ? (repById.get(sellerId) ?? null) : null,
      sre: sreId ? (repById.get(sreId) ?? null) : null,
      quotaTarget: q ? q.target : null,
      quotaActual: q ? q.actual : null,
      ramps: tr.sort((a, b) => a.month_offset - b.month_offset),
      rampStatus: rampStatus(tr),
      brands: brands.filter((b) => b.territory_id === t.id),
    } as TerritoryListRow;
  });
}

export async function loadTerritoryRow(id: string): Promise<TerritoryListRow | null> {
  return (await loadAllTerritories()).find((t) => t.id === id) ?? null;
}

export async function searchBrands(term: string) {
  if (term.trim().length < 2) return [] as { id: string; name: string }[];
  const data = await api
    .get<{ id: string; name: string }[]>(`${T}/org-search`, { params: { term: term.trim() } })
    .catch(() => []);
  return (data ?? []) as { id: string; name: string }[];
}

export type TerritoryInput = {
  id?: string;
  group_key: string;
  tier: string;
  geo_scope: string;
  region: string | null;
  label?: string | null;
  brandOrgId?: string | null;
};

async function nextSeq(groupKey: string, tier: string) {
  const data = await api
    .get<{ seq: number | null }[]>(`${T}/next-seq`, { params: { group_key: groupKey, tier } })
    .catch(() => []);
  return Number(((data ?? []) as any[])[0]?.seq ?? 0) + 1;
}

async function groupGcid(groupKey: string): Promise<string> {
  const data = await api
    .get<{ gcid: string }[]>(`${T}/group-gcid`, { params: { group_key: groupKey } })
    .catch(() => []);
  return (((data ?? []) as any[])[0]?.gcid as string) ?? CATCHALL_GCID;
}

function autoLabel(groupKey: string, tier: string, seq: number, region: string | null) {
  const base = groupKey.replace(/^_+/, "").replace(/[^A-Za-z0-9]+/g, "_");
  const r = region ? `_${region.replace(/[^A-Za-z0-9]+/g, "_")}` : "";
  return `${base}_${tier}${r}_${seq}`;
}

/** Create or edit a territory (geo_scope + region included). */
export async function saveTerritory(input: TerritoryInput): Promise<string> {
  const region = input.geo_scope === "region" ? (input.region?.trim() || null) : null;
  if (input.geo_scope === "region" && !region) throw new Error("Region is required for a regional territory");
  let id = input.id;
  if (id) {
    const patch: Record<string, unknown> = {
      group_key: input.group_key,
      tier: input.tier,
      geo_scope: input.geo_scope,
      region,
    };
    if (input.label?.trim()) patch.label = input.label.trim();
    await api.patch(`${T}/slots/${enc(id)}`, patch);
  } else {
    const seq = await nextSeq(input.group_key, input.tier);
    const data = await api.post<{ id: string }>(`${T}/slots`, {
        group_key: input.group_key,
        gcid: await groupGcid(input.group_key),
        tier: input.tier,
        seq,
        label: input.label?.trim() || autoLabel(input.group_key, input.tier, seq, region),
        geo_scope: input.geo_scope,
        region,
        status: "unassigned",
        is_catchall: input.tier === "CATCHALL",
        brand_count: 0,
        office_count: 0,
        agent_count: 0,
    });
    id = data.id as string;
  }
  if (input.brandOrgId) {
    // Link the brand unless this territory × org link exists (one request).
    await api.post(`${T}/slots/${enc(id)}/brands`, { org_id: input.brandOrgId, lane: input.tier });
  }
  return id!;
}

/** Delete a territory and its lane assignments, ramps and brand links. */
export async function deleteTerritory(id: string) {
  // The first three deletes' errors are ignored, as before.
  const types = Object.values(LANE_ASSIGNMENT).map((t) => `types=${enc(t)}`).join("&");
  await api.delete(`${T}/slots/${enc(id)}/assignments?${types}`).catch(() => undefined);
  await api.delete(`${T}/slots/${enc(id)}/ramps`).catch(() => undefined);
  await api.delete(`${T}/slots/${enc(id)}/brands`).catch(() => undefined);
  const data = await api.delete<{ id: string }[]>(`${T}/slots/${enc(id)}`);
  if (!data?.length) throw new Error("Delete was not permitted for this territory (no rows removed)");
}

/**
 * Set (or clear) the owner of ONE lane. The other lane is never touched.
 * Enforces exactly one owner per lane by replacing that lane's assignment row.
 */
export async function setLaneOwner(input: {
  territoryId: string;
  groupKey: string;
  tier: string;
  lane: Lane;
  repId: string | null;
}) {
  const type = LANE_ASSIGNMENT[input.lane];
  await api.delete(`${T}/slots/${enc(input.territoryId)}/assignments?types=${enc(type)}`);
  if (input.repId) {
    await api.post(`${T}/slots/${enc(input.territoryId)}/assignments`, {
      rep_id: input.repId,
      group_key: input.groupKey,
      assignment_type: type,
    });
  }
  // seller_id mirrors the lane that matches the territory's own tier.
  const primaryLane: Lane = input.tier === "SRE" ? "sre" : "seller";
  if (input.lane === primaryLane) {
    await api.patch(`${T}/slots/${enc(input.territoryId)}`, {
      seller_id: input.repId,
      status: input.repId ? "assigned" : "unassigned",
    });
  }
}

export async function saveQuota(input: { repId: string; groupKey: string; target: number }) {
  // This month's quota row for the rep × group (server clock): update its target, else insert it.
  await api.put(`${T}/quotas`, { rep_id: input.repId, group_key: input.groupKey, target: input.target });
}

/** Replace a territory's ramp curve (month_offset 0..N). */
export async function saveRamp(input: { territoryId: string; repId: string | null; pcts: number[] }) {
  await api.delete(`${T}/slots/${enc(input.territoryId)}/ramps`);
  if (!input.pcts.length) return;
  await api.post(`${T}/slots/${enc(input.territoryId)}/ramps`, {
    rows: input.pcts.map((p, i) => ({
      rep_id: input.repId,
      month_offset: i,
      ramp_pct: Math.max(0, Math.min(100, p)),
    })),
  });
}

/* ─────────── Propose-then-approve ─────────── */

export type TerritoryProposal = {
  id: string;
  group_key: string | null;
  gcid: string | null;
  lane: string | null;
  proposed_label: string | null;
  proposed_tier: string | null;
  proposed_geo: string | null;
  rationale: string | null;
  payload: any;
  state: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  is_demo: boolean | null;
};

export async function loadProposals(state?: string): Promise<TerritoryProposal[]> {
  const data = await api.get<TerritoryProposal[]>(`${T}/proposals`, { params: { state: state || null } });
  return (data ?? []) as TerritoryProposal[];
}

/* Sizing constants (tunable). */
export const TARGET_PROFILES = 500_000;
export const VIABILITY_FLOOR = 250_000;

export type LogoProfiles = {
  group_key: string;
  logo_id: string | null;
  logo_name: string;
  locations: number;
  professionals: number;
  profile_count: number;
  proxy?: boolean;
};

const kfmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));

/**
 * profile_count per logo = locations under the root org (organizations
 * descendants) + professionals whose primary_org_id sits under it.
 * Read via the read-only RPC exp_territory_logo_profiles().
 * Fallback per group with no logos: exp_territories office+agent counts (proxy).
 */
export async function loadLogoProfiles(): Promise<LogoProfiles[]> {
  // exp_territory_logo_profiles() and the stored office/agent counts (that read's error ignored).
  const { profiles: data, territories: terrs } = await api.get<{ profiles: any[]; territories: any[] }>(
    `${T}/logo-profiles`,
  );
  const logos: LogoProfiles[] = ((data ?? []) as any[]).map((r) => ({
    group_key: r.group_key,
    logo_id: r.logo_id,
    logo_name: r.logo_name ?? "Unnamed logo",
    locations: Number(r.locations ?? 0),
    professionals: Number(r.professionals ?? 0),
    profile_count: Number(r.locations ?? 0) + Number(r.professionals ?? 0),
  }));
  const withLogos = new Set(logos.map((l) => l.group_key));
  const proxy = new Map<string, { o: number; a: number }>();
  for (const t of (terrs ?? []) as any[]) {
    if (!t.group_key || withLogos.has(t.group_key)) continue;
    const c = proxy.get(t.group_key) ?? { o: 0, a: 0 };
    c.o += Number(t.office_count ?? 0);
    c.a += Number(t.agent_count ?? 0);
    proxy.set(t.group_key, c);
  }
  for (const [g, c] of proxy) {
    if (c.o + c.a > 0)
      logos.push({ group_key: g, logo_id: null, logo_name: "Stored territory volume", locations: c.o, professionals: c.a, profile_count: c.o + c.a, proxy: true });
  }
  return logos;
}

/** First-fit-decreasing: whole logos into the bin with most remaining capacity. */
export function packLogos(logos: LogoProfiles[], bins: number) {
  const out = Array.from({ length: Math.max(1, bins) }, () => ({ total: 0, logos: [] as LogoProfiles[] }));
  for (const l of [...logos].sort((a, b) => b.profile_count - a.profile_count)) {
    const bin = out.reduce((best, b) => (TARGET_PROFILES - b.total > TARGET_PROFILES - best.total ? b : best), out[0]);
    bin.logos.push(l);
    bin.total += l.profile_count;
  }
  return out;
}

function tierForSize(total: number, top: number) {
  if (total >= 0.8 * TARGET_PROFILES && top >= 100_000) return "ENT";
  if (total >= VIABILITY_FLOOR) return "MM";
  return "SMB";
}

/** Family = last word of the group label (e.g. "Chinese Bakery" → "bakery"). */
function familyOf(label: string) {
  const w = label.trim().toLowerCase().split(/\s+/);
  return w[w.length - 1] ?? label;
}

/**
 * Proposer (in-lib). Writes pending exp_territory_proposals only — never applies.
 * Big groups (> TARGET) → ceil(total/TARGET) territories, whole logos bin-packed.
 * Small groups (< FLOOR) → combined with like small groups (same family) up to ~TARGET.
 * groupKey limits writes to proposals involving that group; null = all groups.
 */
export async function proposeTerritories(groupKey: string | null): Promise<number> {
  const [logos, groupsRes, pending] = await Promise.all([
    loadLogoProfiles(),
    api.get<any[]>(`${T}/groups`).then((data) => ({ data })),
    loadProposals("pending"),
  ]);
  const groups = ((groupsRes.data ?? []) as any[]).filter((g) => !g.is_catchall);
  const byGroup = new Map<string, LogoProfiles[]>();
  for (const l of logos) byGroup.set(l.group_key, [...(byGroup.get(l.group_key) ?? []), l]);
  const gcidOf = async (g: string) => groupGcid(g);
  const payloadLogos = (ls: LogoProfiles[]) =>
    ls.map((l) => ({ logo_id: l.logo_id, name: l.logo_name, group_key: l.group_key, locations: l.locations, professionals: l.professionals, profile_count: l.profile_count, proxy: !!l.proxy }));
  const proxyNote = (ls: LogoProfiles[]) =>
    ls.some((l) => l.proxy) ? " Counts for part of this set are a proxy from stored territory office/agent counts (no logos found in organizations)." : "";

  const props: any[] = [];
  const small: { g: any; total: number; ls: LogoProfiles[] }[] = [];
  for (const g of groups) {
    const ls = byGroup.get(g.group_key) ?? [];
    const total = ls.reduce((s, l) => s + l.profile_count, 0);
    if (!ls.length) continue; // no data → no proposal (never fabricate)
    if (total > TARGET_PROFILES) {
      const bins = packLogos(ls, Math.ceil(total / TARGET_PROFILES));
      bins.forEach((b, i) => {
        const [top, ...rest] = b.logos;
        props.push({
          group_key: g.group_key,
          proposed_label: `${g.label} ${i + 1}`,
          proposed_tier: tierForSize(b.total, top?.profile_count ?? 0),
          rationale: `${top?.logo_name ?? "—"} ${kfmt(top?.profile_count ?? 0)} + ${rest.length} logo${rest.length === 1 ? "" : "s"} = ${kfmt(b.total)} profiles (group total ${kfmt(total)} → ${bins.length} territories at ~${kfmt(TARGET_PROFILES)}).${proxyNote(b.logos)}`,
          payload: { action: "create", kind: "split", member_groups: [g.group_key], logos: payloadLogos(b.logos), total: b.total },
          involves: [g.group_key],
        });
      });
    } else if (total < VIABILITY_FLOOR) {
      small.push({ g, total, ls });
    } else {
      const top = [...ls].sort((a, b) => b.profile_count - a.profile_count)[0];
      props.push({
        group_key: g.group_key,
        proposed_label: `${g.label} 1`,
        proposed_tier: tierForSize(total, top.profile_count),
        rationale: `${g.label}: ${ls.length} logos = ${kfmt(total)} profiles — viable standalone (between ${kfmt(VIABILITY_FLOOR)} and ${kfmt(TARGET_PROFILES)}).${proxyNote(ls)}`,
        payload: { action: "create", kind: "standalone", member_groups: [g.group_key], logos: payloadLogos(ls), total },
        involves: [g.group_key],
      });
    }
  }

  // Combine small like groups (same family), largest first, until ~TARGET.
  const families = new Map<string, typeof small>();
  for (const s of small) families.set(familyOf(s.g.label), [...(families.get(familyOf(s.g.label)) ?? []), s]);
  for (const members of families.values()) {
    members.sort((a, b) => b.total - a.total);
    let cur: typeof small = [];
    let sum = 0;
    const flush = () => {
      if (!cur.length) return;
      const lead = cur[0];
      const ls = cur.flatMap((c) => c.ls);
      const top = [...ls].sort((a, b) => b.profile_count - a.profile_count)[0];
      const note =
        cur.length === 1
          ? ` Below the ${kfmt(VIABILITY_FLOOR)} viability floor and no like group (same family) to combine with yet — one seller can hold it alongside other territories.`
          : "";
      props.push({
        group_key: lead.g.group_key,
        proposed_label: cur.length > 1 ? `${lead.g.label} + ${cur.length - 1} related` : `${lead.g.label} 1`,
        proposed_tier: tierForSize(sum, top?.profile_count ?? 0),
        rationale:
          (cur.length > 1
            ? `${lead.g.label} + ${cur.length - 1} ${familyOf(lead.g.label)} types combined = ${kfmt(sum)} profiles (${cur.map((c) => `${c.g.label} ${kfmt(c.total)}`).join(", ")}).`
            : `${lead.g.label}: ${ls.length} logos = ${kfmt(sum)} profiles.`) + note + proxyNote(ls),
        payload: { action: "create", kind: "combined", member_groups: cur.map((c) => c.g.group_key), logos: payloadLogos(ls), total: sum },
        involves: cur.map((c) => c.g.group_key),
      });
      cur = [];
      sum = 0;
    };
    for (const m of members) {
      if (cur.length && sum + m.total > TARGET_PROFILES * 1.1) flush();
      cur.push(m);
      sum += m.total;
      if (sum >= TARGET_PROFILES) flush();
    }
    flush();
  }

  const scoped = groupKey ? props.filter((p) => p.involves.includes(groupKey)) : props;
  const fresh = scoped.filter(
    (p) => !pending.some((x) => x.group_key === p.group_key && x.proposed_label === p.proposed_label),
  );
  if (!fresh.length) return 0;
  // created_by: the signed-in user, from the token (server-side).
  const rows = await Promise.all(
    fresh.map(async ({ involves: _i, ...p }) => ({
      ...p,
      gcid: await gcidOf(p.group_key),
      lane: p.proposed_tier === "SRE" ? "sre" : "seller",
      proposed_geo: "national",
      payload: { ...p.payload, tier: p.proposed_tier, geo_scope: "national", region: null },
      state: "pending",
    })),
  );
  await api.post(`${T}/proposals`, { rows });
  return rows.length;
}

/** Approve: create the territory (+ lane assignment if the payload names a rep). */
export async function approveProposal(p: TerritoryProposal) {
  const pl = p.payload ?? {};
  const tier = p.proposed_tier ?? pl.tier;
  const id = await saveTerritory({
    id: pl.action === "update" ? pl.territory_id : undefined,
    group_key: p.group_key ?? CATCHALL_GCID,
    tier,
    geo_scope: pl.geo_scope ?? p.proposed_geo ?? "national",
    region: pl.region ?? null,
    label: p.proposed_label,
  });
  if (pl.rep_id) {
    await setLaneOwner({
      territoryId: id,
      groupKey: p.group_key ?? "",
      tier,
      lane: (p.lane as Lane) ?? (tier === "SRE" ? "sre" : "seller"),
      repId: pl.rep_id,
    });
  }
  // reviewed_at: the server's clock.
  await api.post(`${T}/proposals/${enc(p.id)}/review`, { state: "approved", payload: { ...pl, applied_territory_id: id } });
  return id;
}

export async function rejectProposal(id: string) {
  await api.post(`${T}/proposals/${enc(id)}/review`, { state: "rejected" });
}
