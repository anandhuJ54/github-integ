import { api } from "@v3/state/api/server-fn";
import {
  approveProposal,
  loadProposals,
  packLogos,
  type LogoProfiles,
  type TerritoryProposal,
} from "@v3/sales/utils/territories";

// Territory & team admin ("run it" controls). Sizing reads real profile counts only.
// FastAPI: surface-api/sales/routers/territories_data.py and category_groups_data.py (signed-in user).
const T = "/sales/territories";
const G = "/sales/category-groups";
const enc = encodeURIComponent;

export const PROFILES_PER_TERRITORY = 700_000;
export const HYDRATION_GATE_PCT = 90;
export const LANE_ROLES = ["SRE", "SMB", "MM", "ENT"] as const;
export type LaneRole = (typeof LANE_ROLES)[number];

export type GroupOption = { group_key: string; label: string };

export async function loadAdminGroups(): Promise<GroupOption[]> {
  const data = await api.get<any[]>(`${G}/admin`);
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
  const data = await api.get<any[]>(`${T}/group-profiles`, { params: { group_key: groupKey } });
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
  // The member gcids, then (only when there is one) the exact staging counts: all, and deep-hydrated (count errors → null).
  const { members, total, deep } = await api.get<{ members: { gcid: string }[]; total: number | null; deep: number | null }>(
    `${G}/${enc(groupKey)}/hydration`,
  );
  const gcids = ((members ?? []) as any[]).map((m) => m.gcid as string);
  if (!gcids.length) return { total: 0, deep: 0, pct: null };
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
  const m = await api.get<{ gcid: string }[]>(`${T}/group-gcid`, { params: { group_key: groupKey } }).catch(() => []);
  const gcid = ((m ?? []) as any[])[0]?.gcid ?? null;
  // created_by: the signed-in user, from the token (server-side).
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
    }))
    .filter((r) => !pending.some((p) => p.proposed_label === r.proposed_label));
  if (!rows.length) return 0;
  await api.post(`${T}/proposals`, { rows });
  return rows.length;
}

export async function loadNoraRep(): Promise<{ id: string; name: string } | null> {
  const data = await api.get<{ id: string; name: string }[]>(`${T}/reps/nora`).catch(() => []);
  return ((data ?? []) as any[])[0] ?? null;
}

/** Approve a proposal (existing approveProposal) and seat NORA as the default seller. */
export async function approveWithNora(p: TerritoryProposal): Promise<string> {
  const territoryId = await approveProposal(p);
  const nora = await loadNoraRep();
  if (!nora) throw new Error("Territory created, but no NORA rep exists to seat as default seller");
  const role = (LANE_ROLES as readonly string[]).includes(p.proposed_tier ?? "") ? (p.proposed_tier as LaneRole) : "SMB";
  await api.post(`${T}/seats`, {
    rows: [{ territory_id: territoryId, rep_id: nora.id, group_key: p.group_key, lane_role: role, is_nora_default: true }],
    ignore_duplicates: true,
  });
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
  const data = await api.get<Seat[]>(`${T}/seats`, { params: { group_key: groupKey } });
  return (data ?? []) as Seat[];
}

/** Add a seller seat. Many territories per rep and many reps per territory are both allowed. */
export async function addSeat(input: { territoryIds: string[]; repId: string; groupKey: string; role: LaneRole; quota: number | null }) {
  if (!input.territoryIds.length) throw new Error("Pick at least one territory");
  await api.post(`${T}/seats`, {
    rows: input.territoryIds.map((t) => ({ territory_id: t, rep_id: input.repId, group_key: input.groupKey, lane_role: input.role, monthly_quota: input.quota })),
  });
}

export async function updateSeatQuota(seatId: string, quota: number | null) {
  await api.patch(`${T}/seats/${enc(seatId)}`, { monthly_quota: quota });
}

export async function removeSeat(seatId: string) {
  await api.delete(`${T}/seats/${enc(seatId)}`);
}

export type RampRow = { territory_id: string; rep_id: string | null; month_offset: number; ramp_pct: number };

export async function loadRamps(territoryIds: string[]): Promise<RampRow[]> {
  if (!territoryIds.length) return [];
  const data = await api.post<RampRow[]>(`${T}/ramps/search`, { territory_ids: territoryIds });
  return (data ?? []) as RampRow[];
}

/** Replace the ramp curve for ONE seller on ONE territory (other sellers' ramps untouched). */
export async function saveSeatRamp(input: { territoryId: string; repId: string; pcts: number[] }) {
  await api.delete(`${T}/slots/${enc(input.territoryId)}/ramps?rep_id=${enc(input.repId)}`);
  if (!input.pcts.length) return;
  await api.post(`${T}/slots/${enc(input.territoryId)}/ramps`, {
    rows: input.pcts.map((p, i) => ({ rep_id: input.repId, month_offset: i, ramp_pct: Math.max(0, Math.min(100, p)) })),
  });
}
