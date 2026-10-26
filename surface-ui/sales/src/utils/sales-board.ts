import { api } from "@v3/state/api/server-fn";

/* ══════════════════ Roles ══════════════════ */

export type RoleShort = "ENT" | "MM" | "SMB" | "SRE";

export function roleShort(role: string | null | undefined): RoleShort {
  const r = (role ?? "").toLowerCase();
  if (r === "enterprise" || r === "ent") return "ENT";
  if (r === "mid_market" || r === "mm") return "MM";
  if (r === "smb") return "SMB";
  return "SRE";
}

/** SRE works individual profiles; ENT/MM/SMB work a book of logos. */
export function lensFor(role: string | null | undefined): "individual" | "brand" {
  return roleShort(role) === "SRE" ? "individual" : "brand";
}

/* ══════════════════ Row types ══════════════════ */

export type ClaimEvent = {
  id: string;
  entity_label: string | null;
  entity_type: string | null;
  group_key: string | null;
  seller_id: string | null;
  territory_id: string | null;
  logo_org_id: string | null;
  event_type: string | null;
  nora_engagement: number | null;
  upgraded: boolean | null;
  contact_phone: string | null;
  contact_email: string | null;
  state: string | null;
  is_demo: boolean | null;
  occurred_at: string | null;
};

export type RevenueRow = {
  id: string;
  seller_id: string | null;
  territory_id: string | null;
  group_key: string | null;
  source: string | null;
  amount: number;
  period_start: string | null;
  is_demo: boolean | null;
};

export type DemoRow = {
  id: string;
  seller_id: string | null;
  prospect_label: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  booked_at: string | null;
  attended: boolean | null;
  outcome: string | null;
  deal_value: number;
  is_demo: boolean | null;
};

export type NoteRow = {
  id: string;
  seller_id: string | null;
  subject_label: string | null;
  subject_type: string | null;
  body: string | null;
  callback_priority: boolean | null;
  callback_at: string | null;
  created_by: string | null;
  created_at: string | null;
  is_demo: boolean | null;
};

export type QuotaRow = {
  rep_id: string | null;
  group_key: string | null;
  period_start: string | null;
  target: number;
  actual: number;
};

export type RepRow = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  group_key: string | null;
  on_duty: boolean | null;
  is_demo: boolean | null;
  photo_url: string | null;
};


export type MetricRow = {
  rep_id: string | null;
  period_start: string | null;
  group_key: string | null;
  views: number;
  attempted_claims: number;
  claims: number;
  engaged_30d: number;
  demos_booked: number;
  demos_attended: number;
  upgrades: number;
  revenue: number;
  logos_assigned: number;
  profiles_assigned: number;
  is_demo: boolean | null;
};

export type TerritoryRow = {
  id: string;
  label: string;
  tier: string | null;
  group_key: string | null;
  seller_id: string | null;
  brand_count: number;
  office_count: number;
  agent_count: number;
};

export type GroupRow = { group_key: string; label: string; is_catchall: boolean | null };

export type AdoptionRow = {
  id: string;
  org_id: string | null;
  group_key: string | null;
  active_users: number;
  engaged_users: number;
  referral_marketing: string | null;
  referral_regional: string | null;
  referral_location: string | null;
  is_demo: boolean | null;
};

export type BoardData = {
  reps: RepRow[];
  events: ClaimEvent[];
  revenue: RevenueRow[];
  demos: DemoRow[];
  notes: NoteRow[];
  quotas: QuotaRow[];
  metrics: MetricRow[];
  territories: TerritoryRow[];
  groups: GroupRow[];
  adoption: AdoptionRow[];
  orgNames: Record<string, string>;
  orgLogos: Record<string, string | null>;
  orgDemo: Record<string, boolean>;
  allDemo: boolean;
};


/* ══════════════════ Loader ══════════════════ */

const n = (v: unknown) => Number(v ?? 0);

