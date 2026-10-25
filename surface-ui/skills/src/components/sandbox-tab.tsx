import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@v3/ui/lib/server-fn";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@v3/ui/components/ui/sheet";
import { EmptyState, Panel } from "@v3/ui/components/console/primitives";
import { listCapabilities, listSkills, type Skill } from "@v3/skills/lib/nora-registry";
import {
  WEIGHT_KEYS,
  buildTrace,
  estimateTelemetry,
  type SandboxEntity,
  DEFAULT_SANDBOX_REF,
  listScoredEntities,
  loadSandbox,
  giveFeedback,
  listFeedback,
  listSandboxEntities,
  listWeights,
  rankGaps,
  saveWeight,
  whyLine,
  type Ranked,
  type Weights,
} from "@v3/skills/lib/nora-sandbox";
import { Chip } from "@v3/skills/components/nora/registry-tabs";
import { LEVEL_TONE, SkillRunDetail } from "@v3/skills/components/nora/skill-runs";
import { runSkill } from "@v3/skills/lib/nora-runner.functions";
import type { SkillRun } from "@v3/skills/lib/nora-runner";
import { cn } from "@v3/ui/lib/utils";

const label = "text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]";
const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : v == null || v === "" ? "—" : String(v));
const trendText = (t: unknown) => {
  const x = Number(t);
  if (!Number.isFinite(x) || t == null) return t == null ? "" : String(t);
  return x > 0 ? `▲ +${x}` : x < 0 ? `▼ ${x}` : "■ 0";
};
const trendTone = (t: unknown) => (Number(t) > 0 ? "text-[#1e8e3e]" : Number(t) < 0 ? "text-[#c5221f]" : "text-[color:var(--color-ink-3)]");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-[color:var(--color-ink-2)]">{k}</span>
      <span className="font-semibold text-ink">{v}</span>
    </div>
  );
}
function Flat({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (!entries.length) return <p className="text-xs text-[color:var(--color-ink-3)]">Not recorded.</p>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) =>
        v && typeof v === "object" && !Array.isArray(v) ? (
          <div key={k}>
            <p className="mt-1 text-[11px] font-semibold capitalize text-ink">{k.replace(/_/g, " ")}</p>
            <div className="pl-2"><Flat data={v as Record<string, unknown>} /></div>
          </div>
        ) : (
          <KV key={k} k={k.replace(/_/g, " ")} v={typeof v === "boolean" ? (v ? "yes" : "no") : Array.isArray(v) ? v.join(", ") || "—" : n(v)} />
        ),
      )}
    </div>
  );
}

