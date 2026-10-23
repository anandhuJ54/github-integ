import { supabase } from "@/integrations/supabase/client";
import { currentPeriodStart, TIER_LABEL, type TerritorySlot } from "@/lib/territories";
import { loadCategoryGroups, loadGroupMembers, type CategoryGroup } from "@/lib/category-groups";

/* ────────────────────────────────────────────────────────────
   Territory Management ("Teams") data layer.
   Everything is read live from the territory tables — real-only.
   ──────────────────────────────────────────────────────────── */

const db = supabase as unknown as { from: (t: string) => any; rpc: (fn: string, a?: any) => any };

export const TIERS = ["ENT", "MM", "SMB", "SRE"] as const;
export type Tier = (typeof TIERS)[number];
export { TIER_LABEL };

export type Rep = {
  id: string;
  name: string;
  role: string;
  group_key: string | null;
  on_duty: boolean | null;
  is_demo: boolean | null;
  photo_url: string | null;
};

export type BrandRow = {
  id: string;
  territory_id: string;
  lane: string | null;
  org_id: string;
  name: string;
  slug: string | null;
  account_tier: string | null;
  is_demo: boolean | null;
  logo_url: string | null;
  offices: number;
  profiles: number;
};

export type TeamRow = TerritorySlot & {
  group_key: string | null;
  sellerName: string | null;
  sellerRole: string | null;
  sellerPhoto: string | null;
  sellerIsDemo: boolean | null;
  onDuty: boolean | null;
  brands: BrandRow[];
  quotaTarget: number;
};


export type TeamsSummary = {
  groups: {
    group: CategoryGroup;
    members: number;
    territories: number;
    assigned: number;
    brands: number;
    offices: number;
    agents: number;
    sellers: { id: string; name: string; photoUrl: string | null }[];
    brandLogos: { id: string; name: string; logoUrl: string | null }[];
    isDemo: boolean;
  }[];

  activeCategories: number;
  sellersAssigned: number;
  logosAssigned: number;
  profilesAssigned: number;
  territories: number;
  openSlots: number;
};

/* ─────────── Reads ─────────── */

export async function loadReps(): Promise<Rep[]> {
  const { data, error } = await db
    .from("exp_sales_reps")
    .select("id,name,role,group_key,on_duty,is_demo,photo_url")
    .order("name");
  if (error) throw error;
  return (data ?? []) as Rep[];

}

async function brandsForTerritories(territoryIds: string[]): Promise<BrandRow[]> {
  if (!territoryIds.length) return [];
  const { data, error } = await db
    .from("exp_territory_brand")
    .select("id,territory_id,lane,org_id")
    .in("territory_id", territoryIds)
    .is("success_handoff_at", null);
  if (error) throw error;
  const links = (data ?? []) as { id: string; territory_id: string; lane: string | null; org_id: string }[];
  if (!links.length) return [];
  const orgIds = [...new Set(links.map((l) => l.org_id))];
  const { data: orgs } = await db
    .from("organizations")
    .select("id,name,slug,account_tier,is_demo,logo_url")
    .in("id", orgIds);
  const byId = new Map(((orgs ?? []) as any[]).map((o) => [o.id as string, o]));

  // Office + profile volume per brand, counted from the stamped rows.
  const offices = await Promise.all(
    orgIds.map(async (id) => {
      const { count } = await db
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("parent_org_id", id);
      return [id, count ?? 0] as const;
    }),
  );
  const officeMap = new Map(offices);
  const profiles = await Promise.all(
    links.map(async (l) => {
      const { count } = await db
        .from("professionals")
        .select("id", { count: "exact", head: true })
        .eq("territory_id", l.territory_id);
      return [l.territory_id, count ?? 0] as const;
    }),
  );
  const profileMap = new Map(profiles);

  return links.map((l) => {
    const o = byId.get(l.org_id);
    return {
      id: l.id,
      territory_id: l.territory_id,
      lane: l.lane,
      org_id: l.org_id,
      name: (o?.name as string) ?? l.org_id.slice(0, 8),
      slug: (o?.slug as string) ?? null,
      account_tier: (o?.account_tier as string) ?? null,
      is_demo: (o?.is_demo as boolean) ?? null,
      logo_url: (o?.logo_url as string) ?? null,

      offices: officeMap.get(l.org_id) ?? 0,
      profiles: profileMap.get(l.territory_id) ?? 0,
    };
  });
}

