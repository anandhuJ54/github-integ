import { supabase } from "@v3/state/auth/adapters/supabase/client";
import { api } from "@v3/state/api/server-fn";
import { loadCategoryGroups, type CategoryGroup } from "@v3/sales/utils/category-groups";
import { moveBrandTerritory, recountTerritories } from "@v3/sales/utils/teams";

/* ────────────────────────────────────────────────────────────
   Seller Setup — the single admin form behind "Add seller" and
   "Edit user". Every field maps to a real column/table:
     exp_sales_reps           identity, employment, role, team,
                              attribution_target, sdrcloud_url
     exp_sales_rep_verticals  additional verticals
     exp_territories          territory assignment (seller_id)
     exp_territory_brand      logo (brand) assignments
     exp_sales_quotas         quarterly target/actual per year
   FastAPI: surface-api/sales/routers/seller_setup_data.py (runs as the
   signed-in user); the territory writes reuse /sales/teams. The photo
   upload stays on Supabase Storage.
   ──────────────────────────────────────────────────────────── */

const S = "/sales/seller-setup";
const T = "/sales/teams";
const enc = encodeURIComponent;

export const SELLER_ROLE_OPTIONS = [
  { value: "SRE", label: "SRE — Search Rank Expert (individuals)" },
  { value: "SMB", label: "SMB — Small Business" },
  { value: "MM", label: "MM — Mid-Market" },
  { value: "ENT", label: "ENT — Enterprise" },
] as const;

export const PHOTO_BUCKET = "seller-photos";
/** Bucket is private (workspace blocks public buckets) so we store a long-lived signed link. */
const SIGNED_URL_TTL = 60 * 60 * 24 * 365 * 20;

export type SellerRepRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  role: string;
  group_key: string;
  team_name: string | null;
  photo_url: string | null;
  hire_date: string | null;
  on_duty: boolean | null;
  backup_rep_id: string | null;
  sdrcloud_url: string | null;
  attribution_target: number | null;
  is_demo: boolean | null;
};

export type SetupTerritory = {
  id: string;
  label: string;
  tier: string | null;
  group_key: string | null;
  seller_id: string | null;
  status: string | null;
  brand_count: number | null;
  agent_count: number | null;
};

export type SetupBrandLink = {
  linkId: string;
  orgId: string;
  name: string;
  logoUrl: string | null;
  lane: string | null;
  territoryId: string;
  territoryLabel: string;
  tier: string | null;
};

export type SetupQuota = {
  id: string;
  period_start: string;
  target: number;
  actual: number;
};

export type SellerSetup = {
  rep: SellerRepRow | null;
  verticals: { id: string; group_key: string }[];
  groups: CategoryGroup[];
  reps: { id: string; name: string }[];
  teamNames: string[];
  territories: SetupTerritory[];
  brandLinks: SetupBrandLink[];
  quotas: SetupQuota[];
};

export function quarterStarts(year: number): string[] {
  return ["01", "04", "07", "10"].map((m) => `${year}-${m}-01`);
}

export function quarterLabel(i: number) {
  return `Q${i + 1}`;
}

/* ─────────── Reads ─────────── */

