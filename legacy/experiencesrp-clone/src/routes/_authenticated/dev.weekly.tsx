import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, FlaskConical, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ConsoleTabs,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@/components/console/primitives";
import { TRACK_META } from "@/lib/dev-progress";
import {
  WEEK_DAYS,
  composeDigest,
  groupWeekly,
  loadWeekly,
  weeklyMutations,
  weeklyTotals,
  weekStartIso,
  type DevConfig,
  type TeamWeekly,
  type WeeklyData,
} from "@/lib/dev-weekly";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dev/weekly")({
  head: () => ({
    meta: [
      { title: "Weekly reporting — SRP Dev Progress" },
      {
        name: "description",
        content:
          "The weekly loop: each member submits progress, highlights, blockers and next week; the tracker shows who is still pending and the digest preview shows the report that goes out.",
      },
      { property: "og:title", content: "Weekly reporting — SRP Dev Progress" },
      {
        property: "og:description",
        content: "Submit a weekly update, chase the pending list, preview the digest and set the reminder schedule.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WeeklyPage,
});

function DemoChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-purple-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7b4ce0]">
      <FlaskConical className="h-3 w-3" /> demo
    </span>
  );
}

export function WeeklyPage() {
  const qc = useQueryClient();
  const weekStart = weekStartIso();
  const { data, isLoading } = useQuery({
    queryKey: ["dev-weekly", weekStart],
    queryFn: () => loadWeekly(weekStart),
  });

  const groups = useMemo(() => (data ? groupWeekly(data) : []), [data]);
  const totals = weeklyTotals(groups);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["dev-weekly", weekStart] });
  const mutate = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onError: (e: Error) => toast.error(e.message),
  });
  const act = (fn: () => Promise<unknown>, msg?: string) =>
    mutate.mutate(fn, {
      onSuccess: () => {
        refresh();
        if (msg) toast.success(msg);
      },
    });

  return (
    <PageBody>
      <PageHeader
        eyebrow="SRP Dev Progress"
        title="Weekly reporting loop"
        description={`Week of ${weekStart}. Every member submits before the due time; the digest compiles what came in and emails the whole program.`}
        actions={
          data && !data.emailConfigured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff1e0] px-3 py-1 text-[11px] font-semibold text-[#b45309]">
              <AlertTriangle className="h-3.5 w-3.5" /> Email not configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-g-green-soft)] px-3 py-1 text-[11px] font-semibold text-[#1e8e3e]">
              <Mail className="h-3.5 w-3.5" /> Email configured
            </span>
          )
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Submitted this week"
          tone="green"
          icon={<CheckCircle2 className="h-4 w-4" />}
          loading={isLoading}
          value={totals.submitted}
          hint="exp_dev_weekly_updates · status submitted"
        />
        <StatTile
          label="Still pending"
          tone={totals.pending > 0 ? "red" : "neutral"}
          icon={<Clock className="h-4 w-4" />}
          loading={isLoading}
          value={totals.pending}
          hint="Chase list below"
        />
        <StatTile
          label="Members in the program"
          tone="blue"
          loading={isLoading}
          value={totals.submitted + totals.pending}
          hint={`${groups.length} teams with members`}
        />
        <StatTile
          label="Reminder / due / digest"
          tone="purple"
          loading={isLoading}
          value={
            data?.config
              ? `${data.config.reminder_day.slice(0, 3)} ${data.config.reminder_time}`
              : "—"
          }
          hint={
            data?.config
              ? `due ${data.config.due_day.slice(0, 3)} ${data.config.due_time} · digest ${data.config.digest_day.slice(0, 3)} ${data.config.digest_time}`
              : "exp_dev_config"
          }
        />
      </div>

      <ConsoleTabs
        tabs={[
          {
            value: "tracker",
            label: "This week",
            content: <Tracker groups={groups} act={act} loading={isLoading} />,
          },
          {
            value: "submit",
            label: "Submit an update",
            content: <SubmitForm data={data} weekStart={weekStart} act={act} />,
          },
          {
            value: "digest",
            label: "Digest preview",
            content: <DigestPreview data={data} groups={groups} />,
          },
          {
            value: "settings",
            label: "Schedule settings",
            content: <Settings config={data?.config ?? null} act={act} />,
          },
        ]}
      />
    </PageBody>
  );
}

/* ───────── Tracker ───────── */

