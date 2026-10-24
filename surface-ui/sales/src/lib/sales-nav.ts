import { api } from "@v3/ui/lib/server-fn";
import { SELLER_ROLES, type SellerRole } from "@v3/sales/lib/sales";

/** FastAPI: surface-api/sales/routers/nav_data.py (runs as the signed-in user). */
const N = "/sales/nav";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;
const enc = encodeURIComponent;

/* ─────────── Period scoping ─────────── */

export type Period = "month" | "quarter" | "year";
export const PERIODS: { value: Period; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
  { value: "year", label: "This year" },
];

/** UTC start of the given period, matching exp_sales_quotas.period_start. */
export function periodStart(period: Period, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d =
    period === "year"
      ? new Date(Date.UTC(y, 0, 1))
      : period === "quarter"
        ? new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))
        : new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

/* ─────────── Overview ─────────── */

export type QuotaRow = {
  id: string;
  rep_id: string | null;
  group_key: string | null;
  period_type: string;
  period_start: string;
  target: number | null;
  actual: number | null;
  is_demo: boolean | null;
};

export type SoldBy = { key: string; label: string; contracts: number; mrr: number; upgrades: number };

export type Overview = {
  teams: number;
  teamKeys: string[];
  sellers: number;
  claims: number;
  liveCategories: number;
  realContracts: number;
  realMrr: number;
  realUpgrades: number;
  demoContracts: number;
  demoMrr: number;
  demoSellers: number;
  quota: { target: number; actual: number; rows: number; demoOnly: boolean };
  soldBy: SoldBy[];
  soldByIsDemo: boolean;
};

const ROLE_ORDER: { key: string; label: string }[] = [
  { key: "os", label: "OS (self-serve)" },
  { key: "srx", label: "SRE" },
  { key: "smb", label: "SMB" },
  { key: "mid_market", label: "MM" },
  { key: "enterprise", label: "ENT" },
];

export async function loadOverview(period: Period): Promise<Overview> {
  const since = periodStart(period);
  const sinceTs = `${since}T00:00:00Z`;

  const o = await api.get<{
    reps: Raw[];
    quotas: Raw[];
    contracts: Raw[];
    cats: number | null;
    proClaims: number | null;
    orgClaims: number | null;
    events: Raw[];
    assignments: Raw[];
  }>(`${N}/overview`, { params: { period, since } });

  const repRows = o.reps ?? [];
  const teamKeys = Array.from(new Set(repRows.map((r) => r.group_key).filter(Boolean))) as string[];
  const roleByRep = new Map(repRows.map((r) => [r.id as string, r.role as string]));
  const repByAccount = new Map<string, string>();
  const repByLogo = new Map<string, string>();
  for (const a of o.assignments ?? []) {
    if (!a.rep_id || !a.target_ref) continue;
    if (a.assignment_type === "account") repByAccount.set(a.target_ref, a.rep_id);
    if (a.assignment_type === "logo") repByLogo.set(a.target_ref, a.rep_id);
  }

  const contractRows = (o.contracts ?? []).filter(
    (c) => c.status === "active" && (c.created_at == null || c.created_at >= sinceTs || period === "year"),
  );
  const real = contractRows.filter((c) => !c.is_demo);
  const demo = contractRows.filter((c) => c.is_demo);
  const eventRows = o.events ?? [];
  const realUpgrades = eventRows.filter((e) => e.event_type === "upgrade" && !e.is_demo).length;

  // Sold-by: attribute a contract/upgrade to the rep who owns that account (or logo).
  const attribution = new Map<string, SoldBy>(
    ROLE_ORDER.map((r) => [r.key, { ...r, contracts: 0, mrr: 0, upgrades: 0 }]),
  );
  const roleFor = (accountId: string | null, logo: string | null) => {
    const repId = (accountId && repByAccount.get(accountId)) || (logo && repByLogo.get(logo)) || null;
    const role = repId ? roleByRep.get(repId) : null;
    return role && attribution.has(role) ? role : null;
  };
  const sourceContracts = real.length ? real : demo;
  for (const c of sourceContracts) {
    const role = roleFor(c.account_id ?? null, null);
    if (!role) continue;
    const bucket = attribution.get(role)!;
    bucket.contracts += 1;
    bucket.mrr += Number(c.mrr ?? 0);
  }
  const sourceUpgrades = eventRows.filter(
    (e) => e.event_type === "upgrade" && (realUpgrades > 0 ? !e.is_demo : true),
  );
  for (const e of sourceUpgrades) {
    const role = roleFor(e.account_id ?? null, e.logo ?? null);
    if (!role) continue;
    attribution.get(role)!.upgrades += 1;
  }

  const quotaRows = (o.quotas ?? []) as QuotaRow[];
  const quotaReal = quotaRows.filter((q) => !q.is_demo);
  const quotaSource = quotaReal.length ? quotaReal : quotaRows;

  return {
    teams: teamKeys.length,
    teamKeys,
    sellers: repRows.filter((r) => !r.is_demo).length,
    claims: (o.proClaims ?? 0) + (o.orgClaims ?? 0),
    liveCategories: o.cats ?? 0,
    realContracts: real.length,
    realMrr: real.reduce((s, c) => s + Number(c.mrr ?? 0), 0),
    realUpgrades,
    demoContracts: demo.length,
    demoMrr: demo.reduce((s, c) => s + Number(c.mrr ?? 0), 0),
    demoSellers: repRows.filter((r) => r.is_demo).length,
    quota: {
      target: quotaSource.reduce((s, q) => s + Number(q.target ?? 0), 0),
      actual: quotaSource.reduce((s, q) => s + Number(q.actual ?? 0), 0),
      rows: quotaSource.length,
      demoOnly: quotaReal.length === 0 && quotaRows.length > 0,
    },
    soldBy: ROLE_ORDER.map((r) => attribution.get(r.key)!),
    soldByIsDemo: real.length === 0 && demo.length > 0,
  };
}

