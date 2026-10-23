import { api } from "@v3/ui/lib/server-fn";
import type { Json } from "@v3/ui/integrations/supabase/types";
import { parseIndexingEnabled, SITE_INDEXING_KEY } from "@v3/ui/lib/index-floor";

/* ────────────────────────────────────────────────────────────
   Search — control plane for the public growth engine.
   Every number here is a live table read, through /search/console/*
   (surface-api/search/queries/console.py) as the signed-in user.
   Nothing is fabricated: an empty table surfaces as an empty array
   and the UI renders an honest "instrument to activate" state.
   ──────────────────────────────────────────────────────────── */

const C = "/search/console";
const ok = (p: Promise<unknown>) => p.then(() => true as const);

/* ───────────── Shared: friendly category labels ───────────── */

export type CategoryLabel = { gcid: string; display_name: string | null; slug: string | null };

export async function loadCategoryLabels(): Promise<Map<string, string>> {
  const list = await api.get<CategoryLabel[]>(`${C}/category-labels`);
  return new Map(list.map((c) => [c.gcid, c.display_name ?? c.slug ?? c.gcid]));
}

/** gcid → readable label, never invented: falls back to the raw gcid. */
export function catLabel(labels: Map<string, string>, gcid: string | null | undefined) {
  if (!gcid) return "—";
  return labels.get(gcid) ?? gcid;
}

/* ───────────── 1. Overview: page-view meter ───────────── */

export type RollupRow = {
  id: string;
  gcid: string | null;
  geo_type: string | null;
  geo_value: string | null;
  day: string | null;
  page_views: number | null;
  unique_visitors: number | null;
  claim_cta_views: number | null;
  claims: number | null;
  is_demo: boolean | null;
};

export type VolumeRow = {
  key: string;
  gcid: string | null;
  geo_value: string | null;
  page_views: number;
  unique_visitors: number;
  claim_cta_views: number;
  claims: number;
  /** claims / claim_cta_views — null when there is no CTA impression to divide by. */
  claim_rate: number | null;
};

const n = (v: number | null | undefined) => Number(v ?? 0);

export function claimRate(claims: number, ctaViews: number): number | null {
  return ctaViews > 0 ? claims / ctaViews : null;
}

export function rollupTotals(list: RollupRow[]) {
  const t = list.reduce(
    (a, r) => ({
      page_views: a.page_views + n(r.page_views),
      unique_visitors: a.unique_visitors + n(r.unique_visitors),
      claim_cta_views: a.claim_cta_views + n(r.claim_cta_views),
      claims: a.claims + n(r.claims),
    }),
    { page_views: 0, unique_visitors: 0, claim_cta_views: 0, claims: 0 },
  );
  return { ...t, claim_rate: claimRate(t.claims, t.claim_cta_views), days: list.length };
}

/** Group the rollup by category × geo, ranked by page views desc. */
export function volumeByCategoryGeo(list: RollupRow[]): VolumeRow[] {
  const map = new Map<string, VolumeRow>();
  for (const r of list) {
    const key = `${r.gcid ?? "—"}|${r.geo_value ?? "—"}`;
    const row =
      map.get(key) ??
      ({
        key,
        gcid: r.gcid,
        geo_value: r.geo_value,
        page_views: 0,
        unique_visitors: 0,
        claim_cta_views: 0,
        claims: 0,
        claim_rate: null,
      } satisfies VolumeRow);
    row.page_views += n(r.page_views);
    row.unique_visitors += n(r.unique_visitors);
    row.claim_cta_views += n(r.claim_cta_views);
    row.claims += n(r.claims);
    map.set(key, row);
  }
  const out = [...map.values()];
  for (const r of out) r.claim_rate = claimRate(r.claims, r.claim_cta_views);
  return out.sort((a, b) => b.page_views - a.page_views);
}

/** Total page views for one category across every day/geo in the rollup. */
export function viewsForCategory(list: RollupRow[], gcid: string | null) {
  if (!gcid) return 0;
  return list.filter((r) => r.gcid === gcid).reduce((a, r) => a + n(r.page_views), 0);
}