/** FastAPI: surface-api/sales/routers/boards_data.py (runs as the signed-in user). */
const B = "/sales/boards";

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One request: the ten reads, then the organizations of the adoption rows and claim logos. */
export async function loadBoardData(): Promise<BoardData> {
  const raw = await api.get<{
    reps: Raw[];
    events: Raw[];
    revenue: Raw[];
    demos: Raw[];
    notes: Raw[];
    quotas: Raw[];
    metrics: Raw[];
    territories: Raw[];
    groups: Raw[];
    adoption: Raw[];
    orgs: { id: string; name: string; logo_url: string | null; is_demo: boolean | null }[];
  }>(`${B}/board`);

  let orgNames: Record<string, string> = {};
  let orgLogos: Record<string, string | null> = {};
  let orgDemo: Record<string, boolean> = {};
  const data = raw.orgs ?? [];
  if (data.length) {
    orgNames = Object.fromEntries(data.map((o) => [o.id, o.name as string]));
    orgLogos = Object.fromEntries(data.map((o) => [o.id, (o.logo_url as string) ?? null]));
    orgDemo = Object.fromEntries(data.map((o) => [o.id, !!o.is_demo]));
  }

  const events = (raw.events ?? []) as ClaimEvent[];
  const revenue = (raw.revenue ?? []).map((r) => ({ ...r, amount: n(r.amount) })) as RevenueRow[];
  const demos = (raw.demos ?? []).map((d) => ({ ...d, deal_value: n(d.deal_value) })) as DemoRow[];

  return {
    reps: (raw.reps ?? []) as RepRow[],
    events,
    revenue,
    demos,
    notes: (raw.notes ?? []) as NoteRow[],
    quotas: (raw.quotas ?? []).map((q) => ({
      rep_id: q.rep_id,
      group_key: q.group_key,
      period_start: q.period_start,
      target: n(q.target),
      actual: n(q.actual),
    })),
    metrics: (raw.metrics ?? []).map((m) => ({
      ...m,
      views: n(m.views),
      attempted_claims: n(m.attempted_claims),
      claims: n(m.claims),
      engaged_30d: n(m.engaged_30d),
      demos_booked: n(m.demos_booked),
      demos_attended: n(m.demos_attended),
      upgrades: n(m.upgrades),
      revenue: n(m.revenue),
      logos_assigned: n(m.logos_assigned),
      profiles_assigned: n(m.profiles_assigned),
    })) as MetricRow[],
    territories: (raw.territories ?? []).map((t) => ({
      ...t,
      brand_count: n(t.brand_count),
      office_count: n(t.office_count),
      agent_count: n(t.agent_count),
    })) as TerritoryRow[],
    groups: (raw.groups ?? []) as GroupRow[],
    adoption: (raw.adoption ?? []).map((a) => ({
      ...a,
      active_users: n(a.active_users),
      engaged_users: n(a.engaged_users),
    })) as AdoptionRow[],
    orgNames,
    orgLogos,
    orgDemo,

    allDemo:
      events.length > 0 &&
      events.every((e) => e.is_demo !== false) &&
      revenue.every((r) => r.is_demo !== false),
  };
}

/* ══════════════════ Filters ══════════════════ */

export type BoardFilter = {
  /** days window; null = all time */
  days: number | null;
  groupKey: string; // "all" | group_key
  territoryId: string; // "all" | uuid
  tier: string; // "all" | ENT|MM|SMB|SRE
};

export const DEFAULT_FILTER: BoardFilter = {
  days: 30,
  groupKey: "all",
  territoryId: "all",
  tier: "all",
};

export function sellerIdsFor(data: BoardData, f: BoardFilter): Set<string> | null {
  if (f.tier === "all" && f.territoryId === "all" && f.groupKey === "all") return null;
  const territorySellers =
    f.territoryId === "all"
      ? null
      : new Set(
          data.territories
            .filter((t) => t.id === f.territoryId)
            .map((t) => t.seller_id)
            .filter(Boolean) as string[],
        );
  const ids = data.reps
    .filter((r) => (f.tier === "all" ? true : roleShort(r.role) === f.tier))
    .filter((r) => (f.groupKey === "all" ? true : r.group_key === f.groupKey))
    .filter((r) => (territorySellers ? territorySellers.has(r.id) : true))
    .map((r) => r.id);
  return new Set(ids);
}

