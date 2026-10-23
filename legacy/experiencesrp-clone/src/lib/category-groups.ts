import { supabase } from "@/integrations/supabase/client";
import { currentPeriodStart, type TerritorySlot } from "@/lib/territories";

/* ────────────────────────────────────────────────────────────
   Category-group territory + team reporting data layer.
   A TEAM owns a GROUP of categories (exp_category_groups),
   not a single gcid. Everything here is read live — real-only.
   ──────────────────────────────────────────────────────────── */

const db = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, a?: any) => any };

export const CATCHALL_GROUP = "_catchall";

export type CategoryGroup = {
  id: string;
  group_key: string;
  label: string;
  description: string | null;
  is_catchall: boolean | null;
  is_launch_priority: boolean | null;
};

export type GroupMember = { id: string; group_key: string; gcid: string; label: string };

export type GroupOverview = CategoryGroup & {
  members: number;
  brands: number;
  offices: number;
  agents: number;
  territories: number;
  assigned: number;
  unassigned: number;
  quotaTarget: number;
  quotaActual: number;
  attainment: number | null;
  isDemo: boolean;
};

export type GroupQuota = {
  id: string;
  rep_id: string | null;
  group_key: string | null;
  period_type: string | null;
  period_start: string | null;
  target: number | null;
  actual: number | null;
  is_demo: boolean | null;
};

export type RepMetrics = {
  rep_id: string | null;
  group_key: string | null;
  period_start: string | null;
  profiles_assigned: number | null;
  logos_assigned: number | null;
  views: number | null;
  attempted_claims: number | null;
  claims: number | null;
  engaged_30d: number | null;
  logo_signals: number | null;
  demos_booked: number | null;
  demos_attended: number | null;
  closings: number | null;
  upgrades: number | null;
  revenue: number | null;
  is_demo: boolean | null;
};

/* ─────────── Reads ─────────── */

export async function loadCategoryGroups(): Promise<CategoryGroup[]> {
  const { data, error } = await db.from("exp_category_groups").select("*").order("label");
  if (error) throw error;
  return (data ?? []) as CategoryGroup[];
}

export async function loadGroupMembers(groupKey?: string): Promise<GroupMember[]> {
  let q = db.from("exp_category_group_members").select("id,group_key,gcid").order("gcid");
  if (groupKey) q = q.eq("group_key", groupKey);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as { id: string; group_key: string; gcid: string }[];
  const gcids = [...new Set(rows.map((r) => r.gcid))];
  let names: Record<string, string> = {};
  if (gcids.length) {
    const { data: cats } = await db.from("gbp_categories").select("gcid,display_name").in("gcid", gcids);
    names = Object.fromEntries(
      ((cats ?? []) as { gcid: string; display_name: string | null }[]).map((c) => [
        c.gcid,
        c.display_name ?? c.gcid,
      ]),
    );
  }
  return rows.map((r) => ({ ...r, label: names[r.gcid] ?? r.gcid }));
}

export async function loadGroupTerritories(groupKey?: string): Promise<TerritorySlot[]> {
  let q = db.from("exp_territories").select("*").order("tier").order("seq");
  if (groupKey) q = q.eq("group_key", groupKey);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TerritorySlot[];
}

export async function loadGroupQuotas(groupKey?: string): Promise<GroupQuota[]> {
  let q = db
    .from("exp_sales_quotas")
    .select("id,rep_id,group_key,period_type,period_start,target,actual,is_demo")
    .order("period_start", { ascending: false });
  if (groupKey) q = q.eq("group_key", groupKey);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as GroupQuota[];
}

export async function loadGroupMetrics(groupKey?: string): Promise<RepMetrics[]> {
  let q = db.from("exp_sales_rep_metrics").select("*").order("period_start", { ascending: false });
  if (groupKey) q = q.eq("group_key", groupKey);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RepMetrics[];
}

