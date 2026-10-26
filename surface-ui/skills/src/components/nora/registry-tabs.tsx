import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FlaskConical, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/shared/components/ui/button";
import { Input } from "@v3/shared/components/ui/input";
import { Textarea } from "@v3/shared/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@v3/shared/components/ui/sheet";
import { DataTable, EmptyState, Panel, type Column } from "@v3/shared/components/ui/console-primitives";
import {
  BUILD_STATES,
  SKILL_STATUSES,
  TRACKS,
  agentCard,
  capabilityUsage,
  ENTITY_TYPES,
  addBuildStep,
  listEvals,
  listVersions,
  publishBlockers,
  skillReadiness,
  publishSkill,
  setEvalResult,
  upsertEval,
  yankSkill,
  type SkillEval,
  listBuildMap,
  listCapabilities,
  listSkills,
  missingCapabilities,
  skillCoverage,
  setBuildState,
  upsertCapability,
  upsertSkill,
  type BuildStep,
  type Capability,
  type Skill,
} from "@v3/skills/utils/nora-registry";
import { cn } from "@v3/shared/components/utils/utils";

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

function EntityChips({ types }: { types: string[] | null | undefined }) {
  if (!types?.length) return <span className="text-xs text-[#c5221f]">none</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.map((t) => (
        <span key={t} className="rounded-md bg-[color:var(--color-g-blue-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--color-g-blue)]">{t}</span>
      ))}
    </span>
  );
}
const splitList = (v: unknown) => String(v ?? "").split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export function Chip({ v }: { v: string | null | undefined }) {
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[v ?? ""] ?? STATUS_TONE.draft)}>
      {v ?? "—"}
    </span>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs text-ink">{children}</span>;
const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-xs text-[color:var(--color-ink-2)]">{children}</span>;
const list = (a: string[] | null | undefined) => (a?.length ? a.join(", ") : "—");

/* ───────── Generic manifest form ───────── */
type Field = { k: string; label: string; kind: "text" | "area" | "list" | "bool" | "json" | "select" | "multi" | "number"; options?: readonly string[]; help?: string };
type Section = { title: string; help?: string; fields: Field[]; showIf?: (d: Record<string, string | boolean>) => boolean; alwaysShow?: string[] };

function toDraft(row: Record<string, unknown>, fields: Field[]) {
  const d: Record<string, string | boolean> = {};
  for (const f of fields) {
    const v = row[f.k];
    if (f.kind === "list" || f.kind === "multi") d[f.k] = Array.isArray(v) ? v.join("\n") : "";
    else if (f.kind === "json") d[f.k] = v == null ? "" : JSON.stringify(v, null, 2);
    else if (f.kind === "bool") d[f.k] = !!v;
    else if (f.kind === "number") d[f.k] = v == null ? "" : String(v);
    else d[f.k] = (v as string) ?? "";
  }
  return d;
}
function fromDraft(d: Record<string, string | boolean>, fields: Field[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = d[f.k];
    if (f.kind === "list" || f.kind === "multi") out[f.k] = String(v).split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    else if (f.kind === "json") {
      const s = String(v).trim();
      out[f.k] = s ? JSON.parse(s) : null;
    } else if (f.kind === "bool") out[f.k] = !!v;
    else if (f.kind === "number") {
      const t = String(v ?? "").trim();
      if (t && !Number.isFinite(Number(t))) throw new Error(`${f.label} must be a number`);
      out[f.k] = t ? Math.round(Number(t)) : null;
    }
    else out[f.k] = String(v).trim() || null;
  }
  return out;
}

