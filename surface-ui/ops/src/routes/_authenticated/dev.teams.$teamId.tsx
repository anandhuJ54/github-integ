import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Label } from "@v3/ui/components/ui/label";
import { Textarea } from "@v3/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/ui/components/ui/select";
import { GateBadge, NeedsYouBanner } from "@v3/ops/components/dev/needs-you-banner";
import {
  ConsoleTabs,
  DetailDrawer,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
} from "@v3/ui/components/console/primitives";
import {
  ITEM_STATUSES,
  MEMBER_ROLES,
  PRIORITIES,
  PRIORITY_CHIP,
  PROJECT_STATUSES,
  TRACK_META,
  composeBuildPrompt,
  devMutations,
  expectedPct,
  loadTeam,
  markdownToHtml,
  trackOf,
  weightedProgress,
  type DevDoc,
  type Priority,
  type Project,
  type SprintItem,
} from "@v3/ops/lib/dev-progress";
import { cn } from "@v3/ui/lib/utils";

export const Route = createFileRoute("/_authenticated/dev/teams/$teamId")({
  head: () => ({
    meta: [
      { title: "Team detail — SRP Dev Progress" },
      {
        name: "description",
        content:
          "Manage a launch team: members and roles, projects, sprints and items, demo days, the team wiki and the idea parking lot.",
      },
      { property: "og:title", content: "Team detail — SRP Dev Progress" },
      {
        property: "og:description",
        content: "Members, projects, sprints, demo days, wiki and ideas for one launch team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamDetail,
});

function TeamDetail() {
  const { teamId } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["dev-team", teamId],
    queryFn: () => loadTeam(teamId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["dev-team", teamId] });
    void qc.invalidateQueries({ queryKey: ["dev-overview"] });
  };

  const mutate = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });
  const act = (fn: () => Promise<unknown>, msg?: string) =>
    mutate.mutate(fn, { onSuccess: () => { refresh(); if (msg) toast.success(msg); } });

  const expected = expectedPct(data?.launch ?? null);
  const actual = weightedProgress(data?.projects ?? []);
  const track = trackOf(actual, expected);

  if (!isLoading && !data?.team) {
    return (
      <PageBody>
        <EmptyState title="Team not found" description="This team no longer exists." />
      </PageBody>
    );
  }

  return (
    <PageBody>
      <Link
        to="/dev"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--color-ink-2)] hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All teams
      </Link>
      <PageHeader
        eyebrow={data?.team?.team_type ?? "team"}
        title={data?.team?.name ?? "Loading…"}
        description={data?.team?.lane ?? undefined}
        actions={
          <div className="flex items-center gap-3">
            <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", TRACK_META[track].chip)}>
              {TRACK_META[track].label}
            </span>
            <span className={cn("text-2xl font-semibold", TRACK_META[track].text)}>
              {actual === null ? "—" : `${actual}%`}
            </span>
          </div>
        }
      />

      <NeedsYouBanner teamId={teamId} />

      <TeamHeaderCards data={data} act={act} teamId={teamId} expected={expected} actual={actual} track={track} />


      <ConsoleTabs
        tabs={[
          { value: "team", label: "Team", content: <TeamTab teamId={teamId} data={data} act={act} /> },
          { value: "projects", label: "Projects", content: <ProjectsTab teamId={teamId} data={data} act={act} expected={expected} /> },
          { value: "sprints", label: "Sprints", content: <SprintsTab teamId={teamId} data={data} act={act} /> },
          { value: "demos", label: "Demo days", content: <DemosTab teamId={teamId} data={data} act={act} /> },
          { value: "wiki", label: "Docs & wiki", content: <WikiTab teamId={teamId} data={data} act={act} /> },
          { value: "ideas", label: "Idea parking lot", content: <IdeasTab teamId={teamId} data={data} act={act} /> },
        ]}
      />
    </PageBody>
  );
}

type Data = Awaited<ReturnType<typeof loadTeam>> | undefined;
type Act = (fn: () => Promise<unknown>, msg?: string) => void;

