import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The two RPCs are newer than the generated Supabase types.
const db = supabase as any;

type CronRow = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  last_start: string | null;
  last_end: string | null;
  last_status: string | null;
  last_message: string | null;
  runs_24h: number;
  failed_24h: number;
};

type JobNote = { station: string; title: string; what: string; whenOff: string };

// Plain-language notes, in station order. Only these jobs are listed or switchable
// (the database functions enforce the same list).
// Fix (current ETL jobs only, 2026-10-22): the jobs of the current ETL process. The older per-page AI extraction
// jobs and the robots / sitemap jobs are no longer listed; Enhancer, Profile gate and Publish were added.
const JOBS: Record<string, JobNote> = {
  "disco-ai-worker-drain": {
    station: "1–3",
    title: "AI worker",
    what: "Runs the pipeline sweep (method checks for approved sites, first maps, test samples, lost requests), then answers queued AI requests: discovers sources for a category, checks each approved site's crawl method, and maps sites into site contracts.",
    whenOff: "Discovery, method checks and site mapping wait in the queue, and the sweep does not run. Nothing is lost; they continue when switched back on.",
  },
  "etl-fetch-tick": {
    station: "4–5",
    title: "Fetch & harvest",
    what: "Sends queued pages of running sources to the crawler worker — first the sample pull for the field-yield gate, then the full crawl — paced per site within its daily limit.",
    whenOff: "No new pages are fetched. Running sources stop where they are and resume from the same place when switched back on.",
  },
  "etl-fetch-collect": {
    station: "4–5",
    title: "Fetch results & gate",
    what: "Collects fetched pages, stages the harvested records, and runs the field-yield gate when a source's sample is complete.",
    whenOff: "Fetched pages wait uncollected; nothing new is staged and the gate does not run.",
  },
  "etl-resolve-tick": {
    station: "6",
    title: "Node creator",
    what: "Turns staged records of active sources into graph entities: brand → office → professional, or brand → location for location categories (up to 80 records per run).",
    whenOff: "No new entities are created. Staged records stay pending and are processed when switched back on.",
  },
  "etl-enhance-tick": {
    station: "7",
    title: "Enhancer",
    what: "Completes entities the node creator has updated: fills and reconciles fields from every source of the entity (up to 100 per run).",
    whenOff: "Updated entities wait unenhanced, so the profile gate does not check them yet. They continue when switched back on.",
  },
  "etl-profile-gate-tick": {
    station: "8",
    title: "Profile gate",
    what: "Checks each enhanced profile against its category's required fields and records pass or fail with the reasons (up to 200 per run).",
    whenOff: "Profiles are not checked, so nothing new becomes ready to publish.",
  },
  "etl-publish-tick": {
    station: "Publish",
    title: "Publish",
    what: "When on: every gate-passed professional of a launched category is published to the public site, and profiles that no longer pass are unpublished (up to 100 per run). Off by default; publishing is done in approved pilots.",
    whenOff: "Nothing is published or unpublished on a schedule. Approved pilot runs are unaffected.",
  },
};
const ORDER = Object.keys(JOBS);

function every(schedule: string): string {
  if (schedule === "* * * * *") return "Every minute";
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(schedule);
  if (m) return `Every ${m[1]} minutes`;
  return schedule;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function SchedulesTab() {
  const { canEdit } = useRole();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<{ row: CronRow; to: boolean } | null>(null);

  const { data: rows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["etl_cron_list"],
    queryFn: async () => {
      const { data, error } = await db.rpc("exp_etl_cron_list");
      if (error) throw error;
      return ((data ?? []) as CronRow[])
        .filter((r) => r.jobname in JOBS)
        .sort((a, b) => ORDER.indexOf(a.jobname) - ORDER.indexOf(b.jobname));
    },
    refetchInterval: 60000,
  });

  const toggle = useMutation({
    mutationFn: async ({ row, to }: { row: CronRow; to: boolean }) => {
      const { error } = await db.rpc("exp_etl_cron_set_active", {
        p_jobname: row.jobname,
        p_active: to,
      });
      if (error) throw error;
      return { row, to };
    },
    onSuccess: ({ row, to }) => {
      toast.success(`${JOBS[row.jobname]?.title ?? row.jobname} switched ${to ? "on" : "off"}`);
      queryClient.invalidateQueries({ queryKey: ["etl_cron_list"] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setConfirm(null),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">ETL schedules</h2>
          <p className="mt-1 text-sm text-slate-500">
            The scheduled jobs that move work through the current ETL process, from discovery to publish. Switching a job off pauses
            that step only; queued work waits and continues when it is switched back on. Other
            scheduled jobs in the system are not shown and cannot be changed here.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs"
          disabled={isFetching}
          onClick={() => refetch()}
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-red-600">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Station</th>
                <th className="px-3 py-2 font-medium">Job</th>
                <th className="px-3 py-2 font-medium">What it does</th>
                <th className="px-3 py-2 font-medium">Runs</th>
                <th className="px-3 py-2 font-medium">Last run</th>
                <th className="px-3 py-2 font-medium">Failures (24 h)</th>
                <th className="px-3 py-2 font-medium">On / off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const note = JOBS[r.jobname];
                const failed = r.last_status === "failed";
                return (
                  <tr key={r.jobname} className="align-top">
                    <td className="px-3 py-3 text-xs text-slate-500">{note.station}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-ink">{note.title}</div>
                      <div className="font-mono text-[11px] text-slate-400">{r.jobname}</div>
                    </td>
                    <td className="max-w-md px-3 py-3 text-xs text-slate-600">
                      <p>{note.what}</p>
                      <p className="mt-1 text-slate-400">When off: {note.whenOff}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">{every(r.schedule)}</td>
                    <td className="px-3 py-3 text-xs">
                      {r.last_status ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={failed ? "text-red-600" : "text-slate-600"}>
                              {timeAgo(r.last_start)} · {r.last_status}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm whitespace-pre-wrap text-xs">
                            {r.last_message || "No message"}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-slate-400">never</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <span className={r.failed_24h > 0 ? "text-red-600" : "text-slate-600"}>
                        {r.failed_24h} of {r.runs_24h}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {canEdit ? (
                          <Switch
                            checked={r.active}
                            disabled={toggle.isPending}
                            onCheckedChange={(to: boolean) => setConfirm({ row: r, to })}
                            aria-label={`Switch ${note.title} ${r.active ? "off" : "on"}`}
                          />
                        ) : null}
                        <Badge
                          variant="secondary"
                          className={
                            r.active
                              ? "bg-emerald-50 font-normal text-emerald-700"
                              : "bg-slate-100 font-normal text-slate-600"
                          }
                        >
                          {r.active ? "On" : "Off"}
                        </Badge>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o: boolean) => (!o ? setConfirm(null) : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch {confirm ? JOBS[confirm.row.jobname]?.title : ""} {confirm?.to ? "on" : "off"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm
                ? confirm.to
                  ? JOBS[confirm.row.jobname]?.what
                  : JOBS[confirm.row.jobname]?.whenOff
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggle.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={toggle.isPending}
              onClick={(e: { preventDefault: () => void }) => {
                e.preventDefault();
                if (confirm) toggle.mutate(confirm);
              }}
            >
              Switch {confirm?.to ? "on" : "off"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
