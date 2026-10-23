import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { EmptyState, Panel } from "@/components/console/primitives";
import { Chip } from "@/components/nora/registry-tabs";
import { listSkillRuns } from "@/lib/nora-registry";
import type { SkillRun, TraceStep } from "@/lib/nora-runner";
import { cn } from "@/lib/utils";

/* Skill runs — reads exp_skill_run (written by runSkill). Shared by the Runs tab and the Sandbox. */

const label = "text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]";

export const LEVEL_TONE: Record<string, string> = {
  plan: "text-[color:var(--color-g-blue)]",
  read: "text-[color:var(--color-ink-2)]",
  check: "text-[color:var(--color-ink-2)]",
  call: "text-[#1e8e3e]",
  warn: "text-[#b06000]",
  error: "text-[#c5221f]",
};

const fmtMs = (v: unknown) => (typeof v === "number" ? `${v} ms` : "—");
const fmtUsd = (v: unknown) => (typeof v === "number" ? `$${v.toFixed(6)}` : "—");
const fmtNum = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : "—");

export function RunTrace({ steps }: { steps: TraceStep[] }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md bg-[color:var(--color-surface-2)] p-2 font-mono text-[11px] leading-relaxed">
      {steps.map((l) => (
        <div key={l.step} className={LEVEL_TONE[l.level]}>
          [{l.level.padEnd(5)}] {l.text}
          {l.ms != null ? (
            <span className="text-[color:var(--color-ink-3)]"> · {l.ms} ms</span>
          ) : null}
        </div>
      ))}
    </pre>
  );
}

/** One logged run: verdict, telemetry, gates, trace, outputs. */
export function SkillRunDetail({ run }: { run: SkillRun }) {
  const t = run.telemetry ?? {};
  const out = (run.outputs ?? {}) as Record<string, unknown>;
  const gov = (out.governance ?? {}) as {
    live_blockers?: string[];
    live_ready?: boolean;
    compliance?: string;
    commercial?: string;
  };
  const cell = (k: string, v: string) => (
    <div className="min-w-[90px]">
      <p className={label}>{k}</p>
      <p className="font-mono text-sm text-ink">{v}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Chip v={run.verdict} />
        <Chip v={run.status} />
        <Chip v={run.mode} />
        {gov.compliance ? (
          <span className="text-[color:var(--color-ink-2)]">
            {gov.compliance} · {gov.commercial}
          </span>
        ) : null}
        <span className="font-mono text-[11px] text-[color:var(--color-ink-3)]">run {run.id}</span>
      </div>
      <div className="flex flex-wrap items-end gap-4 rounded-[12px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-3">
        {cell("Model", String(t.model ?? "—"))}
        {cell("Model calls", fmtNum(t.model_calls))}
        {cell("Est. tokens", fmtNum(t.estimated_input_tokens))}
        {cell("Est. cost", fmtUsd(t.estimated_cost_usd))}
        {cell("Actual cost", fmtUsd(t.actual_cost_usd))}
        {cell("Total", fmtMs(t.ms_total))}
        {cell("Governance", fmtMs(t.ms_governance))}
        {cell("Execution", fmtMs(t.ms_execution))}
      </div>
      {gov.live_blockers?.length ? (
        <div>
          <p className={label}>Live would be refused because</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[#c5221f]">
            {gov.live_blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : gov.live_ready ? (
        <p className="text-xs font-semibold text-[#1e8e3e]">
          Every gate is open — ready for a live run.
        </p>
      ) : null}
      {run.error ? <p className="text-xs text-[#c5221f]">Error: {run.error}</p> : null}
      <div>
        <p className={label}>Trace</p>
        <div className="mt-1">
          <RunTrace steps={run.trace ?? []} />
        </div>
      </div>
      <div>
        <p className={label}>Outputs</p>
        <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[color:var(--color-surface-2)] p-2 text-[11px]">
          {JSON.stringify(run.outputs, null, 2)}
        </pre>
      </div>
    </div>
  );
}

/** Runs tab view: every logged skill run, newest first, expandable to its trace. */
export function SkillRunsPanel() {
  const runs = useQuery({ queryKey: ["nora-skill-runs"], queryFn: () => listSkillRuns(100) });
  const [open, setOpen] = useState<string | null>(null);
  const rows = runs.data ?? [];
  return (
    <Panel
      title="Skill runs"
      description="Every runSkill invocation — dry runs and live — read from exp_skill_run, newest first."
      bodyClassName="px-3 py-2"
    >
      {runs.error ? (
        <p className="text-xs text-[#c5221f]">{(runs.error as Error).message}</p>
      ) : runs.isLoading ? (
        <div className="h-10 animate-pulse rounded-lg bg-[color:var(--color-surface-2)]" />
      ) : !rows.length ? (
        <EmptyState
          title="No skill runs yet"
          description="Run a skill from the Sandbox (Run (dry run)) to log the first one."
          compact
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                {["", "Skill", "Entity", "Mode", "Status", "Verdict", "Telemetry", "When"].map(
                  (h) => (
                    <th key={h} className={cn(label, "px-2 py-2")}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = r.telemetry ?? {};
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-t border-[color:var(--color-hairline)] hover:bg-[color:var(--color-surface-2)]"
                      onClick={() => setOpen(isOpen ? null : r.id)}
                    >
                      <td className="px-2 py-2 text-[color:var(--color-ink-3)]">
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-xs text-ink">{r.skill_key}</span>
                        {r.skill_version ? (
                          <span className="ml-1 text-[11px] text-[color:var(--color-ink-3)]">
                            @{r.skill_version}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-xs text-[color:var(--color-ink-2)]">
                        {r.entity_ref ? `${r.entity_type ?? "—"} · ${r.entity_ref.slice(-8)}` : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Chip v={r.mode} />
                      </td>
                      <td className="px-2 py-2">
                        <Chip v={r.status} />
                      </td>
                      <td className="px-2 py-2">
                        <Chip v={r.verdict} />
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px] text-[color:var(--color-ink-2)]">
                        {String(t.model ?? "—")} · {fmtMs(t.ms_total)} ·{" "}
                        {fmtUsd(t.estimated_cost_usd)}
                      </td>
                      <td className="px-2 py-2 text-xs text-[color:var(--color-ink-3)]">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={8} className="px-2 pb-4 pt-1">
                          <SkillRunDetail run={r} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
