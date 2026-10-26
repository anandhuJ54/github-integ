import { api } from "@v3/ui/lib/server-fn";

/* ────────────────────────────────────────────────────────────
   Run health: the discovery job list + pipeline counts (etl: GET /etl/platform/pipeline-health).
   Moved from _base/src/lib/console-surfaces.ts (surface audit §11 row 7b, 2026-10-25).
   Real-only: every number comes from a table read; one request, exact counts.
   ──────────────────────────────────────────────────────────── */

export type DiscoJob = {
  job_id: number;
  category_slug: string | null;
  step: string | null;
  status: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function loadPipelineHealth() {
  const r = await api.get<{
    jobs: DiscoJob[];
    counts: {
      proposals: number;
      llm: number;
      siteContracts: number;
      engineRequests: number;
      engineSnapshots: number;
      enginePrompts: number;
    };
  }>("/etl/platform/pipeline-health");
  const { proposals, llm, siteContracts: contract, engineRequests: engineReq, engineSnapshots: engineSnap, enginePrompts: prompts } =
    r.counts;

  const rows = r.jobs ?? [];
  const byStatus = rows.reduce<Record<string, number>>((acc, j) => {
    const k = j.status ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const byStep = rows.reduce<Record<string, number>>((acc, j) => {
    const k = j.step ?? "unknown";
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return {
    jobs: rows,
    byStatus,
    byStep,
    counts: {
      proposals,
      llm,
      siteContracts: contract,
      engineRequests: engineReq,
      engineSnapshots: engineSnap,
      enginePrompts: prompts,
    },
    lastTick: rows[0]?.updated_at ?? null,
    awaitingHuman: rows.filter((j) => j.status === "awaiting_human").length,
  };
}