export function SandboxTab() {
  const qc = useQueryClient();
  const entities = useQuery({ queryKey: ["nora-sbx-entities"], queryFn: listSandboxEntities });
  const scored = useQuery({ queryKey: ["nora-sbx-scored"], queryFn: listScoredEntities });
  const [ref, setRef] = useState(DEFAULT_SANDBOX_REF);
  const ent = useQuery({ queryKey: ["nora-sbx-state", ref], queryFn: () => loadSandbox(ref) });
  const fb = useQuery({ queryKey: ["nora-sbx-fb", ref], queryFn: () => listFeedback(ref) });
  const wq = useQuery({ queryKey: ["nora-weights"], queryFn: listWeights });
  const skills = useQuery({ queryKey: ["nora-skills"], queryFn: listSkills });
  const caps = useQuery({ queryKey: ["nora-caps"], queryFn: listCapabilities });
  const [weights, setWeights] = useState<Weights>({});
  useEffect(() => { if (wq.data) setWeights(wq.data); }, [wq.data]);
  const [run, setRun] = useState<Ranked | null>(null);

  const view = ent.data;
  const e = view?.entity;
  const st = e?.state ?? {};
  const ranked = useMemo(() => rankGaps(st.gaps ?? [], weights, fb.data ?? []), [st.gaps, weights, fb.data]);
  const skillMap = useMemo(() => new Map((skills.data ?? []).map((s) => [s.key, s])), [skills.data]);

  const feedback = useMutation({
    mutationFn: (v: { g: Ranked; signal: "declined" | "snoozed" }) =>
      giveFeedback({
        entity_id: ref,
        entity_type: e?.entity_type ?? null,
        opportunity_key: v.g.key,
        signal: v.signal,
        snooze_until: v.signal === "snoozed" ? new Date(Date.now() + 30 * 864e5).toISOString() : null,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["nora-sbx-fb", ref] });
      toast.success(v.signal === "declined" ? "Declined — re-ranked" : "Snoozed 30 days — re-ranked");
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const persistWeight = useMutation({
    mutationFn: (v: { key: string; weight: number }) => saveWeight(v.key, v.weight),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nora-weights"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const nodes = st.nodes ?? {};
  const srs = st.srs ?? {};
  const signals = obj(st.signals);
  const features = obj(st.features);
  const thin = new Set(st.thin_lanes ?? []);
  const lanes = Object.entries(srs.by_lane ?? {}).map(([k, v]) => {
    const o = typeof v === "number" ? { score: v, max: undefined } : (v ?? {});
    return { k, score: Number(o.score ?? 0), max: Number(o.max ?? 0) || undefined };
  });
  const laneMax = Math.max(1, ...lanes.map((l) => l.max ?? l.score));
  const top = ranked.find((r) => !r.suppressed);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className={label}>Entity</span>
        <select
          value={ref}
          onChange={(ev) => setRef(ev.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <optgroup label="Scored (real SRS)">
            {(scored.data ?? []).map((x) => (
              <option key={x.entity_ref} value={x.entity_ref}>
                {x.display_name ?? `Unnamed ${x.entity_type} ${x.entity_ref.slice(-4)}`} · {x.entity_type} · {x.gcid ?? "—"} · {n(x.total_score)}
              </option>
            ))}
          </optgroup>
          <optgroup label="Synthetic fallback">
            {(entities.data ?? []).filter((x) => !(scored.data ?? []).some((sx) => sx.entity_ref === x.entity_ref)).map((x) => (
              <option key={x.entity_ref} value={x.entity_ref}>{x.name ?? x.entity_ref} · {x.entity_type ?? "—"} · synthetic</option>
            ))}
          </optgroup>
        </select>
        <span className="text-xs text-[color:var(--color-ink-3)]">Read + feedback only — nothing here writes to the entity.</span>
      </div>

      {!ent.isLoading && !e ? (
        <EmptyState title="No sandbox state" description={ent.error ? (ent.error as Error).message : `No Search Rank Score or synthetic state for “${ref}”.`} />
      ) : (
        <>
          <Panel
            title={<span>{e?.name ?? `Unnamed ${e?.entity_type ?? "entity"}`}{view?.source === "synthetic" ? <span className="ml-2 rounded-md bg-[color:var(--color-g-yellow-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[#b06000]">synthetic</span> : null}</span>}
            description={[e?.entity_type, e?.category, e?.market, view?.source === "srs" ? `scored ${view.srs?.calculated_at ? new Date(view.srs.calculated_at).toLocaleDateString() : ""}` : "fallback seed — not a real score"].filter(Boolean).join(" · ")}
          >
            <div className="flex flex-wrap gap-6">
              <div>
                <p className={label}>Search Rank Score</p>
                <p className="text-2xl font-semibold text-ink">
                  {n(srs.score)}<span className="text-sm text-[color:var(--color-ink-3)]"> / {n(srs.max)}</span>
                  {view?.srs?.score_pct != null ? <span className="ml-1 text-sm text-[color:var(--color-ink-2)]">({Number(view.srs.score_pct)}%)</span> : null}
                  <span className={cn("ml-2 text-sm", trendTone(srs.trend))}>{srs.trend != null ? `${trendText(srs.trend)} 30d` : ""}</span>
                </p>
              </div>
              {view?.srs?.local_rank != null || view?.srs?.top_pct != null ? (
                <div>
                  <p className={label}>Local rank</p>
                  <p className="text-2xl font-semibold text-ink">
                    {view.srs.local_rank != null ? `#${view.srs.local_rank}${view.srs.local_rank_of ? ` of ${view.srs.local_rank_of}` : ""}` : "—"}
                  </p>
                  {view.srs.top_pct != null ? <p className="text-xs text-[color:var(--color-ink-2)]">Top {Number(view.srs.top_pct)}%{view.srs.local_market ? ` · ${view.srs.local_market}` : ""}</p> : null}
                </div>
              ) : null}
              {view?.srs?.next_milestone ? (
                <div>
                  <p className={label}>Next milestone</p>
                  <p className="text-sm font-semibold text-ink">{view.srs.next_milestone}</p>
                  {view.srs.next_milestone_gap != null ? <p className="text-xs text-[color:var(--color-ink-2)]">{n(view.srs.next_milestone_gap)} pts away</p> : null}
                </div>
              ) : null}
              <div>
                <p className={label}>Open gaps</p>
                <p className="text-2xl font-semibold text-ink">{n(st.total_gaps ?? st.gaps?.length)}</p>
              </div>
            </div>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel title="SRS by lane" description={view?.source === "srs" ? "Earned points per lane." : "Synthetic lanes — thin lanes flagged."}>
              {lanes.length ? (
                <ul className="space-y-2">
                  {lanes.map((l) => (
                    <li key={l.k}>
                      <div className="flex justify-between text-xs">
                        <span className="capitalize text-ink">{l.k.replace(/_/g, " ")}{thin.has(l.k) ? <span className="ml-1.5 font-semibold text-[#b06000]">thin</span> : null}</span>
                        <span className="tabular-nums text-[color:var(--color-ink-2)]">{l.score}{l.max ? ` / ${l.max}` : ""}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-[color:var(--color-surface-3)]">
                        <div
                          className={cn("h-1.5 rounded", thin.has(l.k) ? "bg-[color:var(--color-g-yellow)]" : "bg-[color:var(--color-g-blue)]")}
                          style={{ width: `${Math.min(100, (l.score / (l.max ?? laneMax)) * 100)}%` }}
                        />
                      </div>
                      {l.k === "Completeness" && nodes.current != null ? (
                        <p className="mt-0.5 text-[11px] text-[color:var(--color-ink-3)]">
                          Input: {n(nodes.current)}{nodes.possible != null ? ` of ${n(nodes.possible)}` : ""} category nodes filled
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-[color:var(--color-ink-3)]">No lane breakdown.</p>}
            </Panel>
            <Panel title="Signals" description="Traffic, map rank, AI citations, reviews."><Flat data={signals} /></Panel>
            <Panel title="Features & entitlements" description="VOCE, Google, listings."><Flat data={features} /></Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Panel
              title="Priority queue"
              description="Deterministic: impact × feasibility × urgency × confidence − effort. Declined or snoozed items sink."
              className="lg:col-span-2"
            >
              {top ? (
                <div className="mb-4 rounded-[12px] border border-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue-soft)] p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-g-blue)]"><Sparkles className="h-3.5 w-3.5" />Next best move</p>
                  <p className="mt-1 text-sm font-semibold text-ink">{top.label}</p>
                  <p className="text-xs text-[color:var(--color-ink-2)]">Why: {whyLine(top)}</p>
                </div>
              ) : null}
              {ranked.length ? (
                <ol className="divide-y divide-[color:var(--color-hairline)]">
                  {ranked.map((g, i) => {
                    const sk = g.skill_key ? skillMap.get(g.skill_key) : undefined;
                    const wrongType = sk && e?.entity_type && !(sk.entity_types ?? []).includes(e.entity_type);
                    return (
                      <li key={g.key} className={cn("flex flex-wrap items-center gap-3 py-2.5", g.suppressed && "opacity-50", g === top && "font-medium")}>
                        <span className="w-6 text-xs tabular-nums text-[color:var(--color-ink-3)]">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">{g.label}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                            {g.lane ? <span className="rounded-md bg-[color:var(--color-surface-3)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--color-ink-2)]">{g.lane}</span> : null}
                            <span className="text-[color:var(--color-ink-2)]">+{n(g.impact)} SRS</span>
                            <span className="tabular-nums text-[color:var(--color-ink-3)]">score {g.raw.toFixed(2)}</span>
                            {g.skill_key ? (
                              <span className="inline-flex items-center gap-1">
                                <span className="font-mono text-[11px] text-ink">{g.skill_key}</span>
                                {sk ? <Chip v={sk.status} /> : <span className="text-[#c5221f]">not registered</span>}
                                {wrongType ? <span className="inline-flex items-center gap-0.5 text-[#b06000]"><AlertTriangle className="h-3 w-3" />not for {e?.entity_type}</span> : null}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 text-[#b06000]"><AlertTriangle className="h-3 w-3" />no skill yet</span>
                            )}
                            {g.suppressed ? <span className="font-semibold text-[color:var(--color-ink-3)]">suppressed</span> : null}
                          </div>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => setRun(g)}>Run (dry-run)</Button>
                        <Button size="sm" variant="outline" disabled={feedback.isPending} onClick={() => feedback.mutate({ g, signal: "declined" })}>Decline</Button>
                        <Button size="sm" variant="outline" disabled={feedback.isPending} onClick={() => feedback.mutate({ g, signal: "snoozed" })}>Snooze 30d</Button>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="text-xs text-[color:var(--color-ink-3)]">No gaps in this entity's state.</p>}
            </Panel>

            <Panel title="Weights" description="Calibration — changes re-rank live and save.">
              <div className="space-y-3">
                {WEIGHT_KEYS.map((k) => (
                  <label key={k} className="block">
                    <span className={label}>{k.replace(/_/g, " ")}</span>
                    <Input
                      type="number"
                      step="0.05"
                      value={weights[k] ?? ""}
                      onChange={(ev) => setWeights({ ...weights, [k]: Number(ev.target.value) })}
                      onBlur={(ev) => {
                        const v = Number(ev.target.value);
                        if (Number.isFinite(v) && v !== wq.data?.[k]) persistWeight.mutate({ key: k, weight: v });
                      }}
                    />
                  </label>
                ))}
                {wq.error ? <p className="text-xs text-[#c5221f]">{(wq.error as Error).message}</p> : null}
              </div>
            </Panel>
          </div>
        </>
      )}

      <DryRun gap={run} skill={run?.skill_key ? skillMap.get(run.skill_key) : undefined} entity={e ?? null} entityRef={ref} entityName={e?.name ?? ref} capKeys={(caps.data ?? []).map((c) => c.key)} onClose={() => setRun(null)} />
    </div>
  );
}

function TelemetryStrip({ t }: { t: ReturnType<typeof estimateTelemetry> }) {
  const cell = (k: string, v: string) => (
    <div className="min-w-[90px]">
      <p className={label}>{k}</p>
      <p className="font-mono text-sm text-ink">{v}</p>
    </div>
  );
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-[12px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-3">
      {cell("Model", t.model)}
      {cell(t.estimated ? "Est. tokens" : "Input tokens", t.input_tokens == null ? "—" : t.input_tokens.toLocaleString())}
      {cell("Output tokens", t.output_tokens == null ? "—" : t.output_tokens.toLocaleString())}
      {cell("Latency", t.ms == null ? "—" : `${t.ms} ms`)}
      {t.estimated ? <span className="text-[11px] text-[color:var(--color-ink-3)]">estimated · no live call yet</span> : null}
    </div>
  );
}

function DryRun({ gap, skill, entity, entityRef, entityName, capKeys, onClose }: { gap: Ranked | null; skill?: Skill; entity: SandboxEntity | null; entityRef: string; entityName: string; capKeys: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const runFn = useServerFn(runSkill);
  const [logged, setLogged] = useState<SkillRun | null>(null);
  useEffect(() => setLogged(null), [gap?.key, entityRef]);
  const realRun = useMutation({
    mutationFn: (g: Ranked) =>
      runFn({
        data: {
          skillKey: g.skill_key ?? "",
          entityId: entityRef,
          mode: "dry_run",
          trigger: "manual",
          inputs: { gap_key: g.key, gap_label: g.label, lane: g.lane ?? null, impact: g.impact ?? null },
        },
      }),
    onSuccess: (r) => {
      setLogged(r as SkillRun);
      qc.invalidateQueries({ queryKey: ["nora-skill-runs"] });
      toast.success(`Dry run logged — ${r.verdict}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const trace = gap ? buildTrace(gap, skill, entity ?? {}, capKeys) : null;
  const needs = Array.isArray(gap?.needs) ? gap?.needs.join(", ") : gap?.needs;
  const steps: string[] = gap
    ? [
        `Read ${(skill?.reads_state ?? []).join(", ") || "the entity state"} for ${entityName}.`,
        `Target gap “${gap.label}” in the ${gap.lane ?? "unassigned"} lane (+${gap.impact ?? 0} SRS potential).`,
        ...(skill?.tools_used ?? []).map((t) => `Call capability ${t} (dry run).`),
        ...(needs ? [`Requires ${needs} before it could execute.`] : []),
        ...(skill?.guardrails ?? []).map((g) => `Guardrail: ${g}`),
        skill?.autonomy ? `Autonomy “${skill.autonomy}” — would ${/auto/i.test(skill.autonomy) ? "proceed after approval" : "queue for human review"}.` : "Would queue for human review.",
      ]
    : [];
  return (
    <Sheet open={!!gap} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader><SheetTitle>Dry run: {gap?.label}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4 px-1 pb-8">
          <p className="rounded-md bg-[color:var(--color-g-yellow-soft)] px-3 py-2 text-xs font-semibold text-[#b06000]">Simulated — no changes made</p>
          <TelemetryStrip t={estimateTelemetry(skill)} />
          {trace ? (
            <div>
              <p className={label}>Raw trace</p>
              <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-[color:var(--color-surface-2)] p-2 font-mono text-[11px] leading-relaxed">
                {trace.lines.map((l, i) => (
                  <div key={i} className={LEVEL_TONE[l.level]}>[{l.level.padEnd(5)}] {l.text}</div>
                ))}
                <div className={cn("mt-1 font-bold", trace.errors ? "text-[#c5221f]" : "text-[#1e8e3e]")}>{trace.verdict}</div>
              </pre>
            </div>
          ) : null}
          <div>
            <p className={label}>Skill manifest</p>
            {skill ? (
              <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-[color:var(--color-surface-2)] p-2 text-[11px]">{JSON.stringify(skill, null, 2)}</pre>
            ) : (
              <p className="mt-1 text-xs text-[#b06000]">{gap?.skill_key ? `Skill ${gap.skill_key} is not registered.` : "No skill mapped to this gap yet."}</p>
            )}
          </div>
          <div>
            <p className={label}>What NORA would do</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-ink">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            {skill?.explanation_template ? <p className="mt-2 text-xs italic text-[color:var(--color-ink-2)]">{skill.explanation_template}</p> : null}
          </div>
          {logged ? (
            <div>
              <p className={label}>Logged run (exp_skill_run)</p>
              <div className="mt-1"><SkillRunDetail run={logged} /></div>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="outline" disabled={!gap?.skill_key || realRun.isPending} onClick={() => gap && realRun.mutate(gap)}>
              {realRun.isPending ? "Running…" : "Run (dry run)"}
            </Button>
            <Button onClick={() => { toast.success("Approved (simulated) — nothing was executed"); onClose(); }}>Approve</Button>
            <Button variant="outline" onClick={onClose}>Not now</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