function ManifestForm({
  fields,
  draft,
  setDraft,
}: {
  fields: Field[];
  draft: Record<string, string | boolean>;
  setDraft: (d: Record<string, string | boolean>) => void;
}) {
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <label key={f.k} className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">
            {f.label}
            {f.kind === "list" ? " (one per line)" : ""}
          </span>
          {f.help ? <span className="mb-1 block text-[11px] text-[color:var(--color-ink-2)]">{f.help}</span> : null}
          {f.kind === "number" ? (
            <Input type="number" value={String(draft[f.k] ?? "")} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
          ) : f.kind === "multi" ? (
            <span className="flex flex-wrap gap-1.5">
              {f.options!.map((o) => {
                const cur = splitList(draft[f.k]);
                const on = cur.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setDraft({ ...draft, [f.k]: (on ? cur.filter((x) => x !== o) : [...cur, o]).join("\n") })}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs font-semibold",
                      on
                        ? "border-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]"
                        : "border-[color:var(--color-hairline)] text-[color:var(--color-ink-2)]",
                    )}
                  >
                    {o}
                  </button>
                );
              })}
            </span>
          ) : f.kind === "bool" ? (
            <input type="checkbox" checked={!!draft[f.k]} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.checked })} />
          ) : f.kind === "select" ? (
            <select
              value={String(draft[f.k] ?? "")}
              onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {f.options!.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : f.kind === "text" ? (
            <Input value={String(draft[f.k] ?? "")} onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })} />
          ) : (
            <Textarea
              rows={f.kind === "json" ? 5 : 3}
              className={f.kind === "json" ? "font-mono text-xs" : ""}
              value={String(draft[f.k] ?? "")}
              onChange={(e) => setDraft({ ...draft, [f.k]: e.target.value })}
            />
          )}
        </label>
      ))}
    </div>
  );
}

/* ───────── Skills ───────── */
const SKILL_SECTIONS: Section[] = [
  {
    title: "1 · Identity",
    help: "Who this skill is and who it may run on.",
    fields: [
      { k: "key", label: "Key", kind: "text", help: "Stable machine id — agents, evals and versions reference it." },
      { k: "title", label: "Title", kind: "text", help: "What a person sees in the queue." },
      { k: "summary", label: "Summary", kind: "area", help: "One line on what it does — shown on the agent card." },
      { k: "value_loop", label: "Value loop", kind: "text", help: "Which growth loop it feeds, so wins roll up correctly." },
      { k: "owning_surface", label: "Owning surface", kind: "text", help: "Where the result lives in the product." },
      { k: "entity_types", label: "Entity types", kind: "multi", options: ENTITY_TYPES, help: "Guardrail — the skill only runs on these entity types." },
      { k: "version", label: "Version", kind: "text", help: "Bumped on each publish so history is traceable." },
      { k: "status", label: "Status", kind: "select", options: SKILL_STATUSES, help: "Published only when the readiness checklist and evals pass." },
      { k: "is_active", label: "Active", kind: "bool", help: "Inactive skills are never proposed." },
    ],
  },
  {
    title: "2 · Trigger & reasoning",
    help: "When NORA considers this skill and how much she thinks.",
    fields: [
      { k: "triggers", label: "Triggers", kind: "list", help: "Events or conditions that wake the skill — at least one." },
      { k: "reads_state", label: "Reads state", kind: "list", help: "The data it needs; also drives the token estimate." },
      { k: "autonomy", label: "Autonomy", kind: "select", options: ["approve", "auto"], help: "approve = a person confirms first; auto = runs on its own." },
      { k: "model_tier", label: "Model tier", kind: "select", options: ["deterministic", "haiku", "sonnet", "opus"], help: "Cheapest tier that does the job — deterministic costs nothing." },
      { k: "gap_closed", label: "Gap closed", kind: "area", help: "The specific gap this skill closes." },
    ],
  },
  {
    title: "3 · Capabilities & graph effect",
    help: "A skill does work by extending the graph — declare what it writes and the points it should earn, so NORA can report the real result.",
    fields: [
      { k: "tools_used", label: "Tools used", kind: "list", help: "Capability keys it calls — every one must be registered." },
      { k: "graph_writes", label: "Graph writes", kind: "list", help: "Node types it creates, e.g. article, listing, review, bio." },
      { k: "affects_lanes", label: "Affects lanes", kind: "list", help: "SRS lanes it moves, e.g. Articles, Completeness." },
      { k: "expected_srs_lift", label: "Expected SRS lift (points)", kind: "number", help: "Points it should earn — compared against the actual result." },
    ],
  },
  {
    title: "4 · Entitlement & the sell",
    help: "Every skill is available to everyone. If the user lacks the product, NORA explains the blocked value and offers it — she never silently skips. A declined paid feature is muted for N days, not permanently.",
    alwaysShow: ["requires_entitlement"],
    showIf: (d) => !!String(d.requires_entitlement ?? "").trim(),
    fields: [
      { k: "requires_entitlement", label: "Requires entitlement", kind: "text", help: "Product the user must own, e.g. voce, listings_mgmt. Leave blank if none." },
      { k: "value_prop", label: "Value prop", kind: "area", help: "Gap-specific why — what they unlock by buying." },
      { k: "offer_expected_points", label: "Offer expected points", kind: "number", help: "SRS points the offer should earn them." },
      { k: "offer_ranking_effect", label: "Offer ranking effect", kind: "text", help: "Plain-language ranking outcome, e.g. 'top 3 locally'." },
      { k: "price_ref", label: "Price ref", kind: "text", help: "Price book key — prices are never hardcoded." },
      { k: "trial_eligible", label: "Trial eligible", kind: "bool", help: "Lets NORA offer a trial instead of a purchase." },
      { k: "decline_mute_days", label: "Decline mute days", kind: "number", help: "How long a decline silences the offer (default 14, minimum 1)." },
      { k: "permanently_dismissible", label: "Permanently dismissible", kind: "bool", help: "Discouraged for paid features — prefer a timed mute." },
    ],
  },
  {
    title: "5 · Approval & money",
    help: "Anything that spends money must be approved and consented.",
    fields: [
      { k: "requires_user_approval", label: "Requires user approval", kind: "bool", help: "User confirms before it acts." },
      { k: "charges_money", label: "Charges money", kind: "bool", help: "If on, approval and consent are mandatory." },
      { k: "captures_consent", label: "Captures consent", kind: "bool", help: "Records explicit consent for the action." },
    ],
  },
  {
    title: "6 · Execution & reporting",
    help: "How it runs and how its results are proven.",
    fields: [
      { k: "is_async", label: "Async", kind: "bool", help: "Runs in the background rather than immediately." },
      { k: "estimated_duration", label: "Estimated duration", kind: "text", help: "e.g. '2 min' or '3 days' — sets user expectations." },
      { k: "produces_report", label: "Produces report", kind: "bool", help: "Generates a result summary for the user." },
      { k: "tracks_results", label: "Tracks results", kind: "bool", help: "Measures outcome after running — needs metrics." },
      { k: "result_metrics", label: "Result metrics", kind: "list", help: "What is measured, e.g. srs_delta, impressions." },
      { k: "report_to_weekly_digest", label: "Report to weekly digest", kind: "bool", help: "Surfaces the result in the weekly digest." },
      { k: "success_event", label: "Success event", kind: "text", help: "Event emitted on success — downstream steps listen for it." },
    ],
  },
  {
    title: "7 · Guardrails & voice",
    help: "What NORA must never do, and how she explains herself.",
    fields: [
      { k: "guardrails", label: "Guardrails", kind: "list", help: "Hard rules — compliance, tone, limits." },
      { k: "explanation_template", label: "Explanation template", kind: "area", help: "How NORA explains the move to the user." },
    ],
  },
];
const SKILL_FIELDS: Field[] = SKILL_SECTIONS.flatMap((x) => x.fields);