export async function loadSellerSetup(
  repId: string | null,
  year: number,
): Promise<SellerSetup> {
  // Every read here ignored its error; the API answers []/null for a failed one. Rounds as
  // before: reps + territories, then the rep's rows (with a rep id), then the links and their orgs.
  const [groups, res] = await Promise.all([
    loadCategoryGroups(),
    api.get<{
      reps: { id: string; name: string; team_name: string | null }[];
      territories: SetupTerritory[];
      rep: SellerRepRow | null;
      verticals: { id: string; group_key: string | null }[];
      quotas: any[];
      links: { id: string; territory_id: string; org_id: string; lane: string | null }[];
      orgs: { id: string; name: string; logo_url: string | null }[];
    }>(S, { params: { year, rep_id: repId || null } }),
  ]);

  const allReps = res.reps ?? [];
  const territories = res.territories ?? [];

  let rep: SellerRepRow | null = null;
  let verticals: { id: string; group_key: string }[] = [];
  let quotas: SetupQuota[] = [];

  if (repId) {
    rep = res.rep ?? null;
    verticals = (res.verticals ?? [])
      .filter((v) => !!v.group_key)
      .map((v) => ({ id: v.id, group_key: v.group_key as string }));
    quotas = (res.quotas ?? []).map((q) => ({
      id: q.id as string,
      period_start: String(q.period_start),
      target: Number(q.target ?? 0),
      actual: Number(q.actual ?? 0),
    }));
  }

  // Brand links for every territory (small table: one row per logo).
  const links = res.links ?? [];
  const orgs = res.orgs ?? [];
  const byOrg = new Map(orgs.map((o) => [o.id, o]));
  const byTerr = new Map(territories.map((t) => [t.id, t]));
  const brandLinks: SetupBrandLink[] = links.map((l) => ({
    linkId: l.id,
    orgId: l.org_id,
    name: byOrg.get(l.org_id)?.name ?? l.org_id.slice(0, 8),
    logoUrl: byOrg.get(l.org_id)?.logo_url ?? null,
    lane: l.lane,
    territoryId: l.territory_id,
    territoryLabel: byTerr.get(l.territory_id)?.label ?? "—",
    tier: byTerr.get(l.territory_id)?.tier ?? null,
  }));

  return {
    rep,
    verticals,
    groups,
    reps: allReps.filter((r) => r.id !== repId).map((r) => ({ id: r.id, name: r.name })),
    teamNames: [...new Set(allReps.map((r) => r.team_name).filter(Boolean) as string[])].sort(),
    territories,
    brandLinks,
    quotas,
  };
}

/* ─────────── Photo upload ─────────── */

export async function uploadSellerPhoto(file: File, repId: string | null): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
  const path = `${repId ?? "new"}/${Date.now()}.${ext}`;
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (up.error) throw up.error;
  const signed = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (signed.error) throw signed.error;
  return signed.data.signedUrl;
}

/* ─────────── Save ─────────── */

export type SellerSetupInput = {
  repId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  photoUrl: string | null;
  hireDate: string | null;
  onDuty: boolean;
  backupRepId: string | null;
  role: string;
  primaryGroupKey: string;
  extraVerticals: string[];
  teamName: string | null;
  territoryId: string | null;
  /** brand link ids that should belong to this seller's territory */
  brandLinkIds: string[];
  year: number;
  quotas: { target: number; actual: number }[];
  attributionTarget: number | null;
  sdrcloudUrl: string | null;
};

export type SaveResult = {
  repId: string;
  changes: string[];
};