/* ─────────── Universal browse ─────────── */

export type BrowseTab =
  | "categories"
  | "teams"
  | "sellers"
  | "brands"
  | "locations"
  | "professionals";

export type BrowseArgs = {
  tab: BrowseTab;
  q: string;
  page: number;
  pageSize: number;
  gcid?: string;
  includeDemo?: boolean;
};

export type BrowseRow = {
  id: string;
  to: string;
  params: Record<string, string>;
  primary: string;
  secondary: string | null;
  meta: string | null;
  extra: string | null;
  isDemo: boolean;
};

export type BrowseResult = { rows: BrowseRow[]; count: number };

const BRAND_TYPES = ["brand", "enterprise", "company"];
const LOCATION_TYPES = ["office", "location", "branch", "firm"];

export async function browse(args: BrowseArgs): Promise<BrowseResult> {
  const { tab, q, page, pageSize, gcid, includeDemo } = args;
  const from = (page - 1) * pageSize;

  const { rows: data, count } = await api.get<{ rows: Raw[]; count: number | null }>(`${N}/browse`, {
    params: { tab, q, page, page_size: pageSize, gcid: gcid || undefined, include_demo: !!includeDemo },
  });

  if (tab === "categories") {
    return {
      count: count ?? 0,
      rows: (data ?? []).map((c) => ({
        id: c.gcid as string,
        to: "/sales/categories/$gcid",
        params: { gcid: c.gcid as string },
        primary: (c.display_name as string) ?? c.gcid,
        secondary: c.gcid as string,
        meta: (c.entity_type as string) ?? null,
        extra: c.status === "active" ? "active" : ((c.status as string) ?? "—"),
        isDemo: false,
      })),
    };
  }

  if (tab === "teams" || tab === "sellers") {
    const reps = data ?? [];
    if (tab === "teams") {
      const groups = new Map<string, { count: number; demo: number; roles: Set<string> }>();
      for (const r of reps) {
        const key = (r.group_key as string) ?? "unassigned";
        const g = groups.get(key) ?? { count: 0, demo: 0, roles: new Set<string>() };
        g.count += 1;
        if (r.is_demo) g.demo += 1;
        g.roles.add(r.role as string);
        groups.set(key, g);
      }
      const all = Array.from(groups.entries())
        .filter(([k]) => !q.trim() || k.toLowerCase().includes(q.trim().toLowerCase()))
        .map(([k, g]) => ({
          id: k,
          to: "/sales/teams/$groupKey",
          params: { groupKey: k },
          primary: k.replace(/_/g, " "),
          secondary: `${g.count} seller${g.count === 1 ? "" : "s"}`,
          meta: Array.from(g.roles)
            .map((r) => SELLER_ROLES[r as SellerRole]?.label ?? r)
            .join(" · "),
          extra: null,
          isDemo: g.demo === g.count && g.count > 0,
        }));
      return { count: all.length, rows: all.slice(from, from + pageSize) };
    }
    const filtered = reps.filter(
      (r) =>
        !q.trim() ||
        `${r.name} ${r.email ?? ""} ${r.role}`.toLowerCase().includes(q.trim().toLowerCase()),
    );
    return {
      count: filtered.length,
      rows: filtered.slice(from, from + pageSize).map((r) => ({
        id: r.id as string,
        to: "/sales/sellers/$repId",
        params: { repId: r.id as string },
        primary: r.name as string,
        secondary: (r.email as string) ?? null,
        meta: SELLER_ROLES[r.role as SellerRole]?.label ?? (r.role as string),
        extra: (r.group_key as string) ?? null,
        isDemo: !!r.is_demo,
      })),
    };
  }

  if (tab === "professionals") {
    return {
      count: count ?? 0,
      rows: (data ?? []).map((p) => ({
        id: p.id as string,
        to: "/sales/professionals/$proId",
        params: { proId: p.id as string },
        primary: (p.display_name as string) ?? "Unnamed",
        secondary: [p.address_city, p.address_state].filter(Boolean).join(", ") || null,
        meta: (p.job_title as string) ?? null,
        extra: p.claimed ? "claimed" : "unclaimed",
        isDemo: !!p.is_demo,
      })),
    };
  }

  // brands + locations both live in organizations
  return {
    count: count ?? 0,
    rows: (data ?? []).map((o) => ({
      id: o.id as string,
      to: tab === "brands" ? "/sales/brands/$orgId" : "/sales/locations/$orgId",
      params: { orgId: o.id as string },
      primary: (o.name as string) ?? "Unnamed",
      secondary: [o.address_city, o.address_state].filter(Boolean).join(", ") || null,
      meta: (o.entity_type as string) ?? null,
      extra: o.claimed ? "claimed" : "unclaimed",
      isDemo: !!o.is_demo,
    })),
  };
}