export async function loadSearchOverview() {
  const [list, labels] = await Promise.all([
    api.get<RollupRow[]>(`${C}/overview`),
    loadCategoryLabels(),
  ]);
  return { rollup: list, labels, totals: rollupTotals(list), volume: volumeByCategoryGeo(list) };
}

/* ───────────── 2. Indexing agent ───────────── */

export type IndexAgentRow = {
  id: string;
  gcid: string | null;
  active: boolean | null;
  phase: string | null;
  discovered: number | null;
  built: number | null;
  indexed: number | null;
  held_shallow: number | null;
  last_run_at: string | null;
  created_at: string | null;
};

export type IndexQueueRow = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  url: string | null;
  gcid: string | null;
  score: number | null;
  thoroughness_pct: number | null;
  state: string | null;
  method: string | null;
  submitted_at: string | null;
  created_at: string | null;
  /** Added by 0024_index_floor; absent until that migration is applied. */
  lastmod?: string | null;
  is_demo?: boolean | null;
  completeness_floor?: number | null;
};

/** Queue states in pipeline order (exp_index_sync / exp_index_submit_tick). */
export const QUEUE_STATES = ["held", "pending", "submitting", "submitted", "indexed"] as const;

export type QueueCoverage = { state: string; count: number | null }[];

export const AGENT_PHASES = ["idle", "building", "submitting"];

export type SitemapPartitionRow = {
  id: string;
  partition_key: string;
  min_score: number | null;
  max_score: number | null;
  changefreq: string | null;
  priority: number | null;
  url_count: number | null;
  last_built_at: string | null;
};

export type SubmissionLogRow = {
  id: string;
  url: string | null;
  gcid: string | null;
  method: string | null;
  event: string | null;
  http_status: number | null;
  submitted_at: string | null;
};

export type IndexConfigRow = { key: string; value: string | null; updated_at: string | null };

/** The credential keys the DB submission tick reads. */
export const INDEX_CONFIG_KEYS = [
  { key: "indexnow_key", label: "IndexNow key", hint: "Required for IndexNow submission." },
  { key: "indexnow_host", label: "IndexNow host", hint: "e.g. experiencesrp.lovable.app" },
  {
    key: "google_indexing_token",
    label: "Google Indexing token",
    hint: "OAuth access token for the Indexing API. Not used unless google_indexing_enabled = true: Google supports that API only for JobPosting / BroadcastEvent pages.",
  },
] as const;

export const HELD_PARTITION = "held-below-floor";

export async function loadIndexing() {
  // agents, queue (500), partitions, log (100), config and the per-state coverage counts
  const [ix, labels] = await Promise.all([
    api.get<{
      agents: IndexAgentRow[];
      queue: IndexQueueRow[];
      partitions: SitemapPartitionRow[];
      log: SubmissionLogRow[];
      config: IndexConfigRow[];
      coverage: QueueCoverage;
    }>(`${C}/indexing`),
    loadCategoryLabels(),
  ]);
  const agentRows = ix.agents;
  const queueRows = ix.queue;
  const coverage = ix.coverage;
  const totals = agentRows.reduce(
    (a, r) => ({
      discovered: a.discovered + n(r.discovered),
      built: a.built + n(r.built),
      indexed: a.indexed + n(r.indexed),
      held: a.held + n(r.held_shallow),
      active: a.active + (r.active ? 1 : 0),
    }),
    { discovered: 0, built: 0, indexed: 0, held: 0, active: 0 },
  );
  const allConfig = ix.config;
  const siteSwitch = allConfig.find((c) => c.key === SITE_INDEXING_KEY) ?? null;
  const configRows = allConfig.filter((c) =>
    INDEX_CONFIG_KEYS.some((k) => k.key === c.key),
  );
  return {
    agents: agentRows,
    queue: queueRows,
    partitions: ix.partitions,
    log: ix.log,
    config: new Map(configRows.map((c) => [c.key, c.value ?? ""])),
    labels,
    totals,
    coverage: coverage as QueueCoverage,
    /** Site-wide switch (exp_index_enabled()); a missing row reads as OFF. */
    siteIndexing: {
      enabled: parseIndexingEnabled(siteSwitch?.value),
      updatedAt: siteSwitch?.updated_at ?? null,
      seeded: siteSwitch !== null,
    },
  };
}