/** Header counters + the active-category list. */
export async function loadTeamsSummary(): Promise<TeamsSummary> {
  const [groups, members, terrsRes, reps] = await Promise.all([
    loadCategoryGroups(),
    loadGroupMembers(),
    db.from("exp_territories").select("*").order("tier").order("seq"),
    loadReps(),
  ]);
  if (terrsRes.error) throw terrsRes.error;
  const terrs = (terrsRes.data ?? []) as (TerritorySlot & { group_key: string | null })[];
  const brandLinks = await brandsForTerritories(terrs.map((t) => t.id));

  const rows = groups
    .map((group) => {
      const mine = terrs.filter((t) => t.group_key === group.group_key);
      const mineIds = new Set(mine.map((t) => t.id));
      const groupBrands = brandLinks.filter((b) => mineIds.has(b.territory_id));
      return {
        group,
        members: members.filter((m) => m.group_key === group.group_key).length,
        territories: mine.length,
        assigned: mine.filter((t) => t.seller_id).length,
        brands: mine.reduce((s, t) => s + Number(t.brand_count ?? 0), 0),
        offices: mine.reduce((s, t) => s + Number(t.office_count ?? 0), 0),
        agents: mine.reduce((s, t) => s + Number(t.agent_count ?? 0), 0),
        sellers: mine
          .map((t) => reps.find((r) => r.id === t.seller_id))
          .filter(Boolean)
          .map((r) => ({ id: r!.id, name: r!.name, photoUrl: r!.photo_url })),
        brandLogos: groupBrands.map((b) => ({ id: b.id, name: b.name, logoUrl: b.logo_url })),
        isDemo: groupBrands.length > 0 && groupBrands.every((b) => b.is_demo === true),
      };
    })
    .filter((r) => r.territories > 0)
    .sort((a, b) => {
      if (!!a.group.is_catchall !== !!b.group.is_catchall) return a.group.is_catchall ? 1 : -1;
      return a.group.label.localeCompare(b.group.label);
    });


  const sellers = new Set(terrs.filter((t) => t.seller_id).map((t) => t.seller_id as string));
  return {
    groups: rows,
    activeCategories: rows.length,
    sellersAssigned: sellers.size,
    logosAssigned: terrs.reduce((s, t) => s + Number(t.brand_count ?? 0), 0),
    profilesAssigned: terrs.reduce(
      (s, t) => s + Number(t.agent_count ?? 0) + Number(t.office_count ?? 0),
      0,
    ),
    territories: terrs.length,
    openSlots: terrs.filter((t) => !t.seller_id).length,
  };
}

/** Every team (territory) inside one category group, with seller + brands. */
export async function loadGroupTeams(groupKey: string): Promise<{
  group: CategoryGroup | null;
  members: { gcid: string; label: string }[];
  teams: TeamRow[];
}> {
  const period = currentPeriodStart();
  const [groups, members, terrsRes, reps, quotasRes] = await Promise.all([
    loadCategoryGroups(),
    loadGroupMembers(groupKey),
    db.from("exp_territories").select("*").eq("group_key", groupKey).order("tier").order("seq"),
    loadReps(),
    db
      .from("exp_sales_quotas")
      .select("rep_id,target,group_key,period_start")
      .eq("group_key", groupKey)
      .eq("period_start", period),
  ]);
  if (terrsRes.error) throw terrsRes.error;
  const terrs = (terrsRes.data ?? []) as (TerritorySlot & { group_key: string | null })[];
  const brands = await brandsForTerritories(terrs.map((t) => t.id));
  const quotas = (quotasRes.data ?? []) as { rep_id: string | null; target: number | null }[];

  const teams: TeamRow[] = terrs.map((t) => {
    const rep = reps.find((r) => r.id === t.seller_id);
    return {
      ...t,
      sellerName: rep?.name ?? null,
      sellerRole: rep?.role ?? null,
      sellerPhoto: rep?.photo_url ?? null,
      sellerIsDemo: rep?.is_demo ?? null,
      onDuty: rep?.on_duty ?? null,

      brands: brands.filter((b) => b.territory_id === t.id),
      quotaTarget: quotas
        .filter((q) => q.rep_id && q.rep_id === t.seller_id)
        .reduce((s, q) => s + Number(q.target ?? 0), 0),
    };
  });

  return {
    group: groups.find((g) => g.group_key === groupKey) ?? null,
    members: members.map((m) => ({ gcid: m.gcid, label: m.label })),
    teams,
  };
}

export type TeamDetail = {
  team: TeamRow;
  group: CategoryGroup | null;
  siblings: TerritorySlot[];
  profiles: number;
  offices: number;
};

