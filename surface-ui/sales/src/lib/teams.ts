import { api } from "@v3/ui/lib/server-fn";
import { TIER_LABEL, type TerritorySlot } from "@v3/ui/lib/territories";
import { loadCategoryGroups, loadGroupMembers, type CategoryGroup } from "@v3/sales/lib/category-groups";

/* ────────────────────────────────────────────────────────────
   Territory Management ("Teams") data layer.
   Everything is read live from the territory tables — real-only.
   FastAPI: surface-api/sales/routers/teams_data.py (runs as the signed-in user). One request
   per former supabase-js call, in the same order; the joins stay here.
   ──────────────────────────────────────────────────────────── */

const T = "/sales/teams";
type Territory = TerritorySlot & { group_key: string | null };
type Counts = Record<string, number | null>;

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
  const data = await api.get<Rep[]>(`${T}/reps`);
  return data ?? [];
}

/** The promos page's rep names (id, name; no order). */
export async function loadRepNames(): Promise<{ id: string; name: string }[]> {
  return (await api.get<{ id: string; name: string }[]>(`${T}/rep-names`)) ?? [];
}

async function brandsForTerritories(territoryIds: string[]): Promise<BrandRow[]> {
  if (!territoryIds.length) return [];
  // The links (threw), their organizations, one office count per distinct org and one
  // professional count per link (errors ignored: null counts).
  const res = await api.post<{
    links: { id: string; territory_id: string; lane: string | null; org_id: string }[];
    orgs: any[];
    offices: (number | null)[];
    profiles: (number | null)[];
  }>(`${T}/brands`, { territory_ids: territoryIds });
  const links = res.links ?? [];
  if (!links.length) return [];
  const orgIds = [...new Set(links.map((l) => l.org_id))];
  const byId = new Map(((res.orgs ?? []) as any[]).map((o) => [o.id as string, o]));

  // Office + profile volume per brand, counted from the stamped rows.
  const officeMap = new Map(orgIds.map((id, i) => [id, res.offices?.[i] ?? 0] as const));
  const profileMap = new Map(links.map((l, i) => [l.territory_id, res.profiles?.[i] ?? 0] as const));

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
    api.get<Territory[]>(`${T}/territories`),
    loadReps(),
  ]);
  const terrs = (terrsRes ?? []) as Territory[];
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
  const [groups, members, terrsRes, reps, quotasRes] = await Promise.all([
    loadCategoryGroups(),
    loadGroupMembers(groupKey),
    api.get<Territory[]>(`${T}/territories`, { params: { group_key: groupKey } }),
    loadReps(),
    // the current period (first of this UTC month) by the server's clock; errors ignored: []
    api.get<{ rep_id: string | null; target: number | null }[]>(`${T}/quotas`, {
      params: { group_key: groupKey },
    }),
  ]);
  const terrs = (terrsRes ?? []) as Territory[];
  const brands = await brandsForTerritories(terrs.map((t) => t.id));
  const quotas = (quotasRes ?? []) as { rep_id: string | null; target: number | null }[];

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
  const data = await api.get<Territory | null>(`${T}/territories/${encodeURIComponent(territoryId)}`);
  if (!data) return null;
  const row = data;
  const groupKey = row.group_key ?? "";
  const [groups, reps, brands, counts, siblingsRes] = await Promise.all([
    loadCategoryGroups(),
    loadReps(),
    brandsForTerritories([row.id]),
    // professionals, then offices (errors ignored: null)
    api.get<Counts>(`${T}/territories/${encodeURIComponent(row.id)}/counts`),
    // siblings: error ignored
    api.get<TerritorySlot[]>(`${T}/territories`, { params: { group_key: groupKey } }).catch(() => null),
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
    siblings: ((siblingsRes ?? []) as TerritorySlot[]).filter((t) => t.id !== row.id),
    profiles: counts.profiles ?? 0,
    offices: counts.offices ?? 0,
  };
}

/** All brand→territory links, for the move-brand control. */
export async function loadAllBrandLinks(): Promise<
  (BrandRow & { group_key: string | null; tier: string; territoryLabel: string })[]
> {
  const data = await api.get<Territory[]>(`${T}/territories/all`);
  const terrs = (data ?? []) as Territory[];
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
    // brands, offices, professionals (errors ignored: null counts)
    const c = await api.get<Counts>(`${T}/territories/${encodeURIComponent(id)}/counts`, {
      params: { brands: true },
    });
    await api.patch(`${T}/territories/${encodeURIComponent(id)}`, {
      brand_count: c.brands ?? 0,
      office_count: c.offices ?? 0,
      agent_count: c.profiles ?? 0,
    });
  }
}

/** Move a brand/logo from its current territory to another slot in the same tier lane. */
export async function moveBrandTerritory(input: {
  linkId: string;
  orgId: string;
  fromTerritoryId: string;
  toTerritoryId: string;
}) {
  const to = { territory_id: input.toTerritoryId };
  const org = encodeURIComponent(input.orgId);
  await api.patch(`${T}/brand-links/${encodeURIComponent(input.linkId)}`, to);

  // Re-stamp the brand itself, its offices and its professionals.
  await api.patch(`${T}/organizations/${org}/territory`, to);
  await api.patch(`${T}/organizations/${org}/offices/territory`, to);

  // At most 1000 office ids come back (the old limit(50000) was cut to 1000 by PostgREST), so
  // only those offices' professionals move: ported as it is, see docs/BROWSER_TO_API_FOLLOWUPS.md
  // 1j. Error ignored: [].
  const officeRows = await api
    .get<{ id: string }[]>(`${T}/organizations/${org}/offices`)
    .catch(() => null);
  const orgIds = [input.orgId, ...(officeRows ?? []).map((o) => o.id)];
  for (let i = 0; i < orgIds.length; i += 500) {
    const chunk = orgIds.slice(i, i + 500);
    await api.patch(`${T}/professionals/territory`, { org_ids: chunk, territory_id: input.toTerritoryId });
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
  await api.patch(`${T}/territories/${encodeURIComponent(input.territoryId)}`, {
    seller_id: input.repId,
    status: "assigned",
  });

  if (input.quotaTarget != null && Number.isFinite(input.quotaTarget)) {
    // The current period (first of this UTC month) by the server's clock, for both the lookup
    // and the insert. Error ignored: null.
    const existing = await api
      .get<{ id: string } | null>(`${T}/quotas/lookup`, {
        params: { rep_id: input.repId, group_key: input.groupKey },
      })
      .catch(() => null);
    if (existing?.id) {
      await api.patch(`${T}/quotas/${encodeURIComponent(existing.id)}`, { target: input.quotaTarget });
    } else {
      // period_type "month", period_start and actual 0 are set by the server
      await api.post(`${T}/quotas`, {
        rep_id: input.repId,
        group_key: input.groupKey,
        target: input.quotaTarget,
      });
    }
  }
}

export async function unassignSeller(territoryId: string) {
  await api.patch(`${T}/territories/${encodeURIComponent(territoryId)}`, {
    seller_id: null,
    status: "unassigned",
  });
}