export async function saveSellerSetup(input: SellerSetupInput): Promise<SaveResult> {
  const changes: string[] = [];
  if (!input.name.trim()) throw new Error("Name is required");
  if (!input.role) throw new Error("Role is required");
  if (!input.primaryGroupKey) throw new Error("Primary vertical is required");

  const repPayload = {
    name: input.name.trim(),
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    title: input.title?.trim() || null,
    photo_url: input.photoUrl || null,
    hire_date: input.hireDate || null,
    on_duty: input.onDuty,
    backup_rep_id: input.backupRepId || null,
    role: input.role,
    group_key: input.primaryGroupKey,
    team_name: input.teamName?.trim() || null,
    attribution_target: input.attributionTarget,
    sdrcloud_url: input.sdrcloudUrl?.trim() || null,
  };

  let repId = input.repId;
  if (repId) {
    await api.patch(`${S}/reps/${enc(repId)}`, repPayload);
    changes.push("rep row updated");
  } else {
    const data = await api.post<{ id: string }>(`${S}/reps`, repPayload);
    repId = data.id;
    changes.push("rep row created");
  }

  /* verticals — primary is implicit, extras live in exp_sales_rep_verticals */
  const wanted = [...new Set([input.primaryGroupKey, ...input.extraVerticals])];
  const existingVerts = await api
    .get<{ id: string; group_key: string | null }[]>(`${S}/reps/${enc(repId)}/verticals`)
    .catch(() => null);
  const have = ((existingVerts ?? []) as { id: string; group_key: string | null }[]).filter(
    (v) => !!v.group_key,
  );
  const toAdd = wanted.filter((g) => !have.some((v) => v.group_key === g));
  const toDrop = have.filter((v) => !wanted.includes(v.group_key as string));
  if (toAdd.length) {
    await api.post(`${S}/reps/${enc(repId)}/verticals`, { group_keys: toAdd });
  }
  for (const v of toDrop) {
    await api.delete(`${S}/verticals/${enc(v.id)}`);
  }
  if (toAdd.length || toDrop.length)
    changes.push(`verticals +${toAdd.length}/-${toDrop.length}`);

  /* territory assignment */
  const currentTerrs = await api
    .get<{ id: string }[]>(`${S}/reps/${enc(repId)}/territories`)
    .catch(() => null);
  const currentIds = ((currentTerrs ?? []) as { id: string }[]).map((t) => t.id);
  const keep = input.territoryId;
  for (const id of currentIds.filter((t) => t !== keep)) {
    await api.patch(`${T}/territories/${enc(id)}`, { seller_id: null, status: "unassigned" });
    changes.push("territory unassigned");
  }
  if (keep && !currentIds.includes(keep)) {
    await api.patch(`${T}/territories/${enc(keep)}`, { seller_id: repId, status: "assigned" });
    changes.push("territory assigned");
  }

  /* logo assignments — links move into / out of this seller's slot */
  if (keep) {
    const linkRows = await api
      .get<{ id: string; territory_id: string; org_id: string; lane: string | null }[]>(`${S}/brand-links`)
      .catch(() => null);
    const links = (linkRows ?? []) as {
      id: string;
      territory_id: string;
      org_id: string;
      lane: string | null;
    }[];
    const mineNow = links.filter((l) => l.territory_id === keep);
    const wantedIds = new Set(input.brandLinkIds);

    // add
    for (const l of links.filter((l) => wantedIds.has(l.id) && l.territory_id !== keep)) {
      await moveBrandTerritory({
        linkId: l.id,
        orgId: l.org_id,
        fromTerritoryId: l.territory_id,
        toTerritoryId: keep,
      });
      changes.push(`logo moved in: ${l.org_id.slice(0, 8)}`);
    }
    // remove → park on an open slot in the same group + tier
    const removals = mineNow.filter((l) => !wantedIds.has(l.id));
    if (removals.length) {
      const slotRows = await api
        .get<any[]>(`${S}/slots`, { params: { group_key: input.primaryGroupKey, tier: input.role } })
        .catch(() => null);
      const park = ((slotRows ?? []) as any[]).find((s) => s.id !== keep && !s.seller_id);
      if (!park) {
        throw new Error(
          "No open slot in this lane to park the removed logos on. Generate a slot in Teams first, or keep them assigned.",
        );
      }
      for (const l of removals) {
        await moveBrandTerritory({
          linkId: l.id,
          orgId: l.org_id,
          fromTerritoryId: keep,
          toTerritoryId: park.id as string,
        });
        changes.push(`logo moved out: ${l.org_id.slice(0, 8)}`);
      }
    }
    if (input.brandLinkIds.length || removals.length) await recountTerritories([keep]);
  }

  /* quarterly quotas for the selected year */
  const starts = quarterStarts(input.year);
  const existingQ = await api
    .get<{ id: string; period_start: string }[]>(`${S}/reps/${enc(repId!)}/quota-ids`, {
      params: { year: input.year },
    })
    .catch(() => null);
  const qById = new Map(
    ((existingQ ?? []) as { id: string; period_start: string }[]).map((q) => [
      String(q.period_start),
      q.id,
    ]),
  );
  for (let i = 0; i < 4; i++) {
    const start = starts[i]!;
    const row = input.quotas[i] ?? { target: 0, actual: 0 };
    const id = qById.get(start);
    if (id) {
      await api.patch(`${S}/quotas/${enc(id)}`, { target: row.target, actual: row.actual });
    } else {
      // period_type "quarter" is set by the server
      await api.post(`${S}/quotas`, {
        rep_id: repId,
        group_key: input.primaryGroupKey,
        period_start: start,
        target: row.target,
        actual: row.actual,
      });
    }
  }
  changes.push(`${input.year} quarterly quotas written`);

  return { repId: repId!, changes };
}