/* ───────── Three-card header: TEAM · PROGRESS · PRIORITIES ───────── */
function goToTab(value: string) {
  const el = document.querySelector<HTMLElement>(`[role="tab"][id$="-trigger-${value}"]`);
  el?.click();
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function TeamHeaderCards({
  data,
  act,
  teamId,
  expected,
  actual,
  track,
}: {
  data: Data;
  act: Act;
  teamId: string;
  expected: number | null;
  actual: number | null;
  track: keyof typeof TRACK_META;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("builder");
  const [lead, setLead] = useState(false);

  const members = data?.members ?? [];
  const target = data?.team?.target_size ?? null;
  const roleMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const mem of members) m.set(mem.role, (m.get(mem.role) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [members]);

  const daysLeft = data?.launch
    ? Math.max(
        0,
        Math.round(
          (new Date(`${data.launch.launch_date}T00:00:00Z`).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  const priorities = useMemo(() => {
    const projects = (data?.projects ?? []).filter(
      (p) => (p.priority ?? "P2") === "P0" || (p.priority ?? "P2") === "P1",
    );
    const rank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return [...projects].sort(
      (a, b) =>
        (rank[a.priority ?? "P2"] ?? 2) - (rank[b.priority ?? "P2"] ?? 2) ||
        (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"),
    );
  }, [data?.projects]);

  return (
    <div className="mb-8 grid gap-4 xl:grid-cols-3">
      {/* TEAM */}
      <Panel
        title="Team"
        description={
          data?.team?.leader
            ? `Led by ${data.team.leader} · ${members.length}${target ? ` of ${target}` : ""} people`
            : `${members.length}${target ? ` of ${target}` : ""} people · no leader set`
        }
      >
        {!members.length ? (
          <EmptyState title="No members yet" description="Add the people building this lane." compact />
        ) : (
          <div className="flex flex-wrap gap-2">
            {members.map((m) => (
              <span
                key={m.id}
                className="group inline-flex max-w-full items-center gap-2 rounded-full border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] px-2.5 py-1.5"
              >
                <span className="truncate text-xs font-semibold text-ink">{m.name}</span>
                {m.is_lead ? (
                  <span className="rounded-full bg-[color:var(--color-g-blue-soft)] px-1.5 text-[9px] font-bold text-[color:var(--color-g-blue)]">
                    LEAD
                  </span>
                ) : null}
                <span className="truncate text-[10px] text-[color:var(--color-ink-3)]">
                  {m.role}
                  {m.email ? ` · ${m.email}` : ""}
                </span>
                <button
                  type="button"
                  title={m.is_lead ? "Unset lead" : "Mark as lead"}
                  className="text-[10px] font-semibold text-[color:var(--color-ink-3)] hover:text-ink"
                  onClick={() => act(() => devMutations.updateMember(m.id, { is_lead: !m.is_lead }))}
                >
                  {m.is_lead ? "unlead" : "lead"}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  className="text-[color:var(--color-ink-3)] hover:text-[#c5221f]"
                  onClick={() => act(() => devMutations.removeMember(m.id), "Member removed")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {roleMix.length ? (
          <p className="mt-3 text-[11px] text-[color:var(--color-ink-3)]">
            Role mix: {roleMix.map(([r, n]) => `${n} ${r}`).join(" · ")}
            {target ? ` — target size ${target}` : ""}
          </p>
        ) : null}

        <form
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            act(
              () =>
                devMutations.addMember(teamId, {
                  name: name.trim(),
                  role,
                  email: email.trim() || undefined,
                  is_lead: lead,
                }),
              "Member added",
            );
            setName("");
            setEmail("");
            setLead(false);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@experience.com" />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMBER_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1 text-[11px] text-[color:var(--color-ink-2)]">
              <input type="checkbox" checked={lead} onChange={(e) => setLead(e.target.checked)} /> lead
            </label>
            <Button type="submit" size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </Panel>

      {/* PROGRESS */}
      <Panel title="Progress" description="Weighted by project priority against time elapsed toward Alpha.">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className={cn("text-5xl font-semibold leading-none", TRACK_META[track].text)}>
              {actual === null ? "—" : `${actual}%`}
            </p>
            <p className="mt-2 text-xs text-[color:var(--color-ink-3)]">
              Expected {expected === null ? "—" : `${expected}%`} by today
            </p>
          </div>
          <div className="text-right">
            <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold", TRACK_META[track].chip)}>
              {TRACK_META[track].label}
            </span>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">{daysLeft ?? "—"}</p>
            <p className="text-[10px] uppercase tracking-wide text-[color:var(--color-ink-3)]">
              days to Alpha
            </p>
          </div>
        </div>
        <div className="relative mt-5 h-2.5 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
          <div
            className={cn("h-full rounded-full", TRACK_META[track].bar)}
            style={{ width: `${Math.min(100, actual ?? 0)}%` }}
          />
          {expected !== null ? (
            <span
              className="absolute top-[-3px] h-4 w-0.5 bg-[color:var(--color-ink)]"
              style={{ left: `${Math.min(100, expected)}%` }}
              title={`Expected ${expected}%`}
            />
          ) : null}
        </div>
        <p className="mt-3 text-[11px] text-[color:var(--color-ink-3)]">
          {data?.projects?.length ?? 0} projects tracked · launch{" "}
          {data?.launch?.launch_date ?? "not set"}
        </p>
      </Panel>

      {/* PRIORITIES */}
      <Panel
        title="What matters now"
        description="Every P0 and P1 project for this lane, ranked."
        actions={
          <Button size="sm" variant="outline" onClick={() => goToTab("ideas")}>
            <Sparkles className="mr-1 h-3.5 w-3.5" /> Parking lot
          </Button>
        }
        bodyClassName="px-0 py-0"
      >
        {!priorities.length ? (
          <div className="px-5 py-6">
            <EmptyState
              title="No P0 or P1 projects"
              description="Add projects and set their priority to see the now-list."
              compact
            />
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {priorities.map((p) => (
              <li key={p.id} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                      PRIORITY_CHIP[(p.priority ?? "P2") as Priority],
                    )}
                  >
                    {p.priority ?? "P2"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.name}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-[color:var(--color-ink-2)]">
                    {p.progress_pct ?? 0}%
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                    <div
                      className="h-full rounded-full bg-[color:var(--color-g-blue)]"
                      style={{ width: `${Math.min(100, Math.max(0, p.progress_pct ?? 0))}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[color:var(--color-ink-3)]">
                    {(p.status ?? "not_started").replace("_", " ")}
                    {p.deadline ? ` · due ${p.deadline}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}


/* ───────── Team ───────── */
function TeamTab({ teamId, data, act }: { teamId: string; data: Data; act: Act }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<string>("builder");
  const [leader, setLeader] = useState(data?.team?.leader ?? "");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Panel title="Members" description={`Target size ${data?.team?.target_size ?? "—"} · currently ${data?.members.length ?? 0}`}>
        {!data?.members.length ? (
          <EmptyState title="No members yet" description="Add the people building this lane." compact />
        ) : (
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{m.name}</span>
                <Select value={m.role} onValueChange={(v) => act(() => devMutations.updateMember(m.id, { role: v }))}>
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMBER_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => act(() => devMutations.removeMember(m.id), "Member removed")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            act(() => devMutations.addMember(teamId, { name: name.trim(), role }), "Member added");
            setName("");
          }}
        >
          <div className="min-w-[180px] flex-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMBER_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit">
            <Plus className="mr-1 h-4 w-4" /> Add
          </Button>
        </form>
      </Panel>

      <Panel title="Team lead">
        <Label className="text-xs">Lead</Label>
        <Input value={leader} onChange={(e) => setLeader(e.target.value)} placeholder="Not assigned" />
        <Button
          className="mt-3 w-full"
          variant="secondary"
          onClick={() => act(() => devMutations.setLeader(teamId, leader.trim() || null), "Lead saved")}
        >
          Save lead
        </Button>
      </Panel>
    </div>
  );
}

/* ───────── Projects ───────── */
function ProjectsTab({
  teamId,
  data,
  act,
  expected,
}: {
  teamId: string;
  data: Data;
  act: Act;
  expected: number;
}) {
  const [draft, setDraft] = useState({ name: "", priority: "P1" as Priority, deadline: "", success_criteria: "" });
  const [prompt, setPrompt] = useState<{ project: Project; text: string } | null>(null);

  return (
    <div className="space-y-6">
      <Panel title="New project">
        <form
          className="grid gap-3 md:grid-cols-[2fr_120px_160px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.name.trim()) return;
            act(
              () =>
                devMutations.addProject(teamId, {
                  name: draft.name.trim(),
                  priority: draft.priority,
                  deadline: draft.deadline || null,
                  success_criteria: draft.success_criteria || null,
                  status: "not_started",
                  progress_pct: 0,
                }),
              "Project created",
            );
            setDraft({ name: "", priority: "P1", deadline: "", success_criteria: "" });
          }}
        >
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={draft.priority} onValueChange={(v) => setDraft({ ...draft, priority: v as Priority })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Deadline</Label>
            <Input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Success criteria</Label>
            <Textarea
              rows={2}
              value={draft.success_criteria}
              onChange={(e) => setDraft({ ...draft, success_criteria: e.target.value })}
              placeholder="What must be true for this to count as done?"
            />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">
              <Plus className="mr-1 h-4 w-4" /> Create project
            </Button>
          </div>
        </form>
      </Panel>

      {!data?.projects.length ? (
        <EmptyState title="No projects yet" description="Add the work this team owns for Alpha." />
      ) : (
        data.projects.map((p) => {
          const track = trackOf(p.progress_pct ?? 0, expected);
          return (
            <Panel
              key={p.id}
              title={p.name}
              description={`${p.priority ?? "P2"} · due ${p.deadline ?? "—"}`}
              actions={
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", PRIORITY_CHIP[(p.priority ?? "P2") as Priority])}>
                    {p.priority ?? "P2"}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setPrompt({
                        project: p,
                        text: composeBuildPrompt({
                          project: p,
                          team: data.team,
                          wikis: data.docs.filter((d) => d.doc_type === "wiki"),
                          launch: data.launch,
                        }),
                      })
                    }
                  >
                    <Sparkles className="mr-1 h-4 w-4" /> Build prompt
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Delete project" onClick={() => act(() => devMutations.removeProject(p.id), "Project deleted")}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              }
            >
              <div className="grid gap-4 md:grid-cols-[1fr_260px]">
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      rows={2}
                      defaultValue={p.description ?? ""}
                      onBlur={(e) =>
                        e.target.value !== (p.description ?? "") &&
                        act(() => devMutations.updateProject(p.id, { description: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Success criteria</Label>
                    <Textarea
                      rows={2}
                      defaultValue={p.success_criteria ?? ""}
                      onBlur={(e) =>
                        e.target.value !== (p.success_criteria ?? "") &&
                        act(() => devMutations.updateProject(p.id, { success_criteria: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Status</Label>
                    <Select value={p.status ?? "not_started"} onValueChange={(v) => act(() => devMutations.updateProject(p.id, { status: v }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROJECT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">
                      Progress — <span className={TRACK_META[track].text}>{p.progress_pct ?? 0}%</span>
                    </Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      defaultValue={p.progress_pct ?? 0}
                      onMouseUp={(e) =>
                        act(() => devMutations.updateProject(p.id, { progress_pct: Number((e.target as HTMLInputElement).value) }))
                      }
                      onTouchEnd={(e) =>
                        act(() => devMutations.updateProject(p.id, { progress_pct: Number((e.target as HTMLInputElement).value) }))
                      }
                      className="w-full accent-[color:var(--color-g-blue)]"
                    />
                    <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                      <div className={cn("h-full rounded-full", TRACK_META[track].bar)} style={{ width: `${p.progress_pct ?? 0}%` }} />
                      <div className="absolute inset-y-0 w-[2px] bg-ink/60" style={{ left: `${expected}%` }} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Deadline</Label>
                    <Input
                      type="date"
                      defaultValue={p.deadline ?? ""}
                      onBlur={(e) => act(() => devMutations.updateProject(p.id, { deadline: e.target.value || null }))}
                    />
                  </div>
                </div>
              </div>
            </Panel>
          );
        })
      )}

      <DetailDrawer
        open={!!prompt}
        onOpenChange={(o) => !o && setPrompt(null)}
        title="AI partner — build prompt"
        description={prompt ? `Deterministic prompt composed from ${prompt.project.name}, its team lane and the team wiki. LLM generation lands here later.` : undefined}
        footer={
          <Button
            className="w-full"
            onClick={() => {
              if (!prompt) return;
              void navigator.clipboard.writeText(prompt.text);
              toast.success("Prompt copied");
            }}
          >
            <Copy className="mr-1 h-4 w-4" /> Copy prompt
          </Button>
        }
      >
        <pre className="whitespace-pre-wrap rounded-[12px] bg-[color:var(--color-surface-2)] p-4 text-xs leading-relaxed text-ink">
          {prompt?.text}
        </pre>
      </DetailDrawer>
    </div>
  );
}

/* ───────── Sprints ───────── */
function SprintItemCard({ item: r, act }: { item: SprintItem; act: Act }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!(r.deep_instructions || r.canon_ref);
  return (
    <div className="rounded-[10px] bg-card p-2.5 shadow-[var(--shadow-xs)]">
      <div className="flex items-start gap-1.5">
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Hide details" : "Show details"}
            aria-expanded={open}
            className="mt-0.5 shrink-0 rounded p-0.5 text-[color:var(--color-ink-3)] hover:bg-[color:var(--color-surface-2)] hover:text-ink"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">{r.title}</p>
          <p className="mt-0.5 text-[11px] text-[color:var(--color-ink-3)]">{r.assignee ?? "unassigned"}</p>
          {r.is_gate ? (
            <div className="mt-1.5">
              <GateBadge />
            </div>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-2 rounded-[8px] bg-[color:var(--color-surface-2)] p-2">
          {r.deep_instructions ? (
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-[color:var(--color-ink-2)]">
              {r.deep_instructions}
            </p>
          ) : (
            <p className="text-[11px] text-[color:var(--color-ink-3)]">No deep instructions captured.</p>
          )}
          {r.canon_ref ? (
            <p className="mt-1.5 text-[10px] uppercase tracking-wider text-[color:var(--color-ink-3)]">
              Canon: {r.canon_ref}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-1">
        <Select value={r.status ?? "todo"} onValueChange={(v) => act(() => devMutations.updateItem(r.id, { status: v }))}>
          <SelectTrigger className="h-7 flex-1 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITEM_STATUSES.map((x) => (
              <SelectItem key={x} value={x}>
                {x.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon" variant="ghost" aria-label="Delete item" onClick={() => act(() => devMutations.removeItem(r.id))}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}


function SprintsTab({ teamId, data, act }: { teamId: string; data: Data; act: Act }) {
  const [sprint, setSprint] = useState({ name: "", start_date: "", end_date: "", goal: "" });
  const [items, setItems] = useState<Record<string, string>>({});

  return (
    <div className="space-y-6">
      <Panel title="New sprint">
        <form
          className="grid gap-3 md:grid-cols-[2fr_160px_160px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sprint.name.trim()) return;
            act(
              () =>
                devMutations.addSprint(teamId, {
                  name: sprint.name.trim(),
                  goal: sprint.goal || null,
                  start_date: sprint.start_date || null,
                  end_date: sprint.end_date || null,
                }),
              "Sprint created",
            );
            setSprint({ name: "", start_date: "", end_date: "", goal: "" });
          }}
        >
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={sprint.name} onChange={(e) => setSprint({ ...sprint, name: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Start</Label>
            <Input type="date" value={sprint.start_date} onChange={(e) => setSprint({ ...sprint, start_date: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">End</Label>
            <Input type="date" value={sprint.end_date} onChange={(e) => setSprint({ ...sprint, end_date: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <Label className="text-xs">Goal</Label>
            <Input value={sprint.goal} onChange={(e) => setSprint({ ...sprint, goal: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <Button type="submit">
              <Plus className="mr-1 h-4 w-4" /> Create sprint
            </Button>
          </div>
        </form>
      </Panel>

      {!data?.sprints.length ? (
        <EmptyState title="No sprints yet" description="Create a sprint to start tracking items." />
      ) : (
        data.sprints.map((s) => {
          const rows = data.items.filter((i) => i.sprint_id === s.id);
          return (
            <Panel
              key={s.id}
              title={s.name}
              description={`${s.start_date ?? "—"} → ${s.end_date ?? "—"}${s.goal ? ` · ${s.goal}` : ""}`}
              actions={
                <Button size="icon" variant="ghost" aria-label="Delete sprint" onClick={() => act(() => devMutations.removeSprint(s.id), "Sprint deleted")}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              }
            >
              <div className="grid gap-3 md:grid-cols-3">
                {ITEM_STATUSES.map((st) => (
                  <div key={st} className="rounded-[14px] bg-[color:var(--color-surface-2)] p-3">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                      {st.replace("_", " ")} · {rows.filter((r) => (r.status ?? "todo") === st).length}
                    </p>
                    <div className="space-y-2">
                      {rows
                        .filter((r) => (r.status ?? "todo") === st)
                        .map((r) => (
                          <SprintItemCard key={r.id} item={r} act={act} />
                        ))}
                    </div>
                  </div>
                ))}
              </div>

              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = (items[s.id] ?? "").trim();
                  if (!title) return;
                  act(() => devMutations.addItem(s.id, { title, status: "todo", priority: "P2" }), "Item added");
                  setItems({ ...items, [s.id]: "" });
                }}
              >
                <Input
                  value={items[s.id] ?? ""}
                  onChange={(e) => setItems({ ...items, [s.id]: e.target.value })}
                  placeholder="Add a sprint item…"
                />
                <Button type="submit" variant="secondary">
                  <Plus className="h-4 w-4" />
                </Button>
              </form>
            </Panel>
          );
        })
      )}
    </div>
  );
}

/* ───────── Demo days ───────── */
function DemosTab({ teamId, data, act }: { teamId: string; data: Data; act: Act }) {
  const [d, setD] = useState({ title: "", demo_date: "", notes: "" });
  return (
    <div className="space-y-6">
      <Panel title="Schedule a demo day">
        <form
          className="grid gap-3 md:grid-cols-[2fr_170px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!d.title.trim() || !d.demo_date) return;
            act(() => devMutations.addDemo(teamId, { title: d.title.trim(), demo_date: d.demo_date, notes: d.notes || null }), "Demo day scheduled");
            setD({ title: "", demo_date: "", notes: "" });
          }}
        >
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={d.demo_date} onChange={(e) => setD({ ...d, demo_date: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Button type="submit">
              <Plus className="mr-1 h-4 w-4" /> Schedule
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title="Scheduled demos">
        {!data?.demos.length ? (
          <EmptyState title="No demo days scheduled" compact />
        ) : (
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {data.demos.map((x) => (
              <li key={x.id} className="flex items-start gap-3 py-3">
                <span className="w-24 shrink-0 text-xs font-semibold text-[color:var(--color-g-blue)]">{x.demo_date}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{x.title}</p>
                  {x.notes ? <p className="text-xs text-[color:var(--color-ink-2)]">{x.notes}</p> : null}
                </div>
                <Button size="icon" variant="ghost" aria-label="Delete demo day" onClick={() => act(() => devMutations.removeDemo(x.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ───────── Docs & wiki ───────── */
function WikiTab({ teamId, data, act }: { teamId: string; data: Data; act: Act }) {
  const [editing, setEditing] = useState<{ id?: string; title: string; body: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wikis = useMemo(() => (data?.docs ?? []).filter((x) => x.doc_type !== "doc"), [data]);
  const files = useMemo(() => (data?.docs ?? []).filter((x) => x.doc_type === "doc"), [data]);

  const openFile = async (doc: DevDoc) => {
    try {
      if (doc.url) {
        window.open(doc.url, "_blank", "noreferrer");
        return;
      }
      if (!doc.storage_path) return;
      window.open(await devMutations.docUrl(doc.storage_path), "_blank", "noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Panel
        title="Team wiki"
        description="Markdown pages the AI partner reads as context when composing build prompts."
        actions={
          <Button size="sm" onClick={() => setEditing({ title: "", body: "" })}>
            <Plus className="mr-1 h-4 w-4" /> New page
          </Button>
        }
      >
        {editing ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Body (markdown)</Label>
              <Textarea rows={14} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className="font-mono text-xs" />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (!editing.title.trim()) return;
                  act(() => devMutations.saveWiki(teamId, { id: editing.id, title: editing.title.trim(), body: editing.body }), "Page saved");
                  setEditing(null);
                }}
              >
                Save page
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : !wikis.length ? (
          <EmptyState title="No wiki pages yet" description="Capture the lane's decisions, contracts and gotchas." compact />
        ) : (
          <div className="space-y-5">
            {wikis.map((w) => (
              <article key={w.id} className="rounded-[14px] border border-[color:var(--color-hairline)] p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-ink">{w.title}</h3>
                    <p className="text-[11px] text-[color:var(--color-ink-3)]">
                      {w.updated_by ?? "unknown"} · {w.updated_at?.slice(0, 10) ?? "—"}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setEditing({ id: w.id, title: w.title, body: w.body ?? "" })}>
                    Edit
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Delete page" onClick={() => act(() => devMutations.removeDoc(w.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div
                  className="mt-2 text-sm text-[color:var(--color-ink-2)]"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(w.body ?? "") }}
                />
              </article>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Uploaded documents"
        actions={
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="mr-1 h-4 w-4" /> Upload
          </Button>
        }
      >
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) act(() => devMutations.uploadDoc(teamId, f), "Document uploaded");
            e.target.value = "";
          }}
        />
        {!files.length ? (
          <EmptyState title="No documents" description="Specs, decks and playbooks live here." compact />
        ) : (
          <ul className="space-y-2">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <button
                  onClick={() => void openFile(f)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2 py-2 text-left text-xs text-ink hover:bg-[color:var(--color-surface-2)]"
                >
                  <FileText className="h-4 w-4 shrink-0 text-[color:var(--color-ink-3)]" />
                  <span className="truncate">{f.title}</span>
                </button>
                <Button size="icon" variant="ghost" aria-label="Delete document" onClick={() => act(() => devMutations.removeDoc(f.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ───────── Ideas ───────── */
function IdeasTab({ teamId, data, act }: { teamId: string; data: Data; act: Act }) {
  const qc = useQueryClient();
  const [idea, setIdea] = useState({ title: "", description: "" });

  const vote = async (id: string) => {
    try {
      const r = await devMutations.voteIdea(id);
      toast[r === "voted" ? "success" : "info"](r === "voted" ? "Upvoted" : "You already voted on this idea");
      void qc.invalidateQueries({ queryKey: ["dev-team", teamId] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Panel title="Parking lot" description="One vote per person per idea.">
        {!data?.ideas.length ? (
          <EmptyState title="No ideas parked yet" description="Anything worth doing after Alpha starts here." compact />
        ) : (
          <ul className="space-y-3">
            {data.ideas.map((i) => {
              const mine = data.myVotes.includes(i.id);
              return (
                <li key={i.id} className="flex gap-3 rounded-[14px] border border-[color:var(--color-hairline)] p-3">
                  <button
                    onClick={() => void vote(i.id)}
                    className={cn(
                      "flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-[10px] border transition-colors",
                      mine
                        ? "border-[color:var(--color-g-blue)] bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]"
                        : "border-[color:var(--color-hairline)] text-[color:var(--color-ink-2)] hover:bg-[color:var(--color-surface-2)]",
                    )}
                    aria-label={`Upvote ${i.title}`}
                  >
                    <ChevronUp className="h-4 w-4" />
                    <span className="text-sm font-semibold">{i.votes ?? 0}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{i.title}</p>
                    {i.description ? <p className="mt-0.5 text-xs text-[color:var(--color-ink-2)]">{i.description}</p> : null}
                    <p className="mt-1 text-[11px] text-[color:var(--color-ink-3)]">
                      {i.submitted_by ?? "anonymous"} · {i.status ?? "parked"}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" aria-label="Delete idea" onClick={() => act(() => devMutations.removeIdea(i.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Park an idea">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!idea.title.trim()) return;
            act(() => devMutations.addIdea(teamId, idea.title.trim(), idea.description), "Idea parked");
            setIdea({ title: "", description: "" });
          }}
        >
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={idea.title} onChange={(e) => setIdea({ ...idea, title: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Why it matters</Label>
            <Textarea rows={4} value={idea.description} onChange={(e) => setIdea({ ...idea, description: e.target.value })} />
          </div>
          <Button type="submit" className="w-full">
            <Plus className="mr-1 h-4 w-4" /> Park idea
          </Button>
        </form>
      </Panel>
    </div>
  );
}