const since = (days: number | null) =>
  days == null ? null : new Date(Date.now() - days * 86_400_000);

export function filterEvents(data: BoardData, f: BoardFilter): ClaimEvent[] {
  const cutoff = since(f.days);
  const sellers = sellerIdsFor(data, f);
  return data.events.filter((e) => {
    if (cutoff && (!e.occurred_at || new Date(e.occurred_at) < cutoff)) return false;
    if (sellers && !(e.seller_id && sellers.has(e.seller_id))) return false;
    if (f.groupKey !== "all" && e.group_key !== f.groupKey) return false;
    return true;
  });
}

/* ══════════════════ Chains (one prospect journey) ══════════════════ */

export type Chain = {
  key: string;
  label: string;
  sellerId: string | null;
  groupKey: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  engagement: number;
  attemptedAt: string | null;
  claimedAt: string | null;
  engagedAt: string | null;
  upgradedAt: string | null;
  lapsedAt: string | null;
  lastTouch: string | null;
};

const earlier = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : new Date(a) < new Date(b) ? a : b;
const later = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : new Date(a) > new Date(b) ? a : b;

export function buildChains(events: ClaimEvent[]): Chain[] {
  const map = new Map<string, Chain>();
  for (const e of events) {
    const key = `${e.seller_id ?? "-"}|${e.entity_label ?? e.id}`;
    let c = map.get(key);
    if (!c) {
      c = {
        key,
        label: e.entity_label ?? "Unlabeled prospect",
        sellerId: e.seller_id,
        groupKey: e.group_key,
        state: e.state,
        phone: e.contact_phone,
        email: e.contact_email,
        engagement: 0,
        attemptedAt: null,
        claimedAt: null,
        engagedAt: null,
        upgradedAt: null,
        lapsedAt: null,
        lastTouch: null,
      };
      map.set(key, c);
    }
    c.state ??= e.state;
    c.phone ??= e.contact_phone;
    c.email ??= e.contact_email;
    c.engagement = Math.max(c.engagement, n(e.nora_engagement));
    c.lastTouch = later(c.lastTouch, e.occurred_at);
    switch (e.event_type) {
      case "attempted":
        c.attemptedAt = earlier(c.attemptedAt, e.occurred_at);
        break;
      case "claimed":
        c.claimedAt = earlier(c.claimedAt, e.occurred_at);
        break;
      case "engaged":
        c.engagedAt = earlier(c.engagedAt, e.occurred_at);
        break;
      case "upgraded":
        c.upgradedAt = earlier(c.upgradedAt, e.occurred_at);
        break;
      case "lapsed_no_upgrade":
        c.lapsedAt = earlier(c.lapsedAt, e.occurred_at);
        break;
    }
    if (e.upgraded && !c.upgradedAt) c.upgradedAt = e.occurred_at;
  }
  return [...map.values()];
}

const DAY = 86_400_000;
const daysBetween = (a: string | null, b: string | null) =>
  a && b ? (new Date(b).getTime() - new Date(a).getTime()) / DAY : null;
export const daysAgo = (a: string | null) =>
  a ? Math.max(0, Math.round((Date.now() - new Date(a).getTime()) / DAY)) : null;

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/* ══════════════════ Funnel ══════════════════ */

export const FUNNEL_LABELS = [
  "Traffic",
  "Attempted claim",
  "Successful claim",
  "Engagement",
  "Demo",
  "Upgrade",
] as const;

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  /** conversion from previous stage, % */
  conversion: number | null;
  /** avg days from previous stage */
  avgDays: number | null;
  instrumented: boolean;
};

