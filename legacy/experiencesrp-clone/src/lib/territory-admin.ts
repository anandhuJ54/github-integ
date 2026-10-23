import { supabase } from "@/integrations/supabase/client";
import {
  approveProposal,
  loadProposals,
  packLogos,
  type LogoProfiles,
  type TerritoryProposal,
} from "@/lib/territories";

// Territory & team admin ("run it" controls). Sizing reads real profile counts only.
const db = supabase as unknown as { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any; auth: typeof supabase.auth };

export const PROFILES_PER_TERRITORY = 700_000;
export const HYDRATION_GATE_PCT = 90;
export const LANE_ROLES = ["SRE", "SMB", "MM", "ENT"] as const;
export type LaneRole = (typeof LANE_ROLES)[number];

export type GroupOption = { group_key: string; label: string };

export async function loadAdminGroups(): Promise<GroupOption[]> {
  const { data, error } = await db.from("exp_category_groups").select("group_key,label,is_catchall").order("label");
  if (error) throw error;
  return ((data ?? []) as any[]).filter((g) => !g.is_catchall).map((g) => ({ group_key: g.group_key, label: g.label ?? g.group_key }));
}

export type CategorySizing = {
  logos: LogoProfiles[];
  locations: number;
  professionals: number;
  total: number;
  territoryCount: number;
  bins: { total: number; logos: LogoProfiles[] }[];
  hasProxy: boolean;
};

/** Real profile totals (locations + professionals) and the whole-logo FFD split at 700K per territory. */
export async function loadCategorySizing(groupKey: string): Promise<CategorySizing> {
  // Scoped RPC: the all-groups exp_territory_logo_profiles() exceeds the API time limit.
  const { data, error } = await db.rpc("exp_territory_group_profiles", { p_group_key: groupKey });
  if (error) throw new Error(error.message);
  const logos: LogoProfiles[] = ((data ?? []) as any[]).map((r) => ({
    group_key: r.group_key, logo_id: r.logo_id, logo_name: r.logo_name ?? "Unnamed logo",
    locations: Number(r.locations ?? 0), professionals: Number(r.professionals ?? 0),
    profile_count: Number(r.locations ?? 0) + Number(r.professionals ?? 0),
  }));
  const locations = logos.reduce((s, l) => s + l.locations, 0);
  const professionals = logos.reduce((s, l) => s + l.professionals, 0);
  const total = locations + professionals;
  const territoryCount = total > 0 ? Math.ceil(total / PROFILES_PER_TERRITORY) : 0;
  return {
    logos,
    locations,
    professionals,
    total,
    territoryCount,
    bins: territoryCount ? packLogos(logos, territoryCount) : [],
    hasProxy: logos.some((l) => l.proxy),
  };
}

export type Hydration = { total: number; deep: number; pct: number | null };

/** Hydration = deep-hydrated staging rows / all staging rows for the group's member categories. */
export async function loadHydration(groupKey: string): Promise<Hydration> {
  const { data: members, error } = await db.from("exp_category_group_members").select("gcid").eq("group_key", groupKey);
  if (error) throw error;
  const gcids = ((members ?? []) as any[]).map((m) => m.gcid as string);
  if (!gcids.length) return { total: 0, deep: 0, pct: null };
  const head = () => db.from("exp_etl_staging").select("stage_id", { count: "exact", head: true }).in("gcid", gcids);
  const [{ count: total }, { count: deep }] = await Promise.all([head(), head().eq("payload->>field_tier", "deep")]);
  const t = total ?? 0;
  return { total: t, deep: deep ?? 0, pct: t ? ((deep ?? 0) / t) * 100 : null };
}

function tierFor(total: number): LaneRole {
  if (total >= 0.8 * PROFILES_PER_TERRITORY) return "ENT";
  if (total >= 0.35 * PROFILES_PER_TERRITORY) return "MM";
  return "SMB";
}