const CAP_FIELDS: Field[] = [
  { k: "key", label: "Key", kind: "text" },
  { k: "title", label: "Title", kind: "text" },
  { k: "status", label: "Status", kind: "select", options: SKILL_STATUSES },
  { k: "version", label: "Version", kind: "text" },
  { k: "owning_surface", label: "Owning surface", kind: "text" },
  { k: "description", label: "Description", kind: "area" },
  { k: "transport", label: "Transport", kind: "text" },
  { k: "entitlement_required", label: "Entitlement required", kind: "text" },
  { k: "inputs", label: "Inputs (JSON)", kind: "json" },
  { k: "outputs", label: "Outputs (JSON)", kind: "json" },
  { k: "reads_state", label: "Reads state", kind: "list" },
  { k: "side_effects", label: "Side effects", kind: "list" },
  { k: "events_emitted", label: "Events emitted", kind: "list" },
  { k: "idempotent_key", label: "Idempotent key", kind: "text" },
  { k: "dry_run", label: "Supports dry run", kind: "bool" },
];

const BLANK_SKILL = { key: "", status: "draft", version: "0.1.0", is_active: true } as unknown as Skill;
const BLANK_CAP = { key: "", status: "draft", version: "0.1.0", dry_run: false } as unknown as Capability;

function Editor<T extends { id?: string; key: string }>({
  row,
  fields,
  onClose,
  save,
  queryKey,
  title,
  extra,
  sections,
}: {
  row: T | null;
  fields: Field[];
  onClose: () => void;
  save: (r: T) => Promise<T>;
  queryKey: string;
  title: string;
  extra?: (draft: Record<string, string | boolean>) => React.ReactNode;
  sections?: Section[];
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  useEffect(() => {
    if (row) setDraft(toDraft(row as unknown as Record<string, unknown>, fields));
  }, [row, fields]);
  const m = useMutation({
    mutationFn: () => {
      const data = fromDraft(draft, fields);
      if (!data.key) throw new Error("Key is required");
      if (sections && !data.title) throw new Error("Title is required");
      return save({ ...(row?.id ? { id: row.id } : {}), ...data } as T);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      toast.success("Saved");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{row?.id ? `${title}: ${row.key}` : `New ${title.toLowerCase()}`}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5 px-1 pb-8">
          {extra?.(draft)}
          {sections ? (
            sections.map((sec) => {
              const open = !sec.showIf || sec.showIf(draft);
              const shown = open ? sec.fields : sec.fields.filter((f) => sec.alwaysShow?.includes(f.k));
              return (
                <section key={sec.title} className="rounded-[12px] border border-[color:var(--color-hairline)] p-3">
                  <h3 className="text-sm font-semibold text-ink">{sec.title}</h3>
                  {sec.help ? <p className="mb-3 mt-0.5 text-xs text-[color:var(--color-ink-2)]">{sec.help}</p> : null}
                  <ManifestForm fields={shown} draft={draft} setDraft={setDraft} />
                </section>
              );
            })
          ) : (
            <ManifestForm fields={fields} draft={draft} setDraft={setDraft} />
          )}
          <div className="flex gap-2">
            <Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Saving…" : "Save"}</Button>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function SkillsTab() {
  const skills = useQuery({ queryKey: ["nora-skills"], queryFn: listSkills });
  const caps = useQuery({ queryKey: ["nora-caps"], queryFn: listCapabilities });
  const [open, setOpen] = useState<Skill | null>(null);
  const [openCap, setOpenCap] = useState<Capability | null>(null);
  const qc = useQueryClient();
  const skillEvals = useQuery({ queryKey: ["nora-evals", open?.key], queryFn: () => listEvals(open!.key), enabled: !!open?.key });
  const versions = useQuery({ queryKey: ["nora-versions", open?.key], queryFn: () => listVersions(open!.key), enabled: !!open?.key });
  const saveSkill = async (r: Skill) => {
    const saved = r.status === "published" && open?.status !== "published" ? await publishSkill(r) : await upsertSkill(r);
    qc.invalidateQueries({ queryKey: ["nora-versions"] });
    return saved;
  };
  const yank = useMutation({
    mutationFn: (s: Skill) => yankSkill(s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nora-skills"] });
      qc.invalidateQueries({ queryKey: ["nora-versions"] });
      toast.success("Yanked — skill deprecated");
      setOpen(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const capKeys = useMemo(() => (caps.data ?? []).map((c) => c.key), [caps.data]);
  const fullyCovered = useMemo(
    () => (skills.data ?? []).filter((s) => (s.tools_used ?? []).length > 0 && skillCoverage(s.tools_used, capKeys).missing.length === 0).length,
    [skills.data, capKeys],
  );

  const columns: Column<Skill>[] = [
    { key: "title", header: "Skill", cell: (s) => <div><p className="font-medium text-ink">{s.title ?? s.key}</p><Mono>{s.key}</Mono></div> },
    { key: "loop", header: "Value loop", cell: (s) => <Muted>{s.value_loop ?? "—"}</Muted> },
    { key: "surface", header: "Surface", cell: (s) => <Muted>{s.owning_surface ?? "—"}</Muted> },
    { key: "status", header: "Status", cell: (s) => <Chip v={s.status} /> },
    { key: "entities", header: "Entity types", cell: (s) => <EntityChips types={s.entity_types} /> },
    { key: "tier", header: "Model tier", cell: (s) => <Muted>{s.model_tier ?? "—"}</Muted> },
    { key: "autonomy", header: "Autonomy", cell: (s) => <Muted>{s.autonomy ?? "—"}</Muted> },
    { key: "version", header: "Version", align: "right", cell: (s) => <Mono>{s.version ?? "—"}</Mono> },
    {
      key: "coverage",
      header: "Coverage",
      align: "right",
      cell: (s) => {
        const tools = s.tools_used ?? [];
        if (!tools.length) return <Muted>No tools</Muted>;
        const { covered, missing } = skillCoverage(tools, capKeys);
        return (
          <span
            className={cn(
              "inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold",
              missing.length === 0
                ? "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]"
                : "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
            )}
            title={missing.length ? `Missing: ${missing.join(", ")}` : "All tools covered"}
          >
            {covered.length}/{tools.length} tools
          </span>
        );
      },
    },
    {
      key: "gaps",
      header: "",
      align: "right",
      cell: (s) =>
        caps.data && missingCapabilities(s.tools_used, capKeys).length ? (
          <span className="inline-flex items-center gap-1 text-xs text-[#c5221f]"><AlertTriangle className="h-3.5 w-3.5" />missing capability</span>
        ) : null,
    },
  ];

  return (
    <Panel
      title="Skills"
      description={
        skills.data?.length
          ? `Every skill NORA can run, with its manifest and publish status. ${fullyCovered} of ${skills.data.length} skills fully covered.`
          : "Every skill NORA can run, with its manifest and publish status."
      }
      bodyClassName="px-3 py-2"
      actions={<Button size="sm" onClick={() => setOpen({ ...BLANK_SKILL })}><Plus className="mr-1.5 h-4 w-4" />New skill</Button>}
    >
      <DataTable
        columns={columns}
        rows={skills.data ?? []}
        loading={skills.isLoading}
        getRowKey={(s) => s.id ?? s.key}
        onRowClick={(s) => setOpen(s)}
        empty={<EmptyState title="No skills yet" description={skills.error ? (skills.error as Error).message : "Create the first skill manifest."} compact />}
      />
      <Editor<Skill>
        row={open}
        fields={SKILL_FIELDS}
        sections={SKILL_SECTIONS}
        onClose={() => setOpen(null)}
        save={saveSkill}
        queryKey="nora-skills"
        title="Skill"
        extra={(d) => {
          const tools = String(d.tools_used ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
          const missing = new Set(missingCapabilities(tools, capKeys));
          return (
            <>
              <div className="rounded-[12px] border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">Card the agent sees</p>
                <p className="mt-1 font-mono text-xs text-ink">{agentCard({ key: String(d.key || "—"), status: String(d.status || "draft"), version: String(d.version || "") || null, entity_types: splitList(d.entity_types) })}</p>
                <div className="mt-1.5"><EntityChips types={splitList(d.entity_types)} /></div>
                <p className="mt-1 text-xs text-[color:var(--color-ink-2)]">{String(d.summary || "") || "No summary."}</p>
              </div>
              {(() => {
                let parsed: Record<string, unknown> = {};
                try { parsed = fromDraft(d, SKILL_FIELDS); } catch { parsed = { tools_used: tools, entity_types: splitList(d.entity_types) }; }
                const ready = skillReadiness(parsed);
                const reasons = publishBlockers(parsed, capKeys, skillEvals.data ?? []);
                const wantsPublish = d.status === "published" && open?.status !== "published";
                return (
                  <div
                    className={cn(
                      "rounded-[12px] border p-3 text-xs",
                      reasons.length
                        ? wantsPublish
                          ? "border-[#c5221f] bg-[color:var(--color-g-red-soft)]"
                          : "border-[color:var(--color-hairline)]"
                        : "border-[color:var(--color-hairline)] bg-[color:var(--color-g-green-soft)]",
                    )}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">Skill readiness</p>
                    <ul className="mt-1 space-y-0.5">
                      {ready.blockers.length === 0 ? <li className="text-[#1e8e3e]">✓ Authoring complete</li> : null}
                      {ready.blockers.map((x) => <li key={x} className="text-[#c5221f]">✗ {x}</li>)}
                      {ready.warnings.map((x) => <li key={x} className="text-[#b06000]">! {x}</li>)}
                    </ul>
                    <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">Publish gate (readiness + coverage + evals)</p>
                    {reasons.length ? (
                      <>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[#c5221f]">
                          {reasons.map((x) => <li key={x}>{x}</li>)}
                        </ul>
                        {wantsPublish ? <p className="mt-1 font-semibold text-[#c5221f]">Saving as published will be blocked.</p> : null}
                      </>
                    ) : (
                      <p className="mt-1 text-[#1e8e3e]">All checks pass — this skill can be published.</p>
                    )}
                  </div>
                );
              })()}
              {open?.id ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">Version history</p>
                    {open.status === "published" ? (
                      <Button size="sm" variant="outline" disabled={yank.isPending} onClick={() => yank.mutate(open)}>Yank</Button>
                    ) : null}
                  </div>
                  {versions.data?.length ? (
                    <ul className="space-y-1">
                      {versions.data.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-2 text-xs">
                          <Mono>{v.version ?? "—"}</Mono>
                          <Chip v={v.status} />
                          <Muted>{v.published_at ? new Date(v.published_at).toLocaleString() : "—"}</Muted>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[color:var(--color-ink-3)]">No versions published yet.</p>
                  )}
                </div>
              ) : null}
              <div>
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">Tools → capabilities</p>
                {tools.length ? (
                  <ul className="space-y-1">
                    {tools.map((t) => {
                      const cap = (caps.data ?? []).find((c) => c.key === t);
                      return (
                        <li key={t} className="flex items-center justify-between gap-2 text-xs">
                          {cap ? (
                            <button
                              type="button"
                              className="font-mono text-xs text-[color:var(--color-g-blue)] underline-offset-2 hover:underline"
                              title="Open capability"
                              onClick={() => setOpenCap(cap)}
                            >
                              {t}
                            </button>
                          ) : (
                            <Mono>{t}</Mono>
                          )}
                          {missing.has(t) ? (
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-[#c5221f]">
                                <AlertTriangle className="h-3 w-3" />
                                no capability registered
                              </span>
                              <button
                                type="button"
                                className="rounded-md bg-[color:var(--color-g-blue-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--color-g-blue)] hover:opacity-80"
                                onClick={() => setOpenCap({ ...BLANK_CAP, key: t })}
                              >
                                Create it
                              </button>
                            </span>
                          ) : (
                            <Chip v={cap?.status} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-[color:var(--color-ink-3)]">No tools listed.</p>
                )}
              </div>
            </>
          );
        }}
      />
      <Editor<Capability>
        row={openCap}
        fields={CAP_FIELDS}
        onClose={() => setOpenCap(null)}
        save={upsertCapability}
        queryKey="nora-caps"
        title="Capability"
      />
    </Panel>
  );
}

export function CapabilitiesTab() {
  const caps = useQuery({ queryKey: ["nora-caps"], queryFn: listCapabilities });
  const skills = useQuery({ queryKey: ["nora-skills"], queryFn: listSkills });
  const [open, setOpen] = useState<Capability | null>(null);
  const [openSkill, setOpenSkill] = useState<Skill | null>(null);
  const usedBy = useMemo(() => capabilityUsage(skills.data ?? []), [skills.data]);
  const columns: Column<Capability>[] = [
    { key: "key", header: "Capability", cell: (c) => <div><p className="font-medium text-ink">{c.title ?? c.key}</p><Mono>{c.key}</Mono></div> },
    { key: "surface", header: "Surface", cell: (c) => <Muted>{c.owning_surface ?? "—"}</Muted> },
    { key: "status", header: "Status", cell: (c) => <Chip v={c.status} /> },
    { key: "transport", header: "Transport", cell: (c) => <Muted>{c.transport ?? "—"}</Muted> },
    { key: "ent", header: "Entitlement", cell: (c) => <Muted>{c.entitlement_required ?? "—"}</Muted> },
    { key: "fx", header: "Side effects", cell: (c) => <Muted>{list(c.side_effects)}</Muted> },
    { key: "dry", header: "Dry run", cell: (c) => <Muted>{c.dry_run ? "Yes" : "No"}</Muted> },
    { key: "ev", header: "Events", cell: (c) => <Muted>{list(c.events_emitted)}</Muted> },
    {
      key: "used",
      header: "Used by",
      align: "right",
      cell: (c) => {
        const n = usedBy.get(c.key)?.length ?? 0;
        return n ? (
          <Muted>{n} skill{n === 1 ? "" : "s"}</Muted>
        ) : (
          <span className="inline-flex rounded-md bg-[color:var(--color-g-yellow-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#b06000]">
            Unused
          </span>
        );
      },
    },
  ];
  return (
    <Panel
      title="Capabilities"
      description="Callable tools skills use, with their contracts and side effects."
      bodyClassName="px-3 py-2"
      actions={<Button size="sm" onClick={() => setOpen({ ...BLANK_CAP })}><Plus className="mr-1.5 h-4 w-4" />New capability</Button>}
    >
      <DataTable
        columns={columns}
        rows={caps.data ?? []}
        loading={caps.isLoading}
        getRowKey={(c) => c.id ?? c.key}
        onRowClick={(c) => setOpen(c)}
        empty={<EmptyState title="No capabilities yet" description={caps.error ? (caps.error as Error).message : "Register the first capability."} compact />}
      />
      <Editor<Capability>
        row={open}
        fields={CAP_FIELDS}
        onClose={() => setOpen(null)}
        save={upsertCapability}
        queryKey="nora-caps"
        title="Capability"
        extra={(d) => {
          const users = usedBy.get(String(d.key ?? "")) ?? [];
          return (
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">Used by skills</p>
              {users.length ? (
                <ul className="space-y-1">
                  {users.map((k) => {
                    const sk = (skills.data ?? []).find((s) => s.key === k);
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          className="font-mono text-xs text-[color:var(--color-g-blue)] underline-offset-2 hover:underline"
                          title="Open skill"
                          onClick={() => sk && setOpenSkill(sk)}
                        >
                          {k}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-[color:var(--color-ink-3)]">No skill references this capability yet.</p>
              )}
            </div>
          );
        }}
      />
      <Editor<Skill>
        row={openSkill}
        fields={SKILL_FIELDS}
        sections={SKILL_SECTIONS}
        onClose={() => setOpenSkill(null)}
        save={upsertSkill}
        queryKey="nora-skills"
        title="Skill"
      />
    </Panel>
  );
}

export function BuildMapTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["nora-build-map"], queryFn: listBuildMap });
  const m = useMutation({
    mutationFn: (v: { id: string; state: string }) => setBuildState(v.id, v.state),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nora-build-map"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  const tracks = Array.from(new Set([...TRACKS, ...rows.map((r) => r.track)]));
  const [adding, setAdding] = useState(false);
  const blank = { track: "customer", step_no: "", title: "", description: "", emits_event: "", consumes_event: "", state: "not_built" };
  const [nd, setNd] = useState(blank);
  const add = useMutation({
    mutationFn: () => {
      if (!nd.title.trim()) throw new Error("Title is required");
      const n = nd.step_no.trim() ? Number(nd.step_no) : null;
      return addBuildStep({
        track: nd.track,
        step_no: n,
        title: nd.title.trim(),
        description: nd.description.trim() || null,
        emits_event: nd.emits_event.trim() || null,
        consumes_event: nd.consumes_event.trim() || null,
        state: nd.state,
        notes: null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nora-build-map"] });
      toast.success("Step added");
      setNd(blank);
      setAdding(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  const addPanel = (
    <div className="flex justify-end">
      <Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" />Add step</Button>
      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>New build step</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-3 px-1 pb-8 text-sm">
            <label className="block">Track
              <select className={sel} value={nd.track} onChange={(e) => setNd({ ...nd, track: e.target.value })}>
                {tracks.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">Step no.<Input type="number" value={nd.step_no} onChange={(e) => setNd({ ...nd, step_no: e.target.value })} /></label>
            <label className="block">Title<Input value={nd.title} onChange={(e) => setNd({ ...nd, title: e.target.value })} /></label>
            <label className="block">Description<Textarea rows={3} value={nd.description} onChange={(e) => setNd({ ...nd, description: e.target.value })} /></label>
            <label className="block">Consumes event<Input value={nd.consumes_event} onChange={(e) => setNd({ ...nd, consumes_event: e.target.value })} /></label>
            <label className="block">Emits event<Input value={nd.emits_event} onChange={(e) => setNd({ ...nd, emits_event: e.target.value })} /></label>
            <label className="block">State
              <select className={sel} value={nd.state} onChange={(e) => setNd({ ...nd, state: e.target.value })}>
                {BUILD_STATES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <Button onClick={() => add.mutate()} disabled={add.isPending}>{add.isPending ? "Adding…" : "Add step"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
  if (!q.isLoading && !rows.length)
    return <div className="space-y-4">{addPanel}<EmptyState title="No build map yet" description={q.error ? (q.error as Error).message : "Add the first build step."} /></div>;
  return (
    <div className="space-y-6">
      {addPanel}
      {tracks.map((t) => {
        const steps = rows.filter((r) => r.track === t);
        if (!steps.length && !q.isLoading) return null;
        return (
          <Panel key={t} title={<span className="capitalize">{t}</span>} description={`${steps.length} steps`}>
            <ul className="divide-y divide-[color:var(--color-hairline)]">
              {steps.map((s: BuildStep) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-8 text-xs tabular-nums text-[color:var(--color-ink-3)]">{s.step_no ?? "—"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{s.title}</p>
                    {s.description ? <p className="text-xs text-[color:var(--color-ink-2)]">{s.description}</p> : null}
                  </div>
                  {s.consumes_event ? <span className="rounded-md bg-[color:var(--color-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--color-ink-2)]">← {s.consumes_event}</span> : null}
                  {s.emits_event ? <span className="rounded-md bg-[color:var(--color-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[color:var(--color-ink-2)]">→ {s.emits_event}</span> : null}
                  <select
                    aria-label="State"
                    value={s.state ?? "not_built"}
                    disabled={m.isPending}
                    onChange={(e) => m.mutate({ id: s.id, state: e.target.value })}
                    className={cn("rounded-md border-0 px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[s.state ?? "not_built"])}
                  >
                    {BUILD_STATES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
    </div>
  );
}

export function EvalsTab() {
  const qc = useQueryClient();
  const evals = useQuery({ queryKey: ["nora-evals", "all"], queryFn: () => listEvals() });
  const skills = useQuery({ queryKey: ["nora-skills"], queryFn: listSkills });
  const [adding, setAdding] = useState(false);
  const blank = { skill_key: "", name: "", fixture: "{}", expected: "{}" };
  const [nd, setNd] = useState(blank);
  const inv = () => qc.invalidateQueries({ queryKey: ["nora-evals"] });
  const add = useMutation({
    mutationFn: () => {
      if (!nd.skill_key) throw new Error("Pick a skill");
      if (!nd.name.trim()) throw new Error("Name is required");
      let fixture: unknown, expected: unknown;
      try { fixture = JSON.parse(nd.fixture || "null"); } catch { throw new Error("Fixture is not valid JSON"); }
      try { expected = JSON.parse(nd.expected || "null"); } catch { throw new Error("Expected is not valid JSON"); }
      return upsertEval({ skill_key: nd.skill_key, name: nd.name.trim(), fixture, expected, status: "untested" } as SkillEval);
    },
    onSuccess: () => { inv(); toast.success("Fixture added"); setNd(blank); setAdding(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  const mark = useMutation({
    mutationFn: (v: { id: string; status: "pass" | "fail" }) => setEvalResult(v.id, v.status),
    onSuccess: inv,
    onError: (e: Error) => toast.error(e.message),
  });
  const groups = useMemo(() => {
    const m = new Map<string, SkillEval[]>();
    for (const e of evals.data ?? []) m.set(e.skill_key, [...(m.get(e.skill_key) ?? []), e]);
    return Array.from(m.entries());
  }, [evals.data]);
  const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="max-w-2xl text-sm text-[color:var(--color-ink-2)]">Fixtures gate publishing: a skill can only be published when every one of its evals passes. Execution is manual for now — mark each result.</p>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" />Add fixture</Button>
      </div>
      {!evals.isLoading && !groups.length ? (
        <EmptyState icon={<FlaskConical className="h-4 w-4" />} title="No eval fixtures yet" description={evals.error ? (evals.error as Error).message : "Add a fixture to start gating a skill."} />
      ) : null}
      {groups.map(([key, list]) => {
        const passing = list.filter((e) => e.status === "pass").length;
        return (
          <Panel key={key} title={<span className="font-mono text-sm">{key}</span>} description={`${passing}/${list.length} passing`}>
            <ul className="divide-y divide-[color:var(--color-hairline)]">
              {list.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{e.name}</p>
                    <Muted>{e.last_run_at ? `Last run ${new Date(e.last_run_at).toLocaleString()}` : "Never run"}</Muted>
                  </div>
                  <Chip v={e.status ?? "untested"} />
                  <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate({ id: e.id!, status: "pass" })}>Pass</Button>
                  <Button size="sm" variant="outline" disabled={mark.isPending} onClick={() => mark.mutate({ id: e.id!, status: "fail" })}>Fail</Button>
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader><SheetTitle>New eval fixture</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-3 px-1 pb-8 text-sm">
            <label className="block">Skill
              <select className={sel} value={nd.skill_key} onChange={(e) => setNd({ ...nd, skill_key: e.target.value })}>
                <option value="">Select…</option>
                {(skills.data ?? []).map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
              </select>
            </label>
            <label className="block">Name<Input value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} /></label>
            <label className="block">Fixture (JSON)<Textarea rows={6} className="font-mono text-xs" value={nd.fixture} onChange={(e) => setNd({ ...nd, fixture: e.target.value })} /></label>
            <label className="block">Expected (JSON)<Textarea rows={6} className="font-mono text-xs" value={nd.expected} onChange={(e) => setNd({ ...nd, expected: e.target.value })} /></label>
            <Button onClick={() => add.mutate()} disabled={add.isPending}>{add.isPending ? "Adding…" : "Add fixture"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