export function buildFunnel(
  chains: Chain[],
  demos: DemoRow[],
  traffic: number | null,
): FunnelStage[] {
  const attempted = chains.filter((c) => c.attemptedAt).length;
  const claimed = chains.filter((c) => c.claimedAt).length;
  const engaged = chains.filter((c) => c.engagedAt).length;
  const demoCount = demos.length;
  const upgraded = chains.filter((c) => c.upgradedAt).length;

  const dClaim = avg(
    chains.map((c) => daysBetween(c.attemptedAt, c.claimedAt)).filter((x): x is number => x != null),
  );
  const dEngage = avg(
    chains.map((c) => daysBetween(c.claimedAt, c.engagedAt)).filter((x): x is number => x != null),
  );
  const dUpgrade = avg(
    chains.map((c) => daysBetween(c.engagedAt, c.upgradedAt)).filter((x): x is number => x != null),
  );

  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

  return [
    {
      key: "traffic",
      label: "Traffic",
      count: traffic ?? 0,
      conversion: null,
      avgDays: null,
      instrumented: traffic != null && traffic > 0,
    },
    {
      key: "attempted",
      label: "Attempted claim",
      count: attempted,
      conversion: traffic ? pct(attempted, traffic) : null,
      avgDays: null,
      instrumented: true,
    },
    {
      key: "claimed",
      label: "Successful claim",
      count: claimed,
      conversion: pct(claimed, attempted),
      avgDays: dClaim,
      instrumented: true,
    },
    {
      key: "engaged",
      label: "Engagement",
      count: engaged,
      conversion: pct(engaged, claimed),
      avgDays: dEngage,
      instrumented: true,
    },
    {
      key: "demo",
      label: "Demo",
      count: demoCount,
      conversion: pct(demoCount, engaged),
      avgDays: null,
      instrumented: demoCount > 0,
    },
    {
      key: "upgraded",
      label: "Upgrade",
      count: upgraded,
      conversion: pct(upgraded, engaged),
      avgDays: dUpgrade,
      instrumented: true,
    },
  ];
}

/* ══════════════════ KPIs ══════════════════ */

export type Kpis = {
  revenue: number;
  revenuePrev: number;
  revenueDelta: number | null;
  upgrades: number;
  upgradesPrev: number;
  upgradeRate: number | null;
  avgDaysToUpgrade: number | null;
  pipelineValue: number;
  pipelineCount: number;
  openClaims: number;
  avgEngagementAge: number | null;
  avgDealValue: number;
};

export function monthStart(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
export function prevMonthStart(d = new Date()): string {
  const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return monthStart(p);
}

export function buildKpis(input: {
  chains: Chain[];
  prevChains: Chain[];
  demos: DemoRow[];
  revenue: RevenueRow[];
}): Kpis {
  const { chains, prevChains, demos, revenue } = input;
  const cur = monthStart();
  const prev = prevMonthStart();
  const revNow = revenue.filter((r) => r.period_start === cur).reduce((s, r) => s + r.amount, 0);
  const revPrev = revenue.filter((r) => r.period_start === prev).reduce((s, r) => s + r.amount, 0);

  const upgraded = chains.filter((c) => c.upgradedAt);
  const claimed = chains.filter((c) => c.claimedAt);
  const engagedOpen = chains.filter((c) => c.engagedAt && !c.upgradedAt);
  const won = demos.filter((d) => d.outcome === "won" && d.deal_value > 0);
  const avgDeal = won.length
    ? won.reduce((s, d) => s + d.deal_value, 0) / won.length
    : avg(demos.filter((d) => d.deal_value > 0).map((d) => d.deal_value)) ?? 0;

  return {
    revenue: revNow,
    revenuePrev: revPrev,
    revenueDelta: revPrev > 0 ? ((revNow - revPrev) / revPrev) * 100 : null,
    upgrades: upgraded.length,
    upgradesPrev: prevChains.filter((c) => c.upgradedAt).length,
    upgradeRate: claimed.length ? (upgraded.length / claimed.length) * 100 : null,
    avgDaysToUpgrade: avg(
      chains
        .map((c) => daysBetween(c.attemptedAt ?? c.claimedAt, c.upgradedAt))
        .filter((x): x is number => x != null),
    ),
    pipelineCount: engagedOpen.length,
    pipelineValue: Math.round(engagedOpen.length * avgDeal),
    openClaims: chains.filter((c) => c.claimedAt && !c.upgradedAt).length,
    avgEngagementAge: avg(
      engagedOpen.map((c) => daysAgo(c.engagedAt)).filter((x): x is number => x != null),
    ),
    avgDealValue: Math.round(avgDeal),
  };
}

/* ══════════════════ Aggregations ══════════════════ */

export function claimsByState(events: ClaimEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) {
    if (e.event_type !== "claimed" || !e.state) continue;
    out[e.state] = (out[e.state] ?? 0) + 1;
  }
  return out;
}