/** One team (territory) designation + its metrics. */
export async function loadTeamDetail(territoryId: string): Promise<TeamDetail | null> {
  const { data, error } = await db.from("exp_territories").select("*").eq("id", territoryId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as TerritorySlot & { group_key: string | null };
  const groupKey = row.group_key ?? "";
  const [groups, reps, brands, proCount, officeCount, siblingsRes] = await Promise.all([
    loadCategoryGroups(),
    loadReps(),
    brandsForTerritories([row.id]),
    db.from("professionals").select("id", { count: "exact", head: true }).eq("territory_id", row.id),
    db
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("territory_id", row.id)
      .eq("entity_type", "office"),
    db.from("exp_territories").select("*").eq("group_key", groupKey).order("tier").order("seq"),
  ]);
  const rep = reps.find((r) => r.id === row.seller_id);
  return {
    team: {
      ...row,
      sellerName: rep?.name ?? null,
      sellerRole: rep?.role ?? null,
      sellerPhoto: rep?.photo_url ?? null,
      sellerIsDemo: rep?.is_demo ?? null,
      onDuty: rep?.on_duty ?? null,

      brands,
      quotaTarget: 0,
    },
    group: groups.find((g) => g.group_key === groupKey) ?? null,
    siblings: ((siblingsRes.data ?? []) as TerritorySlot[]).filter((t) => t.id !== row.id),
    profiles: proCount.count ?? 0,
    offices: officeCount.count ?? 0,
  };
}

/** All brand→territory links, for the move-brand control. */
export async function loadAllBrandLinks(): Promise<
  (BrandRow & { group_key: string | null; tier: string; territoryLabel: string })[]
> {
  const { data, error } = await db.from("exp_territories").select("*");
  if (error) throw error;
  const terrs = (data ?? []) as (TerritorySlot & { group_key: string | null })[];
  const brands = await brandsForTerritories(terrs.map((t) => t.id));
  return brands.map((b) => {
    const t = terrs.find((x) => x.id === b.territory_id);
    return {
      ...b,
      group_key: t?.group_key ?? null,
      tier: t?.tier ?? "—",
      territoryLabel: t?.label ?? "—",
    };
  });
}

/* ─────────── Writes ─────────── */

export async function recountTerritories(territoryIds: string[]) {
  for (const id of [...new Set(territoryIds)].filter(Boolean)) {
    const [{ count: brandCount }, { count: officeCount }, { count: agentCount }] = await Promise.all([
      db.from("exp_territory_brand").select("id", { count: "exact", head: true }).eq("territory_id", id),
      db
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("territory_id", id)
        .eq("entity_type", "office"),
      db.from("professionals").select("id", { count: "exact", head: true }).eq("territory_id", id),
    ]);
    const { error } = await db
      .from("exp_territories")
      .update({
        brand_count: brandCount ?? 0,
        office_count: officeCount ?? 0,
        agent_count: agentCount ?? 0,
      })
      .eq("id", id);
    if (error) throw error;
  }
}

/** Move a brand/logo from its current territory to another slot in the same tier lane. */
export async function moveBrandTerritory(input: {
  linkId: string;
  orgId: string;
  fromTerritoryId: string;
  toTerritoryId: string;
}) {
  const { error } = await db
    .from("exp_territory_brand")
    .update({ territory_id: input.toTerritoryId })
    .eq("id", input.linkId);
  if (error) throw error;

  // Re-stamp the brand itself, its offices and its professionals.
  const { error: e1 } = await db
    .from("organizations")
    .update({ territory_id: input.toTerritoryId })
    .eq("id", input.orgId);
  if (e1) throw e1;

  const { error: e2 } = await db
    .from("organizations")
    .update({ territory_id: input.toTerritoryId })
    .eq("parent_org_id", input.orgId);
  if (e2) throw e2;

  const { data: officeRows } = await db
    .from("organizations")
    .select("id")
    .eq("parent_org_id", input.orgId)
    .limit(50000);
  const orgIds = [input.orgId, ...((officeRows ?? []) as { id: string }[]).map((o) => o.id)];
  for (let i = 0; i < orgIds.length; i += 500) {
    const chunk = orgIds.slice(i, i + 500);
    const { error: e3 } = await db
      .from("professionals")
      .update({ territory_id: input.toTerritoryId })
      .in("primary_org_id", chunk);
    if (e3) throw e3;
  }

  await recountTerritories([input.fromTerritoryId, input.toTerritoryId]);
}

/** Assign a seller to an open slot; quota is written against the group_key. */
export async function assignSeller(input: {
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

export async function unassignSeller(territoryId: string) {
  const { error } = await db
    .from("exp_territories")
    .update({ seller_id: null, status: "unassigned" })
    .eq("id", territoryId);
  if (error) throw error;
}