/* ─────────── Drill-downs ─────────── */

export type ScoreRow = {
  entity_id: string;
  total_score: number | null;
  max_possible: number | null;
  score_pct: number | null;
  local_rank: number | null;
  local_rank_of: number | null;
  gaps: unknown;
  calculated_at: string | null;
};

export async function loadScore(entityId: string): Promise<ScoreRow | null> {
  const data = await api.get<ScoreRow | null>(`${N}/scores/${enc(entityId)}`);
  return data ?? null;
}

export async function loadOrg(orgId: string) {
  return api.get<Raw | null>(`${N}/organizations/${enc(orgId)}`);
}

export async function loadBrandRollup(orgId: string) {
  const r = await api.get<{
    locations: Raw[];
    childCount: number | null;
    directCount: number | null;
    viaOfficesCount: number | null;
    claims: { entity_id: string | null; entity_type: string | null; event_type: string | null }[];
  }>(`${N}/organizations/${enc(orgId)}/brand-rollup`);
  const claimRows = r.claims ?? [];
  const claimedLocations = new Set(claimRows.filter((r) => r.entity_type === "location" && r.entity_id).map((r) => r.entity_id)).size;
  const claimedProfessionals = new Set(claimRows.filter((r) => r.entity_type === "professional" && r.entity_id).map((r) => r.entity_id)).size;
  return {
    locations: r.locations ?? [],
    childCount: r.childCount ?? 0,
    // a failed via-offices count adds 0
    proCount: (r.directCount ?? 0) + (r.viaOfficesCount ?? 0),
    claimedLocations,
    claimedProfessionals,
  };
}

export async function loadProfessional(proId: string) {
  return api.get<Raw | null>(`${N}/professionals/${enc(proId)}`);
}

export async function loadEventsFor(opts: { accountId?: string; logo?: string; location?: string; subjectId?: string }) {
  const data = await api.get<Raw[]>(`${N}/events`, {
    params: {
      subject_id: opts.subjectId || undefined,
      account_id: opts.accountId || undefined,
      logo: opts.logo || undefined,
      location: opts.location || undefined,
    },
  });
  return data ?? [];
}

export async function loadSeller(repId: string) {
  const r = await api.get<{ rep: Raw | null; quotas: QuotaRow[]; assignments: Raw[] }>(`${N}/sellers/${enc(repId)}`);
  return {
    rep: r.rep,
    quotas: (r.quotas ?? []) as QuotaRow[],
    assignments: r.assignments ?? [],
  };
}

export async function loadSellerBook(accountIds: string[]) {
  if (!accountIds.length) return { contracts: [], events: [] };
  const r = await api.post<{ contracts: Raw[]; events: Raw[] }>(`${N}/seller-book`, { account_ids: accountIds });
  return { contracts: r.contracts ?? [], events: r.events ?? [] };
}

export async function loadCategoryDashboard(gcid: string) {
  const r = await api.get<{ category: Raw | null; orgCount: number | null; proCount: number | null; sampleOrgs: Raw[] }>(
    `${N}/category-dashboard`,
    { params: { gcid } },
  );
  return {
    category: r.category,
    orgCount: r.orgCount ?? 0,
    proCount: r.proCount ?? 0,
    sampleOrgs: r.sampleOrgs ?? [],
  };
}

export async function loadTeam(groupKey: string) {
  const r = await api.get<{ reps: Raw[]; quotas: QuotaRow[]; tiers: Raw[] }>(`${N}/teams/${enc(groupKey)}`);
  return { reps: r.reps ?? [], quotas: (r.quotas ?? []) as QuotaRow[], tiers: r.tiers ?? [] };
}
