import { useQuery } from "@tanstack/react-query";
import { Bot, Cpu, Layers, UserCheck, Info, Database } from "lucide-react";
import {
  Panel,
  StatTile,
  DataTable,
  EmptyState,
  type Column,
} from "@v3/ui/components/console/primitives";
import { EtlRunMonitor } from "@v3/etl/components/discovery/etl-run-monitor";
import { loadPipelineHealth, num, type DiscoJob } from "@v3/ui/lib/console-surfaces";
import { cn } from "@v3/ui/lib/utils";

/* Discovery pipeline health (moved from the old /nora-os Runs tab, surface audit 2026-10-24):
   disco jobs and engine counts (GET /etl/platform/pipeline-health) and the ETL run monitor
   (GET /etl/run-monitor). Read-only. */

const STATUS_TONE: Record<string, string> = {
  awaiting_human: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
  awaiting_ai: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  complete: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  failed: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
};

const STEPS = ["discover", "propose", "review", "apply"] as const;

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        className ?? "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
      )}
    >
      {children}
    </span>
  );
}

export function PipelineHealthTab() {
  const { data, isLoading } = useQuery({ queryKey: ["etl-pipeline-health"], queryFn: loadPipelineHealth });
  const c = data?.counts;

  const columns: Column<DiscoJob>[] = [
    {
      key: "gcid",
      header: "Category",
      cell: (j) => (
        <span className="font-mono text-xs text-ink">{j.category_slug ?? "—"}</span>
      ),
    },
    {
      key: "step",
      header: "Step",
      cell: (j) => <Chip>{j.step ?? "—"}</Chip>,
    },
    {
      key: "status",
      header: "Status",
      cell: (j) => (
        <Chip className={STATUS_TONE[j.status ?? ""]}>{j.status ?? "—"}</Chip>
      ),
    },
    {
      key: "note",
      header: "Note",
      cell: (j) => (
        <span className="text-xs text-[color:var(--color-ink-2)]">{j.note ?? "—"}</span>
      ),
    },
    {
      key: "updated",
      header: "Last tick",
      align: "right",
      cell: (j) => (
        <span className="text-xs text-[color:var(--color-ink-3)]">
          {j.updated_at ? new Date(j.updated_at).toLocaleString() : "—"}
        </span>
      ),
    },
  ];

  return (
    <div>
        <p className="mb-4 max-w-3xl text-sm text-[color:var(--color-ink-2)]">The operating view over the autonomous category pipeline. Discovery jobs, their step and status, the human review queue and the engine snapshot store all read live from disco_* and exp_engine_* — this is the ground truth for what Nora is working on right now.</p>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Discovery jobs"
            value={num(data?.jobs.length)}
            hint={data?.lastTick ? `Last tick ${new Date(data.lastTick).toLocaleString()}` : "No ticks yet"}
            icon={<Bot className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatTile
            label="Awaiting human"
            value={num(data?.awaitingHuman)}
            hint="Jobs blocked on review"
            icon={<UserCheck className="h-4 w-4" />}
            tone={data?.awaitingHuman ? "yellow" : "neutral"}
            loading={isLoading}
          />
          <StatTile
            label="LLM requests"
            value={num(c?.llm)}
            hint={c ? `${num(c.proposals)} proposals generated` : undefined}
            icon={<Cpu className="h-4 w-4" />}
            tone="purple"
            loading={isLoading}
          />
          <StatTile
            label="Engine snapshots"
            value={num(c?.engineSnapshots)}
            hint={c ? `${num(c.enginePrompts)} prompts registered` : undefined}
            icon={<Database className="h-4 w-4" />}
            tone="green"
            loading={isLoading}
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <Panel
            title="Pipeline by step"
            description="Where every in-flight job currently sits."
            className="lg:col-span-1"
          >
            {isLoading ? (
              <div className="space-y-2">
                {STEPS.map((s) => (
                  <div key={s} className="h-10 animate-pulse rounded-lg bg-[color:var(--color-surface-2)]" />
                ))}
              </div>
            ) : (
              <ul className="space-y-2">
                {STEPS.map((step) => {
                  const n = data?.byStep[step] ?? 0;
                  return (
                    <li
                      key={step}
                      className="flex items-center justify-between rounded-[12px] border border-[color:var(--color-hairline)] px-4 py-2.5"
                    >
                      <span className="text-sm capitalize text-ink">{step}</span>
                      <span
                        className={cn(
                          "text-sm font-semibold",
                          n ? "text-ink" : "text-[color:var(--color-ink-3)]",
                        )}
                      >
                        {n}
                      </span>
                    </li>
                  );
                })}
                {Object.entries(data?.byStep ?? {})
                  .filter(([k]) => !STEPS.includes(k as (typeof STEPS)[number]))
                  .map(([k, n]) => (
                    <li
                      key={k}
                      className="flex items-center justify-between rounded-[12px] border border-[color:var(--color-hairline)] px-4 py-2.5"
                    >
                      <span className="text-sm text-ink">{k}</span>
                      <span className="text-sm font-semibold text-ink">{n}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Job queue"
            description="Every discovery job, newest tick first."
            className="lg:col-span-2"
            bodyClassName="px-3 py-2"
          >
            <DataTable
              columns={columns}
              rows={data?.jobs ?? []}
              loading={isLoading}
              getRowKey={(j) => String(j.job_id)}
              empty={
                <EmptyState
                  title="No discovery jobs"
                  description="Jobs appear here as soon as the discovery worker is invoked for a category."
                  compact
                />
              }
            />
          </Panel>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel title="Engine throughput" description="Category engine request and payload volume.">
            <dl className="space-y-3 text-sm">
              {[
                { label: "Engine requests", value: num(c?.engineRequests) },
                { label: "Engine snapshots", value: num(c?.engineSnapshots) },
                { label: "Registered prompts", value: num(c?.enginePrompts) },
                { label: "Site contracts", value: num(c?.siteContracts) },
                { label: "Proposals pending apply", value: num(c?.proposals) },
              ].map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between border-b border-[color:var(--color-hairline)] pb-2 last:border-0 last:pb-0"
                >
                  <dt className="text-[color:var(--color-ink-2)]">{r.label}</dt>
                  <dd className="font-semibold text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Scheduler & autonomy" bodyClassName="px-6 py-5">
            <EmptyState
              icon={<Info className="h-4 w-4" />}
              title="Instrument to activate"
              description="Ticks are currently driven by manual worker invocation — no cron schedule is registered, so there is no tick cadence, retry backlog or throughput-per-hour to report. Wiring the discovery worker to a schedule turns the counters above into a live rate."
              compact
            />
            <div className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed text-[color:var(--color-ink-2)]">
              <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-ink-3)]" />
              <p>
                Governed engine tables are read-only from the console by contract — apply decisions
                flow through the discovery worker and the curation ledger, never through this view.
              </p>
            </div>
          </Panel>
        </div>

        <EtlRunMonitor />
    </div>
  );
}