function Tracker({
  groups,
  act,
  loading,
}: {
  groups: TeamWeekly[];
  act: (fn: () => Promise<unknown>, msg?: string) => void;
  loading: boolean;
}) {
  if (loading) return <div className="h-64 animate-pulse rounded-[18px] bg-[color:var(--color-surface-2)]" />;
  if (!groups.length)
    return (
      <EmptyState
        title="No members yet"
        description="Add members with emails on a team and their weekly rows appear here."
      />
    );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((g) => (
        <Panel
          key={g.team.id}
          title={g.team.name}
          description={`${g.submitted}/${g.rows.length} submitted · progress ${g.progress === null ? "—" : `${g.progress}%`}`}
          actions={
            <div className="flex items-center gap-2">
              {g.isDemo ? <DemoChip /> : null}
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", TRACK_META[g.track].chip)}>
                {TRACK_META[g.track].label}
              </span>
            </div>
          }
          bodyClassName="px-0 py-0"
        >
          <ul className="divide-y divide-[color:var(--color-hairline)]">
            {g.rows.map(({ member, update }) => {
              const done = update?.status === "submitted";
              return (
                <li key={member.id} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      done
                        ? "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]"
                        : "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
                    )}
                  >
                    {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {member.name}
                      {member.is_lead ? (
                        <span className="ml-2 rounded-full bg-[color:var(--color-g-blue-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[color:var(--color-g-blue)]">
                          LEAD
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-[color:var(--color-ink-3)]">
                      {member.role}
                      {member.email ? ` · ${member.email}` : " · no email on file"}
                    </p>
                    {done && update?.highlights ? (
                      <p className="mt-1 text-xs text-[color:var(--color-ink-2)]">{update.highlights}</p>
                    ) : null}
                    {done && update?.blockers ? (
                      <p className="mt-1 text-xs font-medium text-[#c5221f]">Blocked: {update.blockers}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {update?.self_progress_pct === null || update?.self_progress_pct === undefined
                        ? "—"
                        : `${update.self_progress_pct}%`}
                    </p>
                    {done && update ? (
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-[color:var(--color-ink-3)] hover:underline"
                        onClick={() => act(() => weeklyMutations.reopen(update.id), "Reopened")}
                      >
                        reopen
                      </button>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase text-[#c5221f]">pending</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
    </div>
  );
}

/* ───────── Submit ───────── */

function SubmitForm({
  data,
  weekStart,
  act,
}: {
  data: WeeklyData | undefined;
  weekStart: string;
  act: (fn: () => Promise<unknown>, msg?: string) => void;
}) {
  const [memberId, setMemberId] = useState("");
  const [pct, setPct] = useState("");
  const [highlights, setHighlights] = useState("");
  const [blockers, setBlockers] = useState("");
  const [next, setNext] = useState("");

  const member = data?.members.find((m) => m.id === memberId) ?? null;
  const existing = data?.updates.find((u) => u.member_id === memberId) ?? null;

  return (
    <Panel
      title="Weekly update"
      description={`Recorded against the week starting ${weekStart}. Submitting again overwrites your entry for this week.`}
    >
      {!data?.members.length ? (
        <EmptyState title="No members yet" description="Add members to a team first." compact />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!member?.team_id) {
              toast.error("Pick who you are first");
              return;
            }
            const value = pct.trim() === "" ? null : Math.max(0, Math.min(100, Number(pct)));
            act(
              () =>
                weeklyMutations.submit({
                  teamId: member.team_id,
                  memberId: member.id,
                  weekStart,
                  self_progress_pct: value,
                  highlights,
                  blockers,
                  next_week: next,
                }),
              "Weekly update submitted",
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div>
              <Label className="text-xs">Who are you</Label>
              <Select
                value={memberId}
                onValueChange={(v) => {
                  setMemberId(v);
                  const u = data.updates.find((x) => x.member_id === v);
                  setPct(u?.self_progress_pct != null ? String(u.self_progress_pct) : "");
                  setHighlights(u?.highlights ?? "");
                  setBlockers(u?.blockers ?? "");
                  setNext(u?.next_week ?? "");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select your name" />
                </SelectTrigger>
                <SelectContent>
                  {data.members.map((m) => {
                    const team = data.teams.find((t) => t.id === m.team_id);
                    return (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name} — {team?.name ?? "no team"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Self progress %</Label>
              <Input
                value={pct}
                inputMode="numeric"
                onChange={(e) => setPct(e.target.value)}
                placeholder="0–100"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Highlights</Label>
            <Textarea value={highlights} onChange={(e) => setHighlights(e.target.value)} rows={3} />
          </div>
          <div>
            <Label className="text-xs">Blockers</Label>
            <Textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={2} />
          </div>
          <div>
            <Label className="text-xs">Next week</Label>
            <Textarea value={next} onChange={(e) => setNext(e.target.value)} rows={2} />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!memberId}>
              <Send className="mr-1 h-4 w-4" />
              {existing?.status === "submitted" ? "Resubmit" : "Submit"} weekly update
            </Button>
            {existing?.submitted_at ? (
              <span className="text-xs text-[color:var(--color-ink-3)]">
                Last submitted {new Date(existing.submitted_at).toLocaleString()}
              </span>
            ) : null}
          </div>
        </form>
      )}
    </Panel>
  );
}

/* ───────── Digest ───────── */

function DigestPreview({ data, groups }: { data: WeeklyData | undefined; groups: TeamWeekly[] }) {
  if (!data) return <div className="h-64 animate-pulse rounded-[18px] bg-[color:var(--color-surface-2)]" />;
  const text = composeDigest(data, groups);
  return (
    <Panel
      title="Digest preview"
      description={`Exactly what the ${data.config?.digest_day ?? "Friday"} ${data.config?.digest_time ?? "12:00"} digest job compiles and sends from ${data.config?.from_email ?? "the configured sender"}.`}
      actions={
        data.emailConfigured ? null : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff1e0] px-2.5 py-1 text-[10px] font-semibold text-[#b45309]">
            <AlertTriangle className="h-3 w-3" /> Email not configured — nothing is sent
          </span>
        )
      }
    >
      <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-[14px] bg-[color:var(--color-surface-2)] p-4 text-xs leading-relaxed text-[color:var(--color-ink)]">
        {text}
      </pre>
    </Panel>
  );
}

/* ───────── Settings ───────── */

function Settings({
  config,
  act,
}: {
  config: DevConfig | null;
  act: (fn: () => Promise<unknown>, msg?: string) => void;
}) {
  const [form, setForm] = useState<DevConfig | null>(config);
  const c = form ?? config;

  if (!c) {
    return (
      <EmptyState
        title="No schedule row yet"
        description="exp_dev_config has no row — add one and the reminder, due and digest times appear here."
      />
    );
  }

  const set = (patch: Partial<DevConfig>) => setForm({ ...c, ...patch });

  const DayTime = ({
    label,
    day,
    time,
    onDay,
    onTime,
  }: {
    label: string;
    day: string;
    time: string;
    onDay: (v: string) => void;
    onTime: (v: string) => void;
  }) => (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Select value={day} onValueChange={onDay}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEEK_DAYS.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={time} onChange={(e) => onTime(e.target.value)} placeholder="09:00" className="w-[110px]" />
      </div>
    </div>
  );

  return (
    <Panel
      title="Weekly schedule"
      description="Read from and written to exp_dev_config. The reminder and digest jobs read these values at run time."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <DayTime
          label="Reminder"
          day={c.reminder_day}
          time={c.reminder_time}
          onDay={(v) => set({ reminder_day: v })}
          onTime={(v) => set({ reminder_time: v })}
        />
        <DayTime
          label="Due"
          day={c.due_day}
          time={c.due_time}
          onDay={(v) => set({ due_day: v })}
          onTime={(v) => set({ due_time: v })}
        />
        <DayTime
          label="Digest"
          day={c.digest_day}
          time={c.digest_time}
          onDay={(v) => set({ digest_day: v })}
          onTime={(v) => set({ digest_time: v })}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label className="text-xs">From address</Label>
          <Input
            value={c.from_email ?? ""}
            onChange={(e) => set({ from_email: e.target.value })}
            placeholder="dev-reports@experience.com"
          />
        </div>
        <div>
          <Label className="text-xs">Provider</Label>
          <Input value={c.provider ?? ""} onChange={(e) => set({ provider: e.target.value })} />
        </div>
      </div>
      <Button
        className="mt-4"
        onClick={() =>
          act(
            () =>
              weeklyMutations.saveConfig(c.id, {
                reminder_day: c.reminder_day,
                reminder_time: c.reminder_time,
                due_day: c.due_day,
                due_time: c.due_time,
                digest_day: c.digest_day,
                digest_time: c.digest_time,
                from_email: c.from_email,
                provider: c.provider,
              }),
            "Schedule saved",
          )
        }
      >
        Save schedule
      </Button>
      <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
        Changing a day or time here updates what the jobs report as due. The cron trigger times themselves are
        scheduled in the database (pg_cron) and are re-scheduled when you ask for a different cadence.
      </p>
    </Panel>
  );
}
