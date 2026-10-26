import { api } from "@v3/state/api/server-fn";

/* ────────────────────────────────────────────────────────────
   Live ETL run monitor (read-only).
   Served by GET /etl/run-monitor (surface-api/etl/queries/run_monitor.py):
   table reads against exp_etl_staging, exp_etl_field_floors,
   professionals and graph_nodes, made as the signed-in user.
   ──────────────────────────────────────────────────────────── */

/** Depth baseline measured on the pre-deep core capture (~3 fields/profile). */
export const BASELINE_FIELDS_PER_PROFILE = 3;

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

export function loadEtlMonitor(): Promise<EtlMonitor> {
  return api.get<EtlMonitor>("/etl/run-monitor");
}