export function claimsByGroup(
  events: ClaimEvent[],
  groups: GroupRow[],
): { groupKey: string; label: string; claims: number; attempted: number; upgrades: number }[] {
  const keys = [...new Set(events.map((e) => e.group_key).filter(Boolean))] as string[];
  const labelOf = (k: string) => groups.find((g) => g.group_key === k)?.label ?? k;
  return keys
    .map((k) => {
      const mine = events.filter((e) => e.group_key === k);
      return {
        groupKey: k,
        label: labelOf(k),
        claims: mine.filter((e) => e.event_type === "claimed").length,
        attempted: mine.filter((e) => e.event_type === "attempted").length,
        upgrades: mine.filter((e) => e.event_type === "upgraded").length,
      };
    })
    .sort((a, b) => b.claims - a.claims);
}

export const REVENUE_SOURCES = [
  { key: "os", label: "OS" },
  { key: "listings", label: "Listings" },
  { key: "conversion_agents", label: "Conversion Agents" },
  { key: "contracted", label: "Contracted" },
  { key: "boosts", label: "Boosts" },
  { key: "network", label: "Network" },
] as const;

export function revenueSeries(revenue: RevenueRow[]) {
  const periods = [...new Set(revenue.map((r) => r.period_start).filter(Boolean))].sort() as string[];
  return periods.map((p) => {
    const rows = revenue.filter((r) => r.period_start === p);
    const entry: Record<string, number | string> = {
      period: p,
      label: new Date(p + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }),
      total: rows.reduce((s, r) => s + r.amount, 0),
    };
    for (const s of REVENUE_SOURCES) {
      entry[s.key] = rows.filter((r) => r.source === s.key).reduce((sum, r) => sum + r.amount, 0);
    }
    return entry;
  });
}

export function revenueBySource(revenue: RevenueRow[], period: string) {
  const rows = revenue.filter((r) => r.period_start === period);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return REVENUE_SOURCES.map((s) => {
    const amount = rows.filter((r) => r.source === s.key).reduce((sum, r) => sum + r.amount, 0);
    return { ...s, amount, share: total > 0 ? (amount / total) * 100 : 0 };
  }).filter((s) => s.amount > 0 || s.key !== "network");
}

/* ══════════════════ Seller rows ══════════════════ */

export type SellerRow = {
  repId: string;
  name: string;
  role: string;
  roleShort: RoleShort;
  photoUrl: string | null;
  isDemo: boolean | null;

  groupKey: string | null;
  onDuty: boolean | null;
  revenue: number;
  claims: number;
  attempted: number;
  engaged: number;
  demosBooked: number;
  demosAttended: number;
  upgrades: number;
  upgradeRate: number | null;
  avgDaysToUpgrade: number | null;
  avgEngagementAge: number | null;
  target: number;
  quotaPct: number | null;
  byStage: { stage: string; count: number }[];
};