export const searchMutations = {
  setAgentActive: (id: string, active: boolean) =>
    ok(api.patch(`${C}/index-agents/${encodeURIComponent(id)}`, { active })),

  setIndexConfig: (key: string, value: string) => {
    // The site-wide switch is flipped only through setSiteIndexing (super admin); the API refuses it too.
    if (key === SITE_INDEXING_KEY) throw new Error("Use the site indexing switch (super admin)");
    return ok(api.put(`${C}/index-config/${encodeURIComponent(key)}`, { value }));
  },

  rebuildSitemap: () => api.post<Record<string, number | string>>(`${C}/sitemap/rebuild`),

  submitTick: (batch: number) => api.post<Record<string, unknown>>(`${C}/index/submit-tick`, { batch }),

  /** exp_index_sync: queue score / completeness / state from search_documents + v5 scores. */
  syncQueue: () => api.post<Record<string, unknown>>(`${C}/index/sync`),

  /* Sponsored rate card */
  updatePricing: (
    id: string,
    patch: Partial<Pick<SponsoredPricingRow, "tier" | "spots" | "pricing_mode" | "monthly_price" | "floor_price" | "price_per_1k_views" | "notes">>,
  ) => ok(api.patch(`${C}/sponsored-pricing/${encodeURIComponent(id)}`, patch)),

  /* Sponsored slots */
  assignSlot: (
    id: string,
    patch: {
      advertiser_name: string;
      price: number | null;
      status: string;
      lock?: boolean;
      pricing_mode?: string | null;
      per_1k?: number | null;
    },
  ) => ok(api.post(`${C}/sponsored-slots/${encodeURIComponent(id)}/assign`, patch)),
  lockSlotRate: (id: string, price: number | null, per1k: number | null) =>
    ok(api.post(`${C}/sponsored-slots/${encodeURIComponent(id)}/lock`, { price, per1k })),
  releaseSlot: (id: string) => ok(api.post(`${C}/sponsored-slots/${encodeURIComponent(id)}/release`)),
  createSlot: (v: { gcid: string; geo_value: string; position: number }) =>
    ok(api.post(`${C}/sponsored-slots`, v)),

  /* Ads platform */
  createAd: (v: {
    name: string;
    placement: string;
    context: string;
    target_gcid: string | null;
    target_geo: string | null;
    budget: number | null;
    starts_on: string | null;
    ends_on: string | null;
  }) => ok(api.post(`${C}/ads`, v)),
  updateAd: (id: string, patch: Partial<SearchAdRow>) =>
    ok(api.patch(`${C}/ads/${encodeURIComponent(id)}`, patch)),
  deleteAd: (id: string) => ok(api.delete(`${C}/ads/${encodeURIComponent(id)}`)),
};

/* ───────────── 3. Sponsored search ───────────── */

/** Hard product cap: three sponsored positions per category per zip. */
export const SLOT_CAP = 3;

export type SponsoredPricingRow = {
  id: string;
  gcid: string | null;
  geo_type: string | null;
  tier: string | null;
  spots: number | null;
  basis: string | null;
  monthly_price: number | null;
  floor_price: number | null;
  notes: string | null;
  pricing_mode: string | null;
  price_per_1k_views: number | null;
  effective_on: string | null;
  version: number | null;
  is_demo: boolean | null;
};

export type SponsoredSlotRow = {
  id: string;
  gcid: string | null;
  geo_type: string | null;
  geo_value: string | null;
  position: number | null;
  advertiser_org_id: string | null;
  advertiser_name: string | null;
  status: string | null;
  price: number | null;
  pricing_mode: string | null;
  locked_price: number | null;
  locked_per_1k: number | null;
  locked_at: string | null;
  starts_on: string | null;
  ends_on: string | null;
  is_demo: boolean | null;
};

export type SlotGroup = {
  key: string;
  gcid: string | null;
  geo_value: string | null;
  positions: (SponsoredSlotRow | null)[];
  sold: number;
  revenue: number;
  locked: number;
};