/** Groups list: volume + territory + quota rollups per group. */
export async function loadGroupsOverview(): Promise<GroupOverview[]> {
  const [groups, members, terrs, quotas] = await Promise.all([
    loadCategoryGroups(),
    loadGroupMembers(),
    loadGroupTerritories(),
    loadGroupQuotas(),
  ]);
  const period = currentPeriodStart();
  return groups
    .map((g) => {
      const mine = terrs.filter((t) => (t as any).group_key === g.group_key);
      const q = quotas.filter((r) => r.group_key === g.group_key && r.period_start === period);
      const quotaTarget = q.reduce((s, r) => s + Number(r.target ?? 0), 0);
      const quotaActual = q.reduce((s, r) => s + Number(r.actual ?? 0), 0);
      return {
        ...g,
        members: members.filter((m) => m.group_key === g.group_key).length,
        brands: mine.reduce((s, t) => s + Number(t.brand_count ?? 0), 0),
        offices: mine.reduce((s, t) => s + Number(t.office_count ?? 0), 0),
        agents: mine.reduce((s, t) => s + Number(t.agent_count ?? 0), 0),
        territories: mine.length,
        assigned: mine.filter((t) => t.seller_id).length,
        unassigned: mine.filter((t) => !t.seller_id).length,
        quotaTarget,
        quotaActual,
        attainment: quotaTarget > 0 ? (quotaActual / quotaTarget) * 100 : null,
        isDemo: q.length > 0 && q.every((r) => r.is_demo === true),
      };
    })
    .sort((a, b) => {
      if (!!a.is_catchall !== !!b.is_catchall) return a.is_catchall ? 1 : -1;
      if (!!a.is_launch_priority !== !!b.is_launch_priority) return a.is_launch_priority ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

/** Categories available to add to a group (search by name or gcid). */
export async function searchCategories(term: string): Promise<{ gcid: string; label: string }[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const { data, error } = await db
    .from("gbp_categories")
    .select("gcid,display_name")
    .or(`display_name.ilike.%${t}%,gcid.ilike.%${t}%`)
    .limit(25);
  if (error) throw error;
  return ((data ?? []) as { gcid: string; display_name: string | null }[]).map((c) => ({
    gcid: c.gcid,
    label: c.display_name ?? c.gcid,
  }));
}

/* ─────────── Consolidated team scorecard (across ALL member categories) ─────────── */

export type GroupSellerCard = {
  repId: string;
  name: string;
  role: string;
  isDemo: boolean;
  target: number;
  actual: number;
  pct: number | null;
  funnel: {
    views: number;
    attemptedClaims: number;
    claims: number;
    engaged30d: number;
    logoSignals: number;
    demosBooked: number;
    demosAttended: number;
    closings: number;
    upgrades: number;
    revenue: number;
  };
  conversion: number | null;
  profilesAssigned: number;
  logosAssigned: number;
  pipelineOpen: number;
  territories: string[];
};

export type GroupScorecard = {
  sellers: GroupSellerCard[];
  totals: GroupSellerCard["funnel"] & { target: number; actual: number; pct: number | null };
  allDemo: boolean;
};

export async function loadGroupScorecard(groupKey: string): Promise<GroupScorecard> {
  const period = currentPeriodStart();
  const [quotas, metrics, terrs, repsRes, pipeRes] = await Promise.all([
    loadGroupQuotas(groupKey),
    loadGroupMetrics(groupKey),
    loadGroupTerritories(groupKey),
    db.from("exp_sales_reps").select("id,name,role,group_key,is_demo").order("name"),
    db.from("exp_sales_pipeline").select("owner,stage,value,is_demo"),
  ]);
  const reps = ((repsRes.data ?? []) as any[]).map((r) => r);
  const pipeline = (pipeRes.data ?? []) as { owner: string; stage: string; value: number | null }[];

  const repIds = new Set<string>();
  for (const q of quotas) if (q.rep_id && q.period_start === period) repIds.add(q.rep_id);
  for (const m of metrics) if (m.rep_id && m.period_start === period) repIds.add(m.rep_id);
  for (const t of terrs) if (t.seller_id) repIds.add(t.seller_id);

  const sellers: GroupSellerCard[] = [...repIds].map((repId) => {
    const rep = reps.find((r) => r.id === repId);
    // Aggregate across ALL member categories of the group (rows are already group-scoped).
    const q = quotas.filter((r) => r.rep_id === repId && r.period_start === period);
    const m = metrics.filter((r) => r.rep_id === repId && r.period_start === period);
    const target = q.reduce((s, r) => s + Number(r.target ?? 0), 0);
    const actual = q.reduce((s, r) => s + Number(r.actual ?? 0), 0);
    const sum = (k: keyof RepMetrics) => m.reduce((s, r) => s + Number((r[k] as number) ?? 0), 0);
    const funnel = {
      views: sum("views"),
      attemptedClaims: sum("attempted_claims"),
      claims: sum("claims"),
      engaged30d: sum("engaged_30d"),
      logoSignals: sum("logo_signals"),
      demosBooked: sum("demos_booked"),
      demosAttended: sum("demos_attended"),
      closings: sum("closings"),
      upgrades: sum("upgrades"),
      revenue: sum("revenue"),
    };
    const open = pipeline
      .filter((p) => p.owner === repId && ["prospect", "qualified", "proposal"].includes(p.stage))
      .reduce((s, p) => s + Number(p.value ?? 0), 0);
    return {
      repId,
      name: (rep?.name as string) ?? repId.slice(0, 8),
      role: (rep?.role as string) ?? "—",
      isDemo: !!rep?.is_demo || (q.length > 0 && q.every((r) => r.is_demo === true)),
      target,
      actual,
      pct: target > 0 ? (actual / target) * 100 : null,
      funnel,
      conversion: funnel.demosAttended > 0 ? (funnel.closings / funnel.demosAttended) * 100 : null,
      profilesAssigned: sum("profiles_assigned"),
      logosAssigned: sum("logos_assigned"),
      pipelineOpen: open,
      territories: terrs.filter((t) => t.seller_id === repId).map((t) => t.label),
    };
  });

  sellers.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));

  const add = (k: keyof GroupSellerCard["funnel"]) => sellers.reduce((s, c) => s + c.funnel[k], 0);
  const target = sellers.reduce((s, c) => s + c.target, 0);
  const actual = sellers.reduce((s, c) => s + c.actual, 0);

  return {
    sellers,
    totals: {
      views: add("views"),
      attemptedClaims: add("attemptedClaims"),
      claims: add("claims"),
      engaged30d: add("engaged30d"),
      logoSignals: add("logoSignals"),
      demosBooked: add("demosBooked"),
      demosAttended: add("demosAttended"),
      closings: add("closings"),
      upgrades: add("upgrades"),
      revenue: add("revenue"),
      target,
      actual,
      pct: target > 0 ? (actual / target) * 100 : null,
    },
    allDemo: sellers.length > 0 && sellers.every((s) => s.isDemo),
  };
}

/* ─────────── Writes ─────────── */

export async function addGroupMember(groupKey: string, gcid: string) {
  const { error } = await db.from("exp_category_group_members").insert({ group_key: groupKey, gcid });
  if (error) throw error;
}

export async function removeGroupMember(id: string) {
  const { error } = await db.from("exp_category_group_members").delete().eq("id", id);
  if (error) throw error;
}

/** Regenerate a group's territories from real volume across all member categories. */
export async function generateGroupTerritories(groupKey: string) {
  const { data, error } = await db.rpc("exp_generate_group_territories", { p_group_key: groupKey });
  if (error) {
    const { data: d2, error: e2 } = await db.rpc("exp_generate_group_territories", {
      group_key: groupKey,
    });
    if (e2) throw error;
    return d2 as unknown;
  }
  return data as unknown;
}

/** Onboard / reassign a seller into a slot; quota is written against the GROUP key. */
export async function assignGroupTerritory(input: {
  territoryId: string;
  groupKey: string;
  repId: string;
  quotaTarget?: number | null;
}) {
  const { error } = await db
    .from("exp_territories")
    .update({ seller_id: input.repId, status: "assigned" })
    .eq("id", input.territoryId);
  if (error) throw error;

  if (input.quotaTarget != null && Number.isFinite(input.quotaTarget)) {
    const period_start = currentPeriodStart();
    const { data: existing } = await db
      .from("exp_sales_quotas")
      .select("id")
      .eq("rep_id", input.repId)
      .eq("group_key", input.groupKey)
      .eq("period_start", period_start)
      .maybeSingle();
    if (existing?.id) {
      const { error: e2 } = await db
        .from("exp_sales_quotas")
        .update({ target: input.quotaTarget })
        .eq("id", existing.id);
      if (e2) throw e2;
    } else {
      const { error: e3 } = await db.from("exp_sales_quotas").insert({
        rep_id: input.repId,
        group_key: input.groupKey,
        period_type: "month",
        period_start,
        target: input.quotaTarget,
        actual: 0,
      });
      if (e3) throw e3;
    }
  }
}
