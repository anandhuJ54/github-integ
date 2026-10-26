// srp's own copy of the run chip and run detail the seat interview renders (surface audit §11 row 4,
// 2026-10-25). Copied from surface-ui/skills/src/components/nora/{registry-tabs,skill-runs}.tsx;
// keep the look in step with those.
import { cn } from "@v3/ui/lib/utils";
import type { SkillRun, TraceStep } from "@v3/srp/lib/nora/skill-run";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
  in_eval: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
  published: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  deprecated: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  built: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  welded: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  screen_only: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
  not_built: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-3)]",
  untested: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
  pass: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  fail: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  yanked: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  // exp_skill_run status / verdict
  succeeded: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  executed: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  would_execute: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  blocked: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  failed: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
  pitch: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  not_implemented: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
  live: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  dry_run: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
};

export function Chip({ v }: { v: string | null | undefined }) {
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[v ?? ""] ?? STATUS_TONE.draft)}>
      {v ?? "—"}
    </span>
  );
}

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

