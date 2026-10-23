import { supabase } from "@/integrations/supabase/client";
import { SELLER_ROLES, type SellerRole } from "@/lib/sales";

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

  const [reps, quotas, contracts, cats, proClaims, orgClaims, events, assignments] = await Promise.all([
    supabase.from("exp_sales_reps").select("id,name,email,role,group_key,is_demo"),
    supabase
      .from("exp_sales_quotas")
      .select("id,rep_id,group_key,period_type,period_start,target,actual,is_demo")
      .eq("period_type", period)
      .eq("period_start", since),
    supabase.from("exp_contracts").select("id,name,status,mrr,account_id,created_by,is_demo,created_at"),
    supabase.from("gbp_categories").select("gcid", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("professionals")
      .select("id", { count: "exact", head: true })
      .eq("is_demo", false)
      .gte("claimed_at", sinceTs),
    supabase
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("is_demo", false)
      .gte("claimed_at", sinceTs),
    supabase
      .from("exp_activity_events")
      .select("id,event_type,account_id,logo,is_demo,occurred_at")
      .gte("occurred_at", sinceTs)
      .limit(5000),
    supabase.from("exp_sales_assignments").select("rep_id,assignment_type,target_ref"),
  ]);

  const repRows = reps.data ?? [];
  const teamKeys = Array.from(new Set(repRows.map((r) => r.group_key).filter(Boolean))) as string[];
  const roleByRep = new Map(repRows.map((r) => [r.id as string, r.role as string]));
  const repByAccount = new Map<string, string>();
  const repByLogo = new Map<string, string>();
  for (const a of assignments.data ?? []) {
    if (!a.rep_id || !a.target_ref) continue;
    if (a.assignment_type === "account") repByAccount.set(a.target_ref, a.rep_id);
    if (a.assignment_type === "logo") repByLogo.set(a.target_ref, a.rep_id);
  }

  const contractRows = (contracts.data ?? []).filter(
    (c) => c.status === "active" && (c.created_at == null || c.created_at >= sinceTs || period === "year"),
  );
  const real = contractRows.filter((c) => !c.is_demo);
  const demo = contractRows.filter((c) => c.is_demo);
  const eventRows = events.data ?? [];
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

  const quotaRows = (quotas.data ?? []) as QuotaRow[];
  const quotaReal = quotaRows.filter((q) => !q.is_demo);
  const quotaSource = quotaReal.length ? quotaReal : quotaRows;

  return {
    teams: teamKeys.length,
    teamKeys,
    sellers: repRows.filter((r) => !r.is_demo).length,
    claims: (proClaims.count ?? 0) + (orgClaims.count ?? 0),
    liveCategories: cats.count ?? 0,
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
  const to = from + pageSize - 1;
  const like = `%${q.trim()}%`;

  if (tab === "categories") {
    let query = supabase
      .from("gbp_categories")
      .select("gcid,display_name,status,entity_type,estimated_profiles", { count: "exact" })
      .order("display_name")
      .range(from, to);
    if (q.trim()) query = query.ilike("display_name", like);
    const { data, count, error } = await query;
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("exp_sales_reps")
      .select("id,name,email,role,group_key,is_demo")
      .order("group_key")
      .order("name");
    if (error) throw error;
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
    let query = supabase
      .from("professionals")
      .select(
        "id,display_name,slug,job_title,address_city,address_state,gcid,claimed,is_demo,search_rank_score",
        { count: "exact" },
      )
      .order("display_name")
      .range(from, to);
    if (!includeDemo) query = query.eq("is_demo", false);
    if (gcid) query = query.eq("gcid", gcid);
    if (q.trim()) query = query.ilike("display_name", like);
    const { data, count, error } = await query;
    if (error) throw error;
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
  const types = tab === "brands" ? BRAND_TYPES : LOCATION_TYPES;
  let query = supabase
    .from("organizations")
    .select(
      "id,name,slug,entity_type,address_city,address_state,gcid,claimed,is_demo,parent_org_id,hierarchy_depth",
      { count: "exact" },
    )
    .in("entity_type", types)
    .order("name")
    .range(from, to);
  if (!includeDemo) query = query.eq("is_demo", false);
  if (gcid) query = query.eq("gcid", gcid);
  if (q.trim()) query = query.ilike("name", like);
  const { data, count, error } = await query;
  if (error) throw error;
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
  const { data, error } = await supabase
    .from("search_rank_scores")
    .select("entity_id,total_score,max_possible,score_pct,local_rank,local_rank_of,gaps,calculated_at")
    .eq("entity_id", entityId)
    .order("calculated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as ScoreRow) ?? null;
}

export async function loadOrg(orgId: string) {
  const { data, error } = await supabase.from("organizations").select("*").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadBrandRollup(orgId: string) {
  const db = supabase as unknown as { from: (t: string) => any };
  const [locations, children, direct, viaOffices, claims] = await Promise.all([
    supabase
      .from("organizations")
      .select("id,name,entity_type,address_city,address_state,claimed,is_demo,search_rank_score")
      .eq("parent_org_id", orgId)
      .order("name")
      .limit(500),
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("parent_org_id", orgId),
    supabase.from("professionals").select("id", { count: "exact", head: true }).eq("primary_org_id", orgId),
    // Professionals attached to one of the brand's offices roll up to the brand.
    db.from("professionals").select("id,organizations!professionals_primary_org_id_fkey!inner(parent_org_id)", { count: "exact", head: true }).eq("organizations.parent_org_id", orgId),
    db.from("exp_claim_events").select("entity_id,entity_type,event_type").eq("logo_org_id", orgId).in("event_type", ["claimed", "engaged", "upgraded"]).limit(10000),
  ]);
  if (locations.error) throw locations.error;
  const claimRows = (claims.data ?? []) as { entity_id: string | null; entity_type: string | null }[];
  const claimedLocations = new Set(claimRows.filter((r) => r.entity_type === "location" && r.entity_id).map((r) => r.entity_id)).size;
  const claimedProfessionals = new Set(claimRows.filter((r) => r.entity_type === "professional" && r.entity_id).map((r) => r.entity_id)).size;
  return {
    locations: locations.data ?? [],
    childCount: children.count ?? 0,
    proCount: (direct.count ?? 0) + (viaOffices.error ? 0 : viaOffices.count ?? 0),
    claimedLocations,
    claimedProfessionals,
  };
}

export async function loadProfessional(proId: string) {
  const { data, error } = await supabase.from("professionals").select("*").eq("id", proId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadEventsFor(opts: { accountId?: string; logo?: string; location?: string; subjectId?: string }) {
  let query = supabase
    .from("exp_activity_events")
    .select("id,event_type,subject_type,subject_id,account_id,logo,location,actor,occurred_at,is_demo")
    .order("occurred_at", { ascending: false })
    .limit(200);
  if (opts.subjectId) query = query.eq("subject_id", opts.subjectId);
  else if (opts.accountId) query = query.eq("account_id", opts.accountId);
  else if (opts.logo) query = query.eq("logo", opts.logo);
  else if (opts.location) query = query.eq("location", opts.location);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function loadSeller(repId: string) {
  const [rep, quotas, assignments] = await Promise.all([
    supabase.from("exp_sales_reps").select("*").eq("id", repId).maybeSingle(),
    supabase
      .from("exp_sales_quotas")
      .select("id,rep_id,group_key,period_type,period_start,target,actual,is_demo")
      .eq("rep_id", repId)
      .order("period_start", { ascending: false }),
    supabase.from("exp_sales_assignments").select("*").eq("rep_id", repId),
  ]);
  if (rep.error) throw rep.error;
  return {
    rep: rep.data,
    quotas: (quotas.data ?? []) as QuotaRow[],
    assignments: assignments.data ?? [],
  };
}

export async function loadSellerBook(accountIds: string[]) {
  if (!accountIds.length) return { contracts: [], events: [] };
  const [contracts, events] = await Promise.all([
    supabase.from("exp_contracts").select("*").in("account_id", accountIds),
    supabase
      .from("exp_activity_events")
      .select("id,event_type,account_id,logo,location,occurred_at,is_demo")
      .in("account_id", accountIds)
      .order("occurred_at", { ascending: false })
      .limit(500),
  ]);
  if (contracts.error) throw contracts.error;
  return { contracts: contracts.data ?? [], events: events.data ?? [] };
}

export async function loadCategoryDashboard(gcid: string) {
  const [cat, orgs, pros, locations] = await Promise.all([
    supabase.from("gbp_categories").select("*").eq("gcid", gcid).maybeSingle(),
    supabase
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("gcid", gcid)
      .eq("is_demo", false),
    supabase
      .from("professionals")
      .select("id", { count: "exact", head: true })
      .eq("gcid", gcid)
      .eq("is_demo", false),
    supabase
      .from("organizations")
      .select("id,name,entity_type,address_city,address_state,claimed")
      .eq("gcid", gcid)
      .eq("is_demo", false)
      .order("name")
      .limit(25),
  ]);
  if (cat.error) throw cat.error;
  return {
    category: cat.data,
    orgCount: orgs.count ?? 0,
    proCount: pros.count ?? 0,
    sampleOrgs: locations.data ?? [],
  };
}

export async function loadTeam(groupKey: string) {
  const [reps, quotas, tiers] = await Promise.all([
    supabase.from("exp_sales_reps").select("*").eq("group_key", groupKey).order("role"),
    supabase
      .from("exp_sales_quotas")
      .select("id,rep_id,group_key,period_type,period_start,target,actual,is_demo")
      .eq("group_key", groupKey),
    supabase.from("exp_account_tier").select("*").eq("group_key", groupKey),
  ]);
  if (reps.error) throw reps.error;
  return { reps: reps.data ?? [], quotas: (quotas.data ?? []) as QuotaRow[], tiers: tiers.data ?? [] };
}