export function groupSlots(list: SponsoredSlotRow[]): SlotGroup[] {
  const map = new Map<string, SlotGroup>();
  for (const s of list) {
    const key = `${s.gcid ?? "—"}|${s.geo_value ?? "—"}`;
    const g =
      map.get(key) ??
      ({
        key,
        gcid: s.gcid,
        geo_value: s.geo_value,
        positions: Array.from({ length: SLOT_CAP }, () => null),
        sold: 0,
        revenue: 0,
        locked: 0,
      } satisfies SlotGroup);
    const idx = Math.min(Math.max((s.position ?? 1) - 1, 0), SLOT_CAP - 1);
    g.positions[idx] = s;
    map.set(key, g);
  }
  for (const g of map.values()) {
    const filled = g.positions.filter(
      (p): p is SponsoredSlotRow => !!p && !!p.advertiser_name && p.status !== "open",
    );
    g.sold = filled.length;
    g.revenue = filled.reduce((a, p) => a + n(p.locked_price ?? p.price), 0);
    g.locked = filled.filter((p) => p.locked_price != null).length;
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Volume price = (views / 1000) × price per 1k views. */
export function volumeCharge(views: number, pricePer1k: number | null | undefined) {
  if (pricePer1k == null) return null;
  return (views / 1000) * Number(pricePer1k);
}

export async function loadSponsored() {
  const [sp, labels] = await Promise.all([
    api.get<{ pricing: SponsoredPricingRow[]; slots: SponsoredSlotRow[]; rollup: RollupRow[] }>(
      `${C}/sponsored`,
    ),
    loadCategoryLabels(),
  ]);
  const pricingRows = sp.pricing;
  const slotRows = sp.slots;
  const rollupRows = sp.rollup;
  const groups = groupSlots(slotRows);
  return {
    pricing: pricingRows,
    slots: slotRows,
    groups,
    rollup: rollupRows,
    labels,
    stats: {
      rateCards: pricingRows.length,
      inventory: groups.length * SLOT_CAP,
      sold: groups.reduce((a, g) => a + g.sold, 0),
      locked: groups.reduce((a, g) => a + g.locked, 0),
      committed: groups.reduce((a, g) => a + g.revenue, 0),
    },
  };
}

/* ───────────── 4. Ads platform ───────────── */

export type SearchAdRow = {
  id: string;
  name: string | null;
  placement: string | null;
  context: string | null;
  target_gcid: string | null;
  target_geo: string | null;
  creative: Json | null;
  status: string | null;
  starts_on: string | null;
  ends_on: string | null;
  budget: number | null;
  spend: number | null;
  created_at: string | null;
};

/** Ad contexts we own. The unclaimed-profile unit is the claim conversion unit. */
export const AD_CONTEXTS = ["unclaimed_profile", "serp", "claimed_profile", "category_page", "external"];
export const CLAIM_CONVERSION_CONTEXT = "unclaimed_profile";
export const AD_PLACEMENTS = ["in_app", "nora", "event", "external"];

export function isClaimConversionUnit(ad: SearchAdRow) {
  return (ad.context ?? "") === CLAIM_CONVERSION_CONTEXT;
}

export async function loadSearchAds() {
  const [list, labels] = await Promise.all([
    api.get<SearchAdRow[]>(`${C}/ads`),
    loadCategoryLabels(),
  ]);
  return {
    ads: list,
    labels,
    stats: {
      total: list.length,
      live: list.filter((a) => a.status === "live").length,
      claimUnits: list.filter(isClaimConversionUnit).length,
      budget: list.reduce((a, r) => a + n(r.budget), 0),
      spend: list.reduce((a, r) => a + n(r.spend), 0),
    },
  };
}

/* ───────────── Category pickers ───────────── */

export type CategoryOption = { gcid: string; label: string };

/** Launched categories only — the ones the growth engine actually publishes. */
export async function loadLaunchedCategories(): Promise<CategoryOption[]> {
  const list = await api.get<CategoryLabel[]>(`${C}/launched-categories`);
  return list.map((c) => ({
    gcid: c.gcid,
    label: c.display_name ?? c.slug ?? c.gcid,
  }));
}