/** Writes pending proposals for ONE group only. Never applies. */
export async function proposeCategorySplit(groupKey: string, label: string): Promise<number> {
  const sizing = await loadCategorySizing(groupKey);
  if (!sizing.territoryCount) return 0;
  const pending = (await loadProposals("pending")).filter((p) => p.group_key === groupKey);
  const { data: m } = await db.from("exp_category_group_members").select("gcid").eq("group_key", groupKey).order("gcid").limit(1);
  const gcid = ((m ?? []) as any[])[0]?.gcid ?? null;
  const { data: u } = await db.auth.getUser();
  const rows = sizing.bins
    .map((b, i) => ({
      group_key: groupKey,
      gcid,
      lane: "seller",
      proposed_label: `${label} ${i + 1}`,
      proposed_tier: tierFor(b.total),
      proposed_geo: "national",
      rationale: `${b.logos.length} whole logos = ${b.total.toLocaleString("en-US")} profiles (group total ${sizing.total.toLocaleString("en-US")} → ${sizing.territoryCount} territories at ${PROFILES_PER_TERRITORY.toLocaleString("en-US")}).`,
      payload: {
        action: "create",
        kind: "split",
        sizing: "ceil_total_700k",
        member_groups: [groupKey],
        logos: b.logos.map((l) => ({ logo_id: l.logo_id, name: l.logo_name, locations: l.locations, professionals: l.professionals, profile_count: l.profile_count, proxy: !!l.proxy })),
        total: b.total,
        tier: tierFor(b.total),
        geo_scope: "national",
        region: null,
      },
      state: "pending",
      created_by: u.user?.id ?? null,
    }))
    .filter((r) => !pending.some((p) => p.proposed_label === r.proposed_label));
  if (!rows.length) return 0;
  const { error } = await db.from("exp_territory_proposals").insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function loadNoraRep(): Promise<{ id: string; name: string } | null> {
  const { data } = await db.from("exp_sales_reps").select("id,name").ilike("role", "nora").limit(1);
  return ((data ?? []) as any[])[0] ?? null;
}

/** Approve a proposal (existing approveProposal) and seat NORA as the default seller. */
export async function approveWithNora(p: TerritoryProposal): Promise<string> {
  const territoryId = await approveProposal(p);
  const nora = await loadNoraRep();
  if (!nora) throw new Error("Territory created, but no NORA rep exists to seat as default seller");
  const role = (LANE_ROLES as readonly string[]).includes(p.proposed_tier ?? "") ? (p.proposed_tier as LaneRole) : "SMB";
  const { error } = await db
    .from("exp_territory_seats")
    .upsert({ territory_id: territoryId, rep_id: nora.id, group_key: p.group_key, lane_role: role, is_nora_default: true }, { onConflict: "territory_id,rep_id,lane_role", ignoreDuplicates: true });
  if (error) throw error;
  return territoryId;
}

export type Seat = {
  id: string;
  territory_id: string;
  rep_id: string;
  group_key: string | null;
  lane_role: LaneRole;
  is_nora_default: boolean;
  monthly_quota: number | null;
};

export async function loadSeats(groupKey: string): Promise<Seat[]> {
  const { data, error } = await db.from("exp_territory_seats").select("*").eq("group_key", groupKey).order("created_at");
  if (error) throw error;
  return (data ?? []) as Seat[];
}

/** Add a seller seat. Many territories per rep and many reps per territory are both allowed. */
export async function addSeat(input: { territoryIds: string[]; repId: string; groupKey: string; role: LaneRole; quota: number | null }) {
  if (!input.territoryIds.length) throw new Error("Pick at least one territory");
  const { error } = await db.from("exp_territory_seats").upsert(
    input.territoryIds.map((t) => ({ territory_id: t, rep_id: input.repId, group_key: input.groupKey, lane_role: input.role, monthly_quota: input.quota })),
    { onConflict: "territory_id,rep_id,lane_role" },
  );
  if (error) throw error;
}

export async function updateSeatQuota(seatId: string, quota: number | null) {
  const { error } = await db.from("exp_territory_seats").update({ monthly_quota: quota }).eq("id", seatId);
  if (error) throw error;
}

export async function removeSeat(seatId: string) {
  const { error } = await db.from("exp_territory_seats").delete().eq("id", seatId);
  if (error) throw error;
}

export type RampRow = { territory_id: string; rep_id: string | null; month_offset: number; ramp_pct: number };

export async function loadRamps(territoryIds: string[]): Promise<RampRow[]> {
  if (!territoryIds.length) return [];
  const { data, error } = await db.from("exp_territory_ramps").select("territory_id,rep_id,month_offset,ramp_pct").in("territory_id", territoryIds).order("month_offset");
  if (error) throw error;
  return (data ?? []) as RampRow[];
}

/** Replace the ramp curve for ONE seller on ONE territory (other sellers' ramps untouched). */
export async function saveSeatRamp(input: { territoryId: string; repId: string; pcts: number[] }) {
  const { error: dErr } = await db.from("exp_territory_ramps").delete().eq("territory_id", input.territoryId).eq("rep_id", input.repId);
  if (dErr) throw dErr;
  if (!input.pcts.length) return;
  const { error } = await db.from("exp_territory_ramps").insert(
    input.pcts.map((p, i) => ({ territory_id: input.territoryId, rep_id: input.repId, month_offset: i, ramp_pct: Math.max(0, Math.min(100, p)) })),
  );
  if (error) throw error;
}
