/**
 * NORA first-run interview — steps 1–2 (docs/NORA_OS_VISION_AND_MODEL.md §2a).
 *
 * Lives in the seat (the claimed entity's own workspace) because it is the one place that
 * already serves BOTH record kinds a claim lands on (professional and office/location) under
 * one shell; the claim page links here once a claim is granted.
 *
 * Every action is a runSkill call (one exp_skill_run row each): dry run first, live only with
 * the owner's explicit approval. All labels, collections and cardinality UI come from the
 * category brief via src/lib/nora/interview.ts — no per-category code.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@v3/ui/lib/server-fn";
import { useMemo, useState } from "react";
import { CheckCircle2, Globe, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, Panel, StatTile } from "@v3/ui/components/console/primitives";
import { SeatLoading } from "@v3/xmp/components/seat/pieces";
import { Chip } from "@v3/ui/components/nora/registry-tabs";
import { SkillRunDetail } from "@v3/ui/components/nora/skill-runs";
import { Badge } from "@v3/ui/components/ui/badge";
import { Button } from "@v3/ui/components/ui/button";
import { Checkbox } from "@v3/ui/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@v3/xmp/components/ui/radio-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@v3/ui/components/ui/sheet";
import { getCategoryBrief } from "@v3/xmp/lib/category-brief.functions";
import { runSkill } from "@v3/ui/lib/nora-runner.functions";
import type { RunMode, SkillRun } from "@v3/ui/lib/nora-runner";
import type { ExtractResult } from "@v3/xmp/lib/nora/extract/types";
import {
  ORGANIZE_SKILLS,
  capabilityOutput,
  claimStepModel,
  confirmInputs,
  confirmedNodes,
  extractInputs,
  hopInputs,
  interviewEntityType,
  organizedPages,
  reviewModel,
  runView,
  sweepInputs,
  sweepModel,
  type OrganizePhase,
  type ReviewCollection,
  type SubjectKind,
} from "@v3/xmp/lib/nora/interview";
import { loadClaimSource, loadInterviewSubject } from "@v3/xmp/lib/nora/interview-data";
import { useSeatParams } from "./seat.$kind.$id";

export const Route = createFileRoute("/_authenticated/seat/$kind/$id/interview")({
  component: SeatInterview,
});

const label = "text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]";
const NEEDS: Record<OrganizePhase, string[]> = {
  sweep: ["page_fetch"],
  hop: ["source_crawl"],
  extract: ["nlp_extract"],
  confirm: [],
};

function SeatInterview() {
  const { id, isPro } = useSeatParams();
  const kind: SubjectKind = isPro ? "professional" : "office";
  const subjectQ = useQuery({
    queryKey: ["interview-subject", kind, id],
    queryFn: () => loadInterviewSubject(kind, id),
  });
  const subject = subjectQ.data ?? null;
  const claimQ = useQuery({
    queryKey: ["interview-claim", kind, id],
    queryFn: () => loadClaimSource(subject!),
    enabled: !!subject,
  });
  const briefFn = useServerFn(getCategoryBrief);
  const briefQ = useQuery({
    queryKey: ["category-brief", subject?.gcid],
    queryFn: () => briefFn({ data: { gcid: subject!.gcid! } }),
    enabled: !!subject?.gcid,
    staleTime: 10 * 60_000,
  });
  const runFn = useServerFn(runSkill);

  const [runs, setRuns] = useState<Partial<Record<OrganizePhase, SkillRun>>>({});
  const [liveConfirm, setLiveConfirm] = useState<SkillRun | null>(null);
  /** Live organize attempts (owner-approved). A refused live run never replaces the preview. */
  const [liveRuns, setLiveRuns] = useState<SkillRun[]>([]);
  const [liveOk, setLiveOk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tapped, setTapped] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [approved, setApproved] = useState(false);
  const [detail, setDetail] = useState<SkillRun | null>(null);

  const brief = briefQ.data ?? null;
  const entityType = brief ? interviewEntityType(brief, kind) : null;
  const claim = claimQ.data ? claimStepModel(claimQ.data) : null;
  const sweep = useMemo(() => (runs.sweep ? sweepModel(runs.sweep) : null), [runs.sweep]);
  const extract = capabilityOutput<ExtractResult>(runs.extract ?? null, "nlp_extract");
  const review = useMemo(
    () => (brief && extract?.nodes ? reviewModel(brief, extract) : null),
    [brief, extract],
  );
  const tappedSet =
    tapped ?? new Set(sweep?.rows.filter((r) => r.likelyYou).map((r) => r.url) ?? []);
  const selectedSet = selected ?? new Set(review?.defaultSelected ?? []);

  if (subjectQ.isLoading) return <SeatLoading />;
  if (!subject) return <EmptyState title="Profile not found" />;
  if (!subject.gcid)
    return (
      <EmptyState
        title="No category on file"
        description="The interview is driven by the category brief; this record has no gcid."
      />
    );
  if (briefQ.isLoading || !brief) return <SeatLoading />;
  if (!entityType)
    return (
      <EmptyState
        title="Category brief has no entity types"
        description={`${brief.displayName} (${brief.gcid}) is not projected yet.`}
      />
    );

  // Live only after a preview exists and the owner ticked approval.
  const liveMode: RunMode = liveOk && runs.sweep ? "live" : "dry_run";
  const baseInputs = { gcid: brief.gcid, entity_type: entityType, entity_name: subject.name };

  async function exec(
    phase: OrganizePhase,
    mode: RunMode,
    inputs: Record<string, unknown>,
  ): Promise<SkillRun> {
    const r = (await runFn({
      data: {
        skillKey: ORGANIZE_SKILLS[phase],
        entityId: id,
        mode,
        trigger: "scripted",
        inputs,
        approval:
          mode === "live" ? { approved: true, consent: true } : { approved: false, consent: false },
      },
    })) as SkillRun;
    if (mode === "live" && phase !== "confirm") {
      setLiveRuns((x) => [...x, r]);
      if (r.verdict !== "executed")
        throw new Error(
          `${r.skill_key} live run ${r.verdict}: ${runView(r, []).blockers[0] ?? r.error ?? "refused"} — keeping the preview`,
        );
    }
    return r;
  }

  async function step(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const organize = (mode: RunMode) =>
    step("sweep", async () => {
      const r = await exec("sweep", mode, sweepInputs(subject, brief, entityType));
      setRuns({ sweep: r });
      setTapped(null);
      setSelected(null);
      setPicks({});
      setLiveConfirm(null);
    });

  const hopAndExtract = (mode: RunMode) =>
    step("extract", async () => {
      if (!sweep) return;
      const hop = await exec("hop", mode, hopInputs(sweep, [...tappedSet], baseInputs));
      const pages = organizedPages(sweep, hop);
      if (!pages.length) {
        setRuns((r) => ({ ...r, hop, extract: undefined }));
        toast.error("No readable pages yet — nothing to extract.");
        return;
      }
      const ex = await exec("extract", mode, extractInputs(pages, baseInputs));
      setRuns((r) => ({ ...r, hop, extract: ex }));
      setSelected(null);
      setPicks({});
      setLiveConfirm(null);
    });

  const confirm = (mode: RunMode) =>
    step(`confirm-${mode}`, async () => {
      if (!extract) return;
      const nodes = confirmedNodes(brief, extract, selectedSet, picks);
      const r = await exec("confirm", mode, confirmInputs(nodes, extract));
      if (mode === "live") setLiveConfirm(r);
      else setRuns((x) => ({ ...x, confirm: r }));
    });

  const allRuns = [
    runs.sweep,
    runs.hop,
    runs.extract,
    runs.confirm,
    liveConfirm,
    ...liveRuns,
  ].filter((r): r is SkillRun => !!r);
  const toggle = (set: Set<string>, k: string, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(k);
    else n.delete(k);
    return n;
  };
  const conflictsOpen = review ? review.conflicts.filter((c) => picks[c.key] == null).length : 0;
  const confirmCount = review ? selectedSet.size + Object.keys(picks).length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="NORA interview"
        title={`Let's organize ${subject.name}`}
        description={`${brief.displayName} · interviewed as ${brief.labels.entityNoun.toLowerCase()} (${entityType}). Mostly no typing: NORA finds it, you tap what's yours.`}
      />

      {/* Step 1 — claim + silent verification */}
      <Panel
        title="1 · Claim + silent verification"
        description="Read from the claim flow — NORA verifies from signals it already holds before asking anything."
      >
        {!claim ? (
          <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-ink-3)]" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Claim"
                value={
                  claim.state === "claimed"
                    ? "Claimed"
                    : claim.state === "pending"
                      ? "Pending"
                      : "Unclaimed"
                }
                tone={claim.state === "claimed" ? "green" : "yellow"}
                icon={<ShieldCheck className="h-4 w-4" />}
              />
              <StatTile
                label="Trust tier"
                value={claim.tier != null ? `T${claim.tier}` : "—"}
                hint={claim.tierLabel}
                tone="blue"
              />
              <StatTile
                label="Verification confidence"
                value={claim.confidence != null ? `${claim.confidence}/100` : "—"}
                hint={claim.method ?? undefined}
                tone="neutral"
              />
            </div>
            <p className="text-sm text-[color:var(--color-ink-2)]">{claim.summary}</p>
            {claim.signals.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {claim.signals.map((s) => (
                  <Badge
                    key={s.key}
                    variant={s.matched ? "default" : "outline"}
                    className="text-xs"
                  >
                    {s.matched ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                    {s.label}
                  </Badge>
                ))}
              </div>
            )}
            {claim.state !== "claimed" && isPro && (
              <p className="text-xs text-[color:var(--color-ink-3)]">
                Not claimed yet? The claim page verifies in one tap with Google.
              </p>
            )}
          </div>
        )}
      </Panel>

      {/* Step 2 — organize the internet */}
      <Panel
        title="2 · Organize the internet"
        description={`Website on file → owned sites → a "${brief.displayName} ${subject.name}" web sweep → facts read against the ${brief.displayName} brief.`}
        actions={
          <Button size="sm" onClick={() => organize(liveMode)} disabled={!!busy}>
            {busy === "sweep" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1 h-4 w-4" />
            )}
            {sweep ? (liveMode === "live" ? "Run again live" : "Run again") : "Start"}
          </Button>
        }
      >
        {!sweep ? (
          <EmptyState
            compact
            icon={<Globe className="h-4 w-4" />}
            title={subject.websiteUrl ? `Start with ${subject.websiteUrl}` : "No website on file"}
            description="Runs as a preview (dry run): pages are read, nothing is saved."
          />
        ) : (
          <div className="space-y-6">
            <RunLine run={runs.sweep!} needs={NEEDS.sweep} onOpen={setDetail} />
            <div className="space-y-1">
              <p className={label}>Website on file</p>
              <p className="text-sm text-ink">
                {sweep.website.url ?? "none"}{" "}
                {sweep.website.url ? <Chip v={sweep.website.ok ? "active" : "blocked"} /> : null}
              </p>
              {sweep.website.error && (
                <p className="text-xs text-[color:var(--color-ink-3)]">{sweep.website.error}</p>
              )}
              {sweep.website.ownedUrls.length > 0 && (
                <p className="text-xs text-[color:var(--color-ink-2)]">
                  Owned sites linked from it: {sweep.website.ownedUrls.join(", ")}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className={label}>Tap the ones that are you</p>
              {sweep.status !== "live" ? (
                <EmptyState
                  compact
                  title="Web sweep is still looking"
                  description={sweep.reason ?? "The sweep did not run."}
                />
              ) : sweep.rows.length === 0 ? (
                <EmptyState compact title="Nothing found on the open web" />
              ) : (
                <ul className="space-y-2">
                  {sweep.rows.map((r) => (
                    <li
                      key={r.url}
                      className="flex items-start gap-3 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2.5"
                    >
                      <Checkbox
                        className="mt-1"
                        checked={tappedSet.has(r.url)}
                        onCheckedChange={(v) => setTapped(toggle(tappedSet, r.url, v === true))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {r.title || r.url}
                        </span>
                        <span className="block truncate text-xs text-[color:var(--color-ink-3)]">
                          {r.url}
                        </span>
                        {r.snippet && (
                          <span className="block text-xs text-[color:var(--color-ink-2)]">
                            {r.snippet}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-wrap gap-1">
                        {r.platform && (
                          <Badge variant="outline" className="text-[10px]">
                            {r.platform}
                          </Badge>
                        )}
                        {r.matches.map((m) => (
                          <Badge key={m} variant="secondary" className="text-[10px]">
                            {m}
                          </Badge>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => hopAndExtract(runs.extract ? liveMode : "dry_run")}
                disabled={!!busy}
              >
                {busy === "extract" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Follow my sites and read the facts
              </Button>
              {runs.hop && <RunLine run={runs.hop} needs={NEEDS.hop} onOpen={setDetail} />}
              {runs.extract && (
                <RunLine run={runs.extract} needs={NEEDS.extract} onOpen={setDetail} />
              )}
            </div>
            <label className="flex items-start gap-2 text-xs text-[color:var(--color-ink-2)]">
              <Checkbox
                className="mt-0.5"
                checked={liveOk}
                onCheckedChange={(v) => setLiveOk(v === true)}
              />
              <span>
                After this preview, run it live with my approval (live adds the model read for
                anything the pages didn't spell out; every run is logged).
              </span>
            </label>
            {liveRuns.length > 0 && (
              <div className="flex flex-col gap-1">
                {liveRuns.map((r) => (
                  <RunLine key={r.id} run={r} needs={[]} onOpen={setDetail} />
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {review && extract && (
        <Panel
          title={`What NORA found for your ${brief.labels.entityNoun.toLowerCase()} profile`}
          description="Everything is ticked; un-tick what isn't yours. Each fact cites the page it came from."
        >
          <div className="space-y-6">
            {review.fields.length > 0 && (
              <div className="space-y-2">
                <p className={label}>Details</p>
                <ul className="space-y-2">
                  {review.fields.map((f) => (
                    <li key={f.id} className="flex items-start gap-3">
                      <Checkbox
                        className="mt-1"
                        checked={selectedSet.has(f.id)}
                        onCheckedChange={(v) => setSelected(toggle(selectedSet, f.id, v === true))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-[color:var(--color-ink-3)]">
                          {f.label}
                        </span>
                        <span className="block text-sm text-ink" title={f.evidence}>
                          {f.value}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {review.conflicts.length > 0 && (
              <div className="space-y-3">
                <p className={label}>Pick the right one</p>
                {review.conflicts.map((c) => (
                  <div
                    key={c.key}
                    className="space-y-2 rounded-xl border border-[color:var(--color-hairline)] px-3 py-2.5"
                  >
                    <p className="text-sm font-medium text-ink">
                      {c.label} — we found {c.options.length}
                    </p>
                    <RadioGroup
                      value={picks[c.key] != null ? String(picks[c.key]) : undefined}
                      onValueChange={(v) => setPicks((p) => ({ ...p, [c.key]: Number(v) }))}
                    >
                      {c.options.map((o, i) => (
                        <label key={`${c.key}-${i}`} className="flex items-start gap-2 text-sm">
                          <RadioGroupItem value={String(i)} className="mt-0.5" />
                          <span className="min-w-0">
                            <span className="block text-ink">{o.value}</span>
                            <span className="block truncate text-xs text-[color:var(--color-ink-3)]">
                              {o.sourceUrl}
                            </span>
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </div>
                ))}
              </div>
            )}

            {review.collections.map((c) => (
              <CollectionBlock
                key={c.key}
                c={c}
                selected={selectedSet}
                onChange={(ids, on) => {
                  const n = new Set(selectedSet);
                  for (const k of ids) {
                    if (on) n.add(k);
                    else n.delete(k);
                  }
                  setSelected(n);
                }}
              />
            ))}

            {review.missing.length > 0 && (
              <p className="text-xs text-[color:var(--color-ink-3)]">
                Not found on your pages yet: {review.missing.join(", ")}.
              </p>
            )}

            <div className="space-y-3 border-t border-[color:var(--color-hairline)] pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => confirm("dry_run")}
                  disabled={!!busy || confirmCount === 0}
                >
                  {busy === "confirm-dry_run" ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  Preview save ({confirmCount})
                </Button>
                {runs.confirm && (
                  <RunLine run={runs.confirm} needs={NEEDS.confirm} onOpen={setDetail} />
                )}
              </div>
              <label className="flex items-start gap-2 text-sm text-ink">
                <Checkbox
                  className="mt-0.5"
                  checked={approved}
                  onCheckedChange={(v) => setApproved(v === true)}
                />
                <span>
                  These are mine. I approve NORA saving them to my profile as owner-verified facts.
                  {conflictsOpen > 0
                    ? ` (${conflictsOpen} unpicked ${conflictsOpen === 1 ? "choice is" : "choices are"} held back.)`
                    : ""}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => confirm("live")}
                  disabled={
                    !!busy || !approved || !runs.confirm || !claim?.canConfirm || confirmCount === 0
                  }
                >
                  {busy === "confirm-live" ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  Confirm and save
                </Button>
                {!claim?.canConfirm && (
                  <span className="text-xs text-[color:var(--color-ink-3)]">
                    Saving needs a verified claim.
                  </span>
                )}
                {claim?.canConfirm && !runs.confirm && (
                  <span className="text-xs text-[color:var(--color-ink-3)]">
                    Preview the save first.
                  </span>
                )}
                {liveConfirm && (
                  <RunLine run={liveConfirm} needs={NEEDS.confirm} onOpen={setDetail} />
                )}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {allRuns.length > 0 && (
        <p className="text-xs text-[color:var(--color-ink-3)]">
          {allRuns.length} skill {allRuns.length === 1 ? "run" : "runs"} logged to exp_skill_run
          this session.
        </p>
      )}

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              {detail?.skill_key} · {detail?.mode}
            </SheetTitle>
          </SheetHeader>
          {detail && (
            <div className="mt-3">
              <SkillRunDetail run={detail} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RunLine({
  run,
  needs,
  onOpen,
}: {
  run: SkillRun;
  needs: string[];
  onOpen: (r: SkillRun) => void;
}) {
  const v = runView(run, needs);
  const saved = run.mode === "live" && v.verdict === "executed";
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <Chip v={v.verdict} />
      <span className="text-[color:var(--color-ink-2)]">
        {v.skill} · {v.mode === "dry_run" ? "preview" : "live"}
        {saved ? " · saved" : ""}
        {v.mode === "live" && !saved && v.blockers.length ? ` · ${v.blockers[0]}` : ""}
        {v.error ? ` · ${v.error}` : ""}
      </span>
      <button
        type="button"
        className="text-[color:var(--color-g-blue)] hover:underline"
        onClick={() => onOpen(run)}
      >
        details
      </button>
    </span>
  );
}

/** Cardinality UI from the brief: few → chips; many → compact list with select-all; one → field. */
function CollectionBlock({
  c,
  selected,
  onChange,
}: {
  c: ReviewCollection;
  selected: Set<string>;
  onChange: (ids: string[], on: boolean) => void;
}) {
  const ids = c.items.map((i) => i.id);
  const n = ids.filter((k) => selected.has(k)).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <p className={label}>{c.label}</p>
        <span className="text-xs text-[color:var(--color-ink-3)]">
          {n}/{c.items.length}
        </span>
        {c.bulk && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => onChange(ids, true)}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(ids, false)}>
              Clear
            </Button>
          </span>
        )}
      </div>
      {c.ui === "chips" ? (
        <div className="flex flex-wrap gap-2">
          {c.items.map((i) => (
            <Button
              key={i.id}
              size="sm"
              variant={selected.has(i.id) ? "default" : "outline"}
              title={i.evidence}
              onClick={() => onChange([i.id], !selected.has(i.id))}
            >
              {i.title}
            </Button>
          ))}
        </div>
      ) : (
        <ul className="max-h-80 divide-y divide-[color:var(--color-hairline)] overflow-auto rounded-xl border border-[color:var(--color-hairline)]">
          {c.items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-3 py-1.5">
              <Checkbox
                className="mt-0.5"
                checked={selected.has(i.id)}
                onCheckedChange={(v) => onChange([i.id], v === true)}
              />
              <span className="min-w-0 flex-1 text-sm text-ink" title={i.evidence}>
                {i.title}
                {i.detail && (
                  <span className="ml-2 text-xs text-[color:var(--color-ink-3)]">{i.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
