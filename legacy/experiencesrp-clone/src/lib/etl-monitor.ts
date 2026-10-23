import { supabase } from "@/integrations/supabase/client";

/* ────────────────────────────────────────────────────────────
   Live ETL run monitor (read-only).
   Every figure is a table read against exp_etl_staging,
   exp_etl_field_floors, professionals and graph_nodes.
   ──────────────────────────────────────────────────────────── */

const db = supabase as unknown as { from: (table: string) => any };

const AGENT_GCID = "gcid:insurance_agent";
const AGENCY_GCID = "gcid:insurance_agency";
/** Depth baseline measured on the pre-deep core capture (~3 fields/profile). */
export const BASELINE_FIELDS_PER_PROFILE = 3;

async function count(table: string, apply: (q: any) => any): Promise<number> {
  const { count: c, error } = await apply(
    db.from(table).select("*", { count: "exact", head: true }),
  );
  if (error) throw error;
  return c ?? 0;
}

export type FieldFloor = {
  gcid: string;
  min_fields: number;
  required_keys: string[] | null;
  min_products: number | null;
  min_licenses: number | null;
  notes: string | null;
};

export type FlaggedRow = {
  stage_id: string;
  detail_url: string | null;
  resolution_status: string;
  reasons: string[];
  resolved_at: string | null;
};

export type EtlMonitor = {
  progress: { total: number; processed: number; remaining: number; pctComplete: number };
  yield: {
    profiles: number;
    withBio: number;
    withPhoto: number;
    withPlaceId: number;
    nodes: { product_service: number; social_profile: number; credential: number };
  };
  gate: {
    floors: FieldFloor[];
    flagged: number;
    shallowRate: number;
    recent: FlaggedRow[];
  };
  depth: { baseline: number; avgFieldsNow: number | null; deepRows: number };
};

export async function loadEtlMonitor(): Promise<EtlMonitor> {
  const stg = (q: any) => q.eq("gcid", AGENT_GCID);
  const pro = (q: any) =>
    q.eq("gcid", AGENCY_GCID).ilike("canonical_url", "%statefarm.com/agent%");

  const [
    total,
    processed,
    remaining,
    flagged,
    profiles,
    withBio,
    withPhoto,
    withPlaceId,
    products,
    socials,
    credentials,
    floorsRes,
    recentRes,
    deepRes,
  ] = await Promise.all([
    count("exp_etl_staging", stg),
    count("exp_etl_staging", (q) => stg(q).in("field_tier", ["deep", "enrichment"])),
    count("exp_etl_staging", (q) => stg(q).eq("field_tier", "core")),
    count("exp_etl_staging", (q) =>
      stg(q).in("resolution_status", ["shallow", "needs_review"]),
    ),
    count("professionals", pro),
    count("professionals", (q) => pro(q).not("bio", "is", null)),
    count("professionals", (q) => pro(q).not("photo_url", "is", null)),
    count("professionals", (q) => pro(q).not("gbp_place_id", "is", null)),
    count("graph_nodes", (q) => q.eq("source", "etl").eq("node_type", "product_service")),
    count("graph_nodes", (q) => q.eq("source", "etl").eq("node_type", "social_profile")),
    count("graph_nodes", (q) => q.eq("source", "etl").eq("node_type", "credential")),
    db.from("exp_etl_field_floors").select("*").order("gcid"),
    db
      .from("exp_etl_staging")
      .select("stage_id, detail_url, resolution_status, payload, resolved_at")
      .in("resolution_status", ["shallow", "needs_review"])
      .order("resolved_at", { ascending: false, nullsFirst: false })
      .limit(10),
    db
      .from("exp_etl_staging")
      .select("payload->>field_count")
      .eq("gcid", AGENT_GCID)
      .eq("payload->>field_tier", "deep")
      .limit(5000),
  ]);

  const fieldCounts = ((deepRes.data ?? []) as Array<Record<string, unknown>>)
    .map((r) => Number(r.field_count))
    .filter((n) => Number.isFinite(n) && n > 0);

  const recent: FlaggedRow[] = ((recentRes.data ?? []) as any[]).map((r) => {
    const raw = r.payload?.gate_reasons;
    return {
      stage_id: String(r.stage_id),
      detail_url: r.detail_url ?? null,
      resolution_status: String(r.resolution_status),
      reasons: Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [],
      resolved_at: r.resolved_at ?? null,
    };
  });

  return {
    progress: {
      total,
      processed,
      remaining,
      pctComplete: total ? processed / total : 0,
    },
    yield: {
      profiles,
      withBio,
      withPhoto,
      withPlaceId,
      nodes: {
        product_service: products,
        social_profile: socials,
        credential: credentials,
      },
    },
    gate: {
      floors: (floorsRes.data ?? []) as FieldFloor[],
      flagged,
      shallowRate: processed ? flagged / processed : 0,
      recent,
    },
    depth: {
      baseline: BASELINE_FIELDS_PER_PROFILE,
      avgFieldsNow: fieldCounts.length
        ? Math.round((fieldCounts.reduce((a, b) => a + b, 0) / fieldCounts.length) * 10) / 10
        : null,
      deepRows: fieldCounts.length,
    },
  };
}
