import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { supabase } from "@v3/ui/integrations/supabase/client";
import { Badge } from "@v3/ui/components/ui/badge";
import { Button } from "@v3/ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@v3/ui/components/ui/dialog";
import { cn } from "@v3/ui/lib/utils";

/* Source Stats (2026-10-16): one table, one row per source website within a category (gcid), with the whole funnel:
   expected -> discovered -> queued / harvested / skipped / failed -> staged (shallow, resolved, rejected) -> entities
   (professionals, locations, brands, teams) -> gate passed -> published, and what is still to harvest. Data comes from
   exp_etl_source_stats (read-only, admins / architects), loaded when the tab opens or on Refresh (no polling). Click a
   row for the breakdown (queue by kind and status, staging by status, last run, entity counts). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Row = Record<string, Any>;

const n = (v: unknown) => (v == null || v === "" ? "—" : Number(v).toLocaleString());
const when = (v: unknown) => {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const gcidLabel = (g: string) => g.replace(/^gcid:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  test_pull: "bg-sky-50 text-sky-700",
  approved: "bg-slate-100 text-slate-700",
  paused: "bg-amber-50 text-amber-700",
  proposed: "bg-slate-50 text-slate-500",
};

const COLUMNS: { key: string; label: string; title: string }[] = [
  { key: "expected", label: "Expected", title: "Profiles the contract's list route estimates" },
  { key: "discovered", label: "Discovered", title: "Profile pages found so far (queue is per website)" },
  { key: "queued", label: "Queued", title: "Profile pages waiting to be fetched" },
  { key: "harvested", label: "Harvested", title: "Profile pages fetched and done" },
  { key: "skipped", label: "Skipped", title: "Outside the enabled markets, or not a profile page" },
  { key: "failed", label: "Failed", title: "Fetch errors" },
  { key: "staged", label: "Staged", title: "Records in staging for this source and category" },
  { key: "shallow", label: "Shallow", title: "Staged below the minimum fields" },
  { key: "resolved", label: "Resolved", title: "Created, matched or corroborated" },
  { key: "rejected", label: "Rejected", title: "Rejected at staging" },
  { key: "professionals", label: "Professionals", title: "Professional entities from this source in this category" },
  { key: "locations", label: "Locations", title: "Location entities" },
  { key: "brands", label: "Brands", title: "Brand entities" },
  { key: "teams", label: "Teams", title: "Team entities" },
  { key: "gate_passed", label: "Gate passed", title: "Entities that passed the profile gate" },
  { key: "published", label: "Published", title: "Profiles published" },
  { key: "yet_to_harvest", label: "Yet to harvest", title: "Queued, plus expected not yet discovered" },
];

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
          <dd className="break-words text-slate-800">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CountTable({ data, keyLabel }: { data: Record<string, number> | null | undefined; keyLabel: string }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) return <p className="text-sm text-slate-400">None.</p>;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
          <th className="px-2 py-1 font-semibold">{keyLabel}</th>
          <th className="px-2 py-1 text-right font-semibold">Count</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-b border-slate-100 last:border-0">
            <td className="px-2 py-1 font-mono text-xs">{k}</td>
            <td className="px-2 py-1 text-right tabular-nums">{n(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">{children}</div>
    </div>
  );
}

function DetailModal({ row, gcid, onClose }: { row: Row | null; gcid: string; onClose: () => void }) {
  const lr = row?.last_run ?? null;
  return (
    <Dialog open={!!row} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">{row?.source} · {gcidLabel(gcid)}</DialogTitle>
          <DialogDescription>
            Queue counts are per website (shared by its categories); staging, entities, gate and published are for this category.
          </DialogDescription>
        </DialogHeader>
        {row ? (
          <div className="space-y-4">
            <Section title="Source">
              <KV rows={[
                ["Status", row.status ?? "—"],
                ["Gate", row.gate ? `${row.gate}${row.gate_reason ? ` — ${row.gate_reason}` : ""}` : "—"],
                ["Fetch", `${row.crawl_method ?? "—"} / ${row.fetch_tier ?? "—"}`],
                ["Record source", row.record_source ?? "page"],
                ["Field floor", n(row.field_floor)],
                ["Contract learned", when(row.contract_learned_at)],
                ["Daily limit", n(row.daily_quota)],
                ["Fetched today", n(row.fetched_today)],
                ["Last fetch", when(row.last_fetch)],
              ]} />
            </Section>
            <Section title="Funnel">
              <KV rows={[
                ["Expected", n(row.expected)], ["Discovered", n(row.discovered)], ["Yet to harvest", n(row.yet_to_harvest)],
                ["Queued", n(row.queued)], ["Harvested", n(row.harvested)], ["Skipped", n(row.skipped)],
                ["Failed", n(row.failed)], ["List / sitemap units", `${n(row.list_units)} (${n(row.list_units_open)} open)`], ["Staged", n(row.staged)],
                ["Pending", n(row.pending)], ["Shallow", n(row.shallow)], ["Resolved", n(row.resolved)],
                ["Rejected", n(row.rejected)], ["Gate passed", n(row.gate_passed)], ["Gate failed", n(row.gate_failed)],
                ["Professionals", n(row.professionals)], ["Locations", n(row.locations)], ["Brands", n(row.brands)],
                ["Teams", n(row.teams)], ["Published", n(row.published)],
              ]} />
            </Section>
            <div className="grid gap-4 sm:grid-cols-2">
              <Section title="Queue by kind and status"><CountTable data={row.queue_by_kind} keyLabel="kind:status" /></Section>
              <Section title="Staging by status"><CountTable data={row.staging_by_status} keyLabel="status" /></Section>
            </div>
            <Section title="Last run">
              {lr ? (
                <KV rows={[
                  ["Started", when(lr.started_at)], ["Finished", lr.finished_at ? when(lr.finished_at) : "running"],
                  ["Started by", lr.trigger ?? "—"], ["Pages fetched", n(lr.pages_fetched)], ["Staged", n(lr.staged)],
                  ["Skipped outside markets", n(lr.skipped_outside_markets)], ["Last skip reason", lr.last_outside_reason ?? "—"],
                ]} />
              ) : <p className="text-sm text-slate-400">No run yet.</p>}
            </Section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function SourceStatsTab() {
  const [gcid, setGcid] = useState("");
  const [source, setSource] = useState("");
  const [open, setOpen] = useState<Row | null>(null);

  const { data: sourceRows = [] } = useQuery({
    queryKey: ["source_stats_sources"],
    queryFn: async () => {
      const { data, error } = await (supabase as Any).from("exp_etl_sources")
        .select("source_domain, gcid").eq("role_in_discovery", "hierarchy_source");
      if (error) throw error;
      return (data ?? []) as { source_domain: string; gcid: string | null }[];
    },
  });
  const gcids = useMemo(() => [...new Set(sourceRows.map((s) => s.gcid).filter((g): g is string => !!g))].sort(), [sourceRows]);
  const sources = useMemo(
    () => sourceRows.filter((s) => s.gcid === gcid).map((s) => s.source_domain).sort(),
    [sourceRows, gcid],
  );

  const stats = useQuery({
    enabled: !!gcid,
    queryKey: ["source_stats", gcid, source],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await (supabase as Any).rpc("exp_etl_source_stats", { p_gcid: gcid, p_source: source || null });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const rows = stats.data ?? [];
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of COLUMNS) t[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    return t;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">Source Stats</h2>
        <p className="text-sm text-slate-500">
          Every source website of a category, from expected profiles to published. Click a row for the breakdown.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Category</div>
          <select
            className="h-9 min-w-[240px] rounded-md border border-slate-200 bg-white px-2 text-sm text-ink"
            value={gcid}
            onChange={(e) => { setGcid(e.target.value); setSource(""); }}
          >
            <option value="">Choose a category</option>
            {gcids.map((g) => <option key={g} value={g}>{gcidLabel(g)}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Source</div>
          <select
            className="h-9 min-w-[240px] rounded-md border border-slate-200 bg-white px-2 text-sm text-ink disabled:opacity-50"
            value={source}
            disabled={!gcid}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">{gcid ? "All sources" : "Choose a category first"}</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={!gcid || stats.isFetching} onClick={() => stats.refetch()}>
          <RefreshCw className={cn("h-4 w-4", stats.isFetching && "animate-spin")} /> {stats.isFetching ? "Loading…" : "Refresh"}
        </Button>
        {stats.dataUpdatedAt ? <span className="text-xs text-slate-400">Updated {when(new Date(stats.dataUpdatedAt).toISOString())}</span> : null}
      </div>

      {!gcid ? (
        <p className="text-sm text-slate-500">Choose a category to see its sources.</p>
      ) : stats.error ? (
        <p className="text-sm text-red-700">{String((stats.error as Error).message ?? stats.error)}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="sticky left-0 bg-slate-50 px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.title} className="whitespace-nowrap px-3 py-2 text-right font-semibold">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.isLoading ? (
                <tr><td colSpan={COLUMNS.length + 2} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLUMNS.length + 2} className="px-3 py-6 text-center text-slate-400">No sources for this category.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.source_id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(r)}>
                    <td className="sticky left-0 bg-white px-3 py-2 font-medium text-ink">{r.source}</td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className={cn("font-normal", STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600")}>{r.status}</Badge>
                      {r.gate === "BLOCKED" ? <span className="ml-1 text-[10px] text-amber-700">gate blocked</span> : null}
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">{n(r[c.key])}</td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 1 ? (
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="sticky left-0 bg-slate-50 px-3 py-2">Total</td>
                  <td className="px-3 py-2" />
                  {COLUMNS.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{n(totals[c.key])}</td>)}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      <DetailModal row={open} gcid={gcid} onClose={() => setOpen(null)} />
    </div>
  );
}