export function buildSellerRows(
  data: BoardData,
  chains: Chain[],
  f: BoardFilter,
): SellerRow[] {
  const cur = monthStart();
  const allowed = sellerIdsFor(data, f);
  const reps = data.reps.filter((r) => (allowed ? allowed.has(r.id) : true));

  return reps
    .map((rep) => {
      const mine = chains.filter((c) => c.sellerId === rep.id);
      const demos = data.demos.filter((d) => d.seller_id === rep.id);
      const revenue = data.revenue
        .filter((r) => r.seller_id === rep.id && r.period_start === cur)
        .reduce((s, r) => s + r.amount, 0);
      const quota = data.quotas.find((q) => q.rep_id === rep.id && q.period_start === cur);
      const claims = mine.filter((c) => c.claimedAt).length;
      const upgrades = mine.filter((c) => c.upgradedAt).length;
      const engagedOpen = mine.filter((c) => c.engagedAt && !c.upgradedAt);
      const target = n(quota?.target);

      return {
        repId: rep.id,
        photoUrl: rep.photo_url,
        isDemo: rep.is_demo,

        name: rep.name,
        role: rep.role,
        roleShort: roleShort(rep.role),
        groupKey: rep.group_key,
        onDuty: rep.on_duty,
        revenue,
        claims,
        attempted: mine.filter((c) => c.attemptedAt).length,
        engaged: mine.filter((c) => c.engagedAt).length,
        demosBooked: demos.length,
        demosAttended: demos.filter((d) => d.attended).length,
        upgrades,
        upgradeRate: claims ? (upgrades / claims) * 100 : null,
        avgDaysToUpgrade: avg(
          mine
            .map((c) => daysBetween(c.attemptedAt ?? c.claimedAt, c.upgradedAt))
            .filter((x): x is number => x != null),
        ),
        avgEngagementAge: avg(
          engagedOpen.map((c) => daysAgo(c.engagedAt)).filter((x): x is number => x != null),
        ),
        target,
        quotaPct: target > 0 ? (revenue / target) * 100 : null,
        byStage: [
          { stage: "attempted", count: mine.filter((c) => c.attemptedAt && !c.claimedAt).length },
          { stage: "claimed", count: mine.filter((c) => c.claimedAt && !c.engagedAt).length },
          {
            stage: "engaged",
            count: mine.filter((c) => c.engagedAt && !c.upgradedAt && !c.lapsedAt).length,
          },
          { stage: "lapsed", count: mine.filter((c) => c.lapsedAt && !c.upgradedAt).length },
          { stage: "upgraded", count: mine.filter((c) => c.upgradedAt).length },
        ],
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/* ══════════════════ Individual (SRE) board ══════════════════ */

export type ContactRow = Chain & { noteCount: number; lastNoteAt: string | null };

export type SellerBoard = {
  rep: RepRow;
  roleShort: RoleShort;
  lens: "individual" | "brand";
  territories: TerritoryRow[];
  chains: Chain[];
  failedToClaim: ContactRow[];
  claimedEngaged: ContactRow[];
  lapsed: ContactRow[];
  territoryRevenue: number;
  myRevenue: number;
  myRevenueBySource: { key: string; label: string; amount: number; share: number }[];
  target: number;
  quotaPct: number | null;
  demos: DemoRow[];
  demosAttended: number;
  demoWon: number;
  demoConversion: number | null;
  notes: NoteRow[];
  callbackQueue: (NoteRow & { overdueDays: number | null; rotten: boolean })[];
  brands: BrandAdoption[];
  claimsByLogo: { label: string; claims: number; logoUrl: string | null }[];
};

export type BrandAdoption = {
  orgId: string;
  name: string;
  logoUrl: string | null;
  isDemo: boolean;
  groupKey: string | null;

  locations: number;
  professionals: number;
  activeUsers: number;
  engagedUsers: number;
  adoptionPct: number | null;
  engagementPct: number | null;
  referral: { marketing: string | null; regional: string | null; location: string | null };
  claims: number;
  revenue: number;
};

export function buildSellerBoard(data: BoardData, repId: string, f: BoardFilter): SellerBoard | null {
  const rep = data.reps.find((r) => r.id === repId);
  if (!rep) return null;

  const cutoff = since(f.days);
  const events = data.events.filter(
    (e) => e.seller_id === repId && (!cutoff || (e.occurred_at && new Date(e.occurred_at) >= cutoff)),
  );
  const chains = buildChains(events);
  const notes = data.notes.filter((nn) => nn.seller_id === repId);
  const noteStats = (label: string) => {
    const mine = notes.filter((x) => x.subject_label === label);
    return {
      noteCount: mine.length,
      lastNoteAt: mine.reduce<string | null>((acc, x) => later(acc, x.created_at), null),
    };
  };
  const decorate = (c: Chain): ContactRow => ({ ...c, ...noteStats(c.label) });

  const territories = data.territories.filter((t) => t.seller_id === repId);
  const cur = monthStart();
  const territoryIds = new Set(territories.map((t) => t.id));
  const territoryRevenue = data.revenue
    .filter(
      (r) =>
        r.period_start === cur &&
        ((r.territory_id && territoryIds.has(r.territory_id)) ||
          (!r.territory_id && r.group_key === rep.group_key)),
    )
    .reduce((s, r) => s + r.amount, 0);
  const myRevenueRows = data.revenue.filter((r) => r.seller_id === repId && r.period_start === cur);
  const myRevenue = myRevenueRows.reduce((s, r) => s + r.amount, 0);
  const quota = data.quotas.find((q) => q.rep_id === repId && q.period_start === cur);
  const target = n(quota?.target);

  const demos = data.demos.filter((d) => d.seller_id === repId);
  const demoWon = demos.filter((d) => d.outcome === "won").length;

  const adoption = data.adoption.filter((a) => {
    if (!a.org_id) return false;
    if (territories.length) {
      return territories.some((t) => t.group_key === a.group_key);
    }
    return a.group_key === rep.group_key;
  });

  const brands: BrandAdoption[] = adoption.map((a) => {
    const terr = territories.find((t) => t.group_key === a.group_key);
    const locations = terr?.office_count ?? 0;
    const professionals = terr?.agent_count ?? 0;
    const base = Math.max(locations, professionals);
    return {
      orgId: a.org_id as string,
      name: data.orgNames[a.org_id as string] ?? "Unnamed brand",
      logoUrl: data.orgLogos[a.org_id as string] ?? null,
      isDemo: data.orgDemo[a.org_id as string] ?? !!a.is_demo,

      groupKey: a.group_key,
      locations,
      professionals,
      activeUsers: a.active_users,
      engagedUsers: a.engaged_users,
      adoptionPct: base > 0 ? (a.active_users / base) * 100 : null,
      engagementPct: a.active_users > 0 ? (a.engaged_users / a.active_users) * 100 : null,
      referral: {
        marketing: a.referral_marketing,
        regional: a.referral_regional,
        location: a.referral_location,
      },
      claims: events.filter((e) => e.event_type === "claimed" && e.logo_org_id === a.org_id).length,
      revenue: data.revenue
        .filter((r) => r.period_start === cur && r.group_key === a.group_key)
        .reduce((s, r) => s + r.amount, 0),
    };
  });

  const now = Date.now();
  const callbackQueue = notes
    .filter((x) => x.callback_priority)
    .map((x) => {
      const due = x.callback_at ? new Date(x.callback_at).getTime() : null;
      const overdueDays = due != null ? Math.floor((now - due) / DAY) : null;
      return { ...x, overdueDays, rotten: (overdueDays ?? 0) >= 3 };
    })
    .sort((a, b) => (b.overdueDays ?? -999) - (a.overdueDays ?? -999));

  const logoCounts = new Map<string, { claims: number; logoUrl: string | null }>();
  for (const e of events) {
    if (e.event_type !== "claimed") continue;
    const label = e.logo_org_id
      ? data.orgNames[e.logo_org_id] ?? "Unnamed brand"
      : e.group_key ?? "Unassigned";
    const prev = logoCounts.get(label);
    logoCounts.set(label, {
      claims: (prev?.claims ?? 0) + 1,
      logoUrl: prev?.logoUrl ?? (e.logo_org_id ? data.orgLogos[e.logo_org_id] ?? null : null),
    });
  }


  return {
    rep,
    roleShort: roleShort(rep.role),
    lens: lensFor(rep.role),
    territories,
    chains,
    failedToClaim: chains.filter((c) => c.attemptedAt && !c.claimedAt).map(decorate),
    claimedEngaged: chains
      .filter((c) => c.claimedAt)
      .sort((a, b) => b.engagement - a.engagement)
      .map(decorate),
    lapsed: chains
      .filter((c) => c.lapsedAt || (c.engagedAt && !c.upgradedAt && (daysAgo(c.engagedAt) ?? 0) >= 30))
      .sort((a, b) => b.engagement - a.engagement)
      .map(decorate),
    territoryRevenue,
    myRevenue,
    myRevenueBySource: REVENUE_SOURCES.map((s) => {
      const amount = myRevenueRows
        .filter((r) => r.source === s.key)
        .reduce((sum, r) => sum + r.amount, 0);
      return { ...s, amount, share: myRevenue > 0 ? (amount / myRevenue) * 100 : 0 };
    }).filter((s) => s.amount > 0),
    target,
    quotaPct: target > 0 ? (myRevenue / target) * 100 : null,
    demos,
    demosAttended: demos.filter((d) => d.attended).length,
    demoWon,
    demoConversion: demos.length ? (demoWon / demos.length) * 100 : null,
    notes,
    callbackQueue,
    brands: brands.sort((a, b) => b.engagedUsers - a.engagedUsers),
    claimsByLogo: [...logoCounts.entries()]
      .map(([label, v]) => ({ label, claims: v.claims, logoUrl: v.logoUrl }))
      .sort((a, b) => b.claims - a.claims),

  };
}

/* ══════════════════ Writes ══════════════════ */

export async function addNote(input: {
  sellerId: string;
  subjectLabel: string;
  subjectType?: string;
  body: string;
  callbackPriority: boolean;
  callbackAt?: string | null;
  createdBy?: string | null;
}) {
  await api.post(`${B}/notes`, {
    seller_id: input.sellerId,
    subject_label: input.subjectLabel,
    subject_type: input.subjectType ?? "contact",
    body: input.body,
    callback_priority: input.callbackPriority,
    callback_at: input.callbackAt ?? null,
    created_by: input.createdBy ?? null,
  });
}

export async function setCallbackPriority(noteId: string, on: boolean) {
  await api.patch(`${B}/notes/${encodeURIComponent(noteId)}`, { callback_priority: on });
}

export const REFERRAL_TARGETS = [
  { key: "location", label: "Location manager" },
  { key: "regional", label: "Regional manager" },
  { key: "corporate", label: "Corporate marketing" },
] as const;

/** Referral requests are logged as notes so the ask is auditable next to adoption evidence. */
export async function requestReferral(input: {
  sellerId: string;
  brandName: string;
  target: (typeof REFERRAL_TARGETS)[number]["key"];
  contact: string | null;
  adoptionNote: string;
  createdBy?: string | null;
}) {
  const targetLabel = REFERRAL_TARGETS.find((t) => t.key === input.target)?.label ?? input.target;
  // subject_type "referral_request", callback priority on, callback_at = the server's clock + 2 days
  await api.post(`${B}/referral-requests`, {
    seller_id: input.sellerId,
    subject_label: input.brandName,
    body: `Referral requested from ${targetLabel}${input.contact ? ` (${input.contact})` : ""} — adoption evidence: ${input.adoptionNote}`,
    created_by: input.createdBy ?? null,
  });
}

/* ══════════════════ Formatting ══════════════════ */

export const usd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const pct1 = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}%`);
export const days1 = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)}d`);
export const dtf = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? `${dtf.format(new Date(iso))} UTC` : "—";
export const lastTouchLabel = (iso: string | null | undefined) => {
  const d = daysAgo(iso ?? null);
  if (d == null) return "no touch logged";
  if (d === 0) return "touched today";
  return `touched ${d}d ago`;
};
