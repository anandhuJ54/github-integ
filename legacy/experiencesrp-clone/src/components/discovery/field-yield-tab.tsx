import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RequiredFieldsEditor, type FieldFloor } from "./required-fields-editor";

type Floor = FieldFloor;

type Job = {
  job_key: string;
  gcid: string;
  status: string;
  batch_size: number;
  processed: number;
  promoted: number;
  shallow: number;
  failed: number;
  last_error: string | null;
  last_run_at: string | null;
};

type Yield = { gcid: string; total: number; deep: number; shallow: number; remaining: number };

async function countStaging(gcid: string, apply: (q: any) => any) {
  const { count } = await apply(
    supabase.from("exp_etl_staging").select("stage_id", { count: "exact", head: true }).eq("gcid", gcid),
  );
  return count ?? 0;
}

async function loadGate() {
  const [{ data: floors }, { data: jobs }] = await Promise.all([
    supabase.from("exp_etl_field_floors").select("*").order("gcid"),
    supabase.from("exp_etl_hydrate_jobs").select("*").order("job_key"),
  ]);
  const gcids = Array.from(
    new Set([...(floors ?? []).map((f) => f.gcid), ...(jobs ?? []).map((j) => j.gcid)]),
  );
  const yields: Yield[] = [];
  for (const gcid of gcids) {
    const total = await countStaging(gcid, (q) => q);
    const deep = await countStaging(gcid, (q) => q.eq("payload->>field_tier", "deep"));
    const shallow = await countStaging(gcid, (q) => q.eq("resolution_status", "shallow"));
    yields.push({ gcid, total, deep, shallow, remaining: Math.max(total - deep - shallow, 0) });
  }
  return {
    floors: (floors ?? []) as unknown as Floor[],
    jobs: (jobs ?? []) as unknown as Job[],
    yields,
  };
}

const STATUS_STYLE: Record<string, string> = {
  running: "bg-emerald-50 text-emerald-700",
  idle: "bg-slate-100 text-slate-600",
  paused: "bg-amber-50 text-amber-700",
  done: "bg-teal-50 text-teal-700",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone ?? "text-ink"}`}>{value}</div>
    </div>
  );
}

export function FieldYieldTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["etl-field-yield"],
    queryFn: loadGate,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return <p className="text-sm text-slate-500">Loading gate report…</p>;
  }

  return (
    <div className="space-y-8">
      <RequiredFieldsEditor floors={data.floors} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Gate report by category</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {data.yields.map((y) => {
            const checked = y.deep + y.shallow;
            const pass = checked ? Math.round((y.deep / checked) * 1000) / 10 : 0;
            return (
              <div key={y.gcid} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-600">{y.gcid}</span>
                  <Badge className="bg-slate-100 text-slate-600">{pass}% pass</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Staged" value={y.total.toLocaleString()} />
                  <Stat label="Passed" value={y.deep.toLocaleString()} tone="text-emerald-600" />
                  <Stat label="Shallow" value={y.shallow.toLocaleString()} tone="text-amber-600" />
                  <Stat label="Remaining" value={y.remaining.toLocaleString()} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Background hydration jobs</h2>
        <div className="space-y-3">
          {data.jobs.map((j) => (
            <div key={j.job_key} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-ink">{j.job_key}</div>
                  <div className="font-mono text-xs text-slate-500">{j.gcid}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={STATUS_STYLE[j.status] ?? "bg-slate-100 text-slate-600"}>
                    {j.status}
                  </Badge>
                  <span className="text-xs text-slate-500">
                    batch {j.batch_size} ·{" "}
                    {j.last_run_at ? new Date(j.last_run_at).toLocaleString() : "never run"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => qc.invalidateQueries({ queryKey: ["etl-field-yield"] })}
                  >
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Processed" value={Number(j.processed).toLocaleString()} />
                <Stat label="Promoted" value={Number(j.promoted).toLocaleString()} tone="text-emerald-600" />
                <Stat label="Shallow" value={Number(j.shallow).toLocaleString()} tone="text-amber-600" />
                <Stat label="Failed" value={Number(j.failed).toLocaleString()} tone="text-red-600" />
              </div>
              {j.last_error && (
                <p className="mt-2 text-xs text-red-600">Last error: {j.last_error}</p>
              )}
            </div>
          ))}
          {!data.jobs.length && (
            <p className="text-sm text-slate-500">No background hydration jobs registered.</p>
          )}
        </div>
      </section>
    </div>
  );
}
