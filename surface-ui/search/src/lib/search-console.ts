import { supabase } from "@v3/ui/integrations/supabase/client";
import type { Json } from "@v3/ui/integrations/supabase/types";
import { parseIndexingEnabled, SITE_INDEXING_KEY } from "@v3/ui/lib/index-floor";

/* ────────────────────────────────────────────────────────────
   Search — control plane for the public growth engine.
   Every number here is a live table read. Nothing is fabricated:
   an empty table surfaces as an empty array and the UI renders
   an honest "instrument to activate" state.
   ──────────────────────────────────────────────────────────── */

const rows = <T,>(res: { data: unknown; error: { message: string } | null }) => {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T[];
};

async function run(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p;
  if (error) throw new Error(error.message);
  return true;
}

const db = supabase as unknown as { from: (table: string) => any };

/* ───────────── Shared: friendly category labels ───────────── */

export type CategoryLabel = { gcid: string; display_name: string | null; slug: string | null };

export async function loadCategoryLabels(): Promise<Map<string, string>> {
  const res = await supabase
    .from("gbp_categories")
    .select("gcid, display_name, slug")
    .order("display_name", { ascending: true });
  const list = rows<CategoryLabel>(res);
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
  const [res, labels] = await Promise.all([
    supabase
      .from("exp_page_views_rollup")
      .select("*")
      .order("day", { ascending: false })
      .limit(5000),
    loadCategoryLabels(),
  ]);
  const list = rows<RollupRow>(res);
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
  const coverageQuery = Promise.all(
    QUEUE_STATES.map(async (state) => {
      const { count } = await db
        .from("exp_index_queue")
        .select("id", { count: "exact", head: true })
        .eq("state", state);
      return { state, count: (count as number | null) ?? null };
    }),
  );
  const [agents, queue, partitions, log, config, labels, coverage] = await Promise.all([
    supabase.from("exp_index_agent").select("*").order("gcid", { ascending: true }),
    supabase
      .from("exp_index_queue")
      .select("*")
      .order("thoroughness_pct", { ascending: false })
      .limit(500),
    db.from("exp_sitemap_partition").select("*").order("min_score", { ascending: false }),
    db.from("exp_index_submission_log").select("*").order("submitted_at", { ascending: false }).limit(100),
    db.from("exp_index_config").select("key, value, updated_at"),
    loadCategoryLabels(),
    coverageQuery,
  ]);
  const agentRows = rows<IndexAgentRow>(agents);
  const queueRows = rows<IndexQueueRow>(queue);
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
  const allConfig = rows<IndexConfigRow>(config);
  const siteSwitch = allConfig.find((c) => c.key === SITE_INDEXING_KEY) ?? null;
  const configRows = allConfig.filter((c) =>
    INDEX_CONFIG_KEYS.some((k) => k.key === c.key),
  );
  return {
    agents: agentRows,
    queue: queueRows,
    partitions: rows<SitemapPartitionRow>(partitions),
    log: rows<SubmissionLogRow>(log),
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
    run(db.from("exp_index_agent").update({ active }).eq("id", id)),

  setIndexConfig: (key: string, value: string) => {
    // The site-wide switch is flipped only through setSiteIndexing (super admin).
    if (key === SITE_INDEXING_KEY) throw new Error("Use the site indexing switch (super admin)");
    return run(db.from("exp_index_config").upsert({ key, value, updated_at: new Date().toISOString() }));
  },

  rebuildSitemap: async () => {
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc("exp_sitemap_rebuild");
    if (error) throw new Error(error.message);
    return data as Record<string, number | string>;
  },

  submitTick: async (batch: number) => {
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc("exp_index_submit_tick", { p_batch: batch });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  },

  /** exp_index_sync: queue score / completeness / state from search_documents + v5 scores. */
  syncQueue: async () => {
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    }).rpc("exp_index_sync", {});
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  },


  /* Sponsored rate card */
  updatePricing: (
    id: string,
    patch: Partial<Pick<SponsoredPricingRow, "tier" | "spots" | "pricing_mode" | "monthly_price" | "floor_price" | "price_per_1k_views" | "notes">>,
  ) => run(db.from("exp_sponsored_pricing").update(patch).eq("id", id)),

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
  ) =>
    run(
      db
        .from("exp_sponsored_slots")
        .update({
          advertiser_name: patch.advertiser_name,
          price: patch.price,
          status: patch.status,
          pricing_mode: patch.pricing_mode ?? null,
          locked_price: patch.lock ? patch.price : null,
          locked_per_1k: patch.lock ? (patch.per_1k ?? null) : null,
          locked_at: patch.lock ? new Date().toISOString() : null,
        })
        .eq("id", id),
    ),
  lockSlotRate: (id: string, price: number | null, per1k: number | null) =>
    run(
      db
        .from("exp_sponsored_slots")
        .update({ locked_price: price, locked_per_1k: per1k, locked_at: new Date().toISOString() })
        .eq("id", id),
    ),
  releaseSlot: (id: string) =>
    run(
      db
        .from("exp_sponsored_slots")
        .update({
          advertiser_name: null,
          advertiser_org_id: null,
          price: null,
          status: "open",
          locked_price: null,
          locked_per_1k: null,
          locked_at: null,
        })
        .eq("id", id),
    ),
  createSlot: (v: { gcid: string; geo_value: string; position: number }) =>
    run(
      db.from("exp_sponsored_slots").insert({
        gcid: v.gcid,
        geo_type: "zip",
        geo_value: v.geo_value,
        position: v.position,
        status: "open",
        is_demo: true,
      }),
    ),

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
  }) =>
    run(
      db.from("exp_web_ads").insert({
        name: v.name,
        placement: v.placement,
        context: v.context,
        target_gcid: v.target_gcid,
        target_geo: v.target_geo,
        budget: v.budget,
        starts_on: v.starts_on || null,
        ends_on: v.ends_on || null,
        creative: {} as Json,
        status: "draft",
        spend: 0,
      }),
    ),
  updateAd: (id: string, patch: Partial<SearchAdRow>) =>
    run(db.from("exp_web_ads").update(patch).eq("id", id)),
  deleteAd: (id: string) => run(db.from("exp_web_ads").delete().eq("id", id)),
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
  const [pricing, slots, rollup, labels] = await Promise.all([
    supabase
      .from("exp_sponsored_pricing")
      .select("*")
      .order("monthly_price", { ascending: false }),
    supabase
      .from("exp_sponsored_slots")
      .select("*")
      .order("geo_value", { ascending: true })
      .order("position", { ascending: true }),
    supabase.from("exp_page_views_rollup").select("*").limit(5000),
    loadCategoryLabels(),
  ]);
  const pricingRows = rows<SponsoredPricingRow>(pricing);
  const slotRows = rows<SponsoredSlotRow>(slots);
  const rollupRows = rows<RollupRow>(rollup);
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
  const [ads, labels] = await Promise.all([
    supabase.from("exp_web_ads").select("*").order("created_at", { ascending: false }),
    loadCategoryLabels(),
  ]);
  const list = rows<SearchAdRow>(ads);
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
  const res = await supabase
    .from("gbp_categories")
    .select("gcid, display_name, slug")
    .eq("is_launched", true)
    .order("display_name", { ascending: true })
    .limit(500);
  return rows<CategoryLabel>(res).map((c) => ({
    gcid: c.gcid,
    label: c.display_name ?? c.slug ?? c.gcid,
  }));
}
