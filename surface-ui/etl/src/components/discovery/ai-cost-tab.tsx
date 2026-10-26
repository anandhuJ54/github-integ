import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api } from "@v3/state/api/server-fn";
import { Button } from "@v3/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@v3/shared/components/ui/dialog";
import { cn } from "@v3/shared/components/utils/utils";

/* AI Cost (2026-10-22): the ETL AI cost log (exp_etl_cost_events) — one row per AI call or research step, written by
   the worker and by boundary generation. Filters by period, category, site and activity; totals and averages per
   activity (a "run" is one worker request: a discovery round, a method check, one site map; boundary generation from
   the panel counts each event), cost per site and per category, and the log with a detail view. Loaded when the tab
   opens or on Refresh (no polling). */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ev = {
  event_id: number; occurred_at: string; activity: string; model: string; calls: number;
  input_tokens: number; cache_read_tokens: number; cache_write_tokens: number; output_tokens: number;
  cost_usd: number | string; gcid: string | null; domain: string | null; request_id: number | null; job_id: number | null;
  detail: Record<string, any> | null;
};

const ACTIVITY_LABEL: Record<string, string> = {
  discovery: "Discovery",
  boundary: "Boundary generation",
  method_check: "Method check",
  map_contract: "Mapping – contract",
  map_research: "Mapping – list research",
  extra_match: "Extras matching",
};
const ACTIVITY_ORDER = ["discovery", "boundary", "method_check", "map_research", "map_contract", "extra_match"];
const PERIODS: { key: string; label: string; days: number | null }[] = [
  { key: "1", label: "Last 24 hours", days: 1 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "all", label: "All time", days: null },
];

const usd = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const num = (v: number) => Math.round(v).toLocaleString();
const when = (v: string) => new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const gcidLabel = (g: string | null) => (g ? g.replace(/^gcid:/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—");
const actLabel = (a: string) => ACTIVITY_LABEL[a] ?? a;
const cost = (e: Ev) => Number(e.cost_usd) || 0;
const runKey = (e: Ev) => (e.request_id != null ? `r${e.request_id}` : `e${e.event_id}`);

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div> : null}
    </div>
  );
}

function Table({ head, rows, onRow }: { head: string[]; rows: (string | number)[][]; onRow?: (i: number) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            {head.map((h, i) => <th key={h} className={cn("px-3 py-2 font-semibold", i > 0 && "text-right")}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="px-3 py-4 text-center text-slate-400">Nothing logged for this selection.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className={cn("border-b border-slate-100 last:border-0", onRow && "cursor-pointer hover:bg-slate-50")} onClick={onRow ? () => onRow(i) : undefined}>
              {r.map((c, j) => <td key={j} className={cn("px-3 py-1.5", j > 0 ? "text-right tabular-nums" : "text-ink")}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AiCostTab() {
  const [period, setPeriod] = useState("7");
  const [gcid, setGcid] = useState("");
  const [domain, setDomain] = useState("");
  const [activity, setActivity] = useState("");
  const [open, setOpen] = useState<Ev | null>(null);

  const days = PERIODS.find((p) => p.key === period)?.days ?? null;
  const q = useQuery({
    queryKey: ["etl_ai_cost_events", period],
    staleTime: Infinity,
    queryFn: () =>
      api.get<Ev[]>("/etl/console/ai-cost-events", {
        params: { since: days != null ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined },
      }),
  });
  const all = q.data ?? [];
  const gcids = useMemo(() => [...new Set(all.map((e) => e.gcid).filter((g): g is string => !!g))].sort(), [all]);
  const domains = useMemo(
    () => [...new Set(all.filter((e) => !gcid || e.gcid === gcid).map((e) => e.domain).filter((d): d is string => !!d))].sort(),
    [all, gcid],
  );
  const activities = useMemo(() => {
    const seen = new Set(all.map((e) => e.activity));
    return [...ACTIVITY_ORDER.filter((a) => seen.has(a)), ...[...seen].filter((a) => !ACTIVITY_ORDER.includes(a)).sort()];
  }, [all]);
  const rows = useMemo(
    () => all.filter((e) => (!gcid || e.gcid === gcid) && (!domain || e.domain === domain) && (!activity || e.activity === activity)),
    [all, gcid, domain, activity],
  );

  const total = rows.reduce((s, e) => s + cost(e), 0);
  const calls = rows.reduce((s, e) => s + (e.calls || 1), 0);
  const runs = new Set(rows.map(runKey)).size;
  const unpriced = rows.filter((e) => e.detail?.unpriced).length;

  const byActivity = useMemo(() => {
    const m = new Map<string, { runs: Set<string>; calls: number; inT: number; outT: number; cost: number }>();
    for (const e of rows) {
      const a = m.get(e.activity) ?? { runs: new Set<string>(), calls: 0, inT: 0, outT: 0, cost: 0 };
      a.runs.add(runKey(e)); a.calls += e.calls || 1;
      a.inT += (e.input_tokens || 0) + (e.cache_read_tokens || 0) + (e.cache_write_tokens || 0); a.outT += e.output_tokens || 0;
      a.cost += cost(e); m.set(e.activity, a);
    }
    const order = [...ACTIVITY_ORDER, ...[...m.keys()].filter((k) => !ACTIVITY_ORDER.includes(k)).sort()];
    return order.filter((k) => m.has(k)).map((k) => {
      const a = m.get(k)!;
      return [actLabel(k), num(a.runs.size), num(a.calls), num(a.inT), num(a.outT), usd(a.cost), usd(a.cost / Math.max(1, a.runs.size)), usd(a.cost / Math.max(1, a.calls))];
    });
  }, [rows]);

  // A site map spans list research, the contract and extras matching on one request: cost per mapped site.
  const mapping = useMemo(() => {
    const per = new Map<string, number>();
    for (const e of rows) if (e.activity.startsWith("map_") || e.activity === "extra_match") per.set(runKey(e), (per.get(runKey(e)) ?? 0) + cost(e));
    const vals = [...per.values()];
    return { maps: vals.length, avg: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0 };
  }, [rows]);

  const bySite = useMemo(() => {
    const m = new Map<string, { gcid: string | null; domain: string; runs: Set<string>; calls: number; cost: number }>();
    for (const e of rows) {
      if (!e.domain) continue;
      const k = `${e.gcid}|${e.domain}`;
      const a = m.get(k) ?? { gcid: e.gcid, domain: e.domain, runs: new Set<string>(), calls: 0, cost: 0 };
      a.runs.add(runKey(e)); a.calls += e.calls || 1; a.cost += cost(e); m.set(k, a);
    }
    return [...m.values()].sort((x, y) => y.cost - x.cost).map((a) => [a.domain, gcidLabel(a.gcid), num(a.runs.size), num(a.calls), usd(a.cost)]);
  }, [rows]);

  const byCategory = useMemo(() => {
    const m = new Map<string, { sites: Set<string>; runs: Set<string>; cost: number }>();
    for (const e of rows) {
      const k = e.gcid ?? "";
      const a = m.get(k) ?? { sites: new Set<string>(), runs: new Set<string>(), cost: 0 };
      if (e.domain) a.sites.add(e.domain);
      a.runs.add(runKey(e)); a.cost += cost(e); m.set(k, a);
    }
    return [...m.entries()].sort((x, y) => y[1].cost - x[1].cost).map(([g, a]) => [gcidLabel(g || null), num(a.sites.size), num(a.runs.size), usd(a.cost)]);
  }, [rows]);

  const log = rows.slice(0, 300);
  const sel = "h-9 min-w-[200px] rounded-md border border-slate-200 bg-white px-2 text-sm text-ink disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">AI Cost</h2>
        <p className="text-sm text-slate-500">
          What the ETL AI calls cost: discovery, boundary generation, method checks, mapping and extras matching. Dollars are
          tokens times the model&apos;s list price. Logging started on 2026-10-22.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Period</div>
          <select className={sel} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Category</div>
          <select className={sel} value={gcid} onChange={(e) => { setGcid(e.target.value); setDomain(""); }}>
            <option value="">All categories</option>
            {gcids.map((g) => <option key={g} value={g}>{gcidLabel(g)}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Site</div>
          <select className={sel} value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">All sites</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <div className="mb-1 font-semibold uppercase tracking-wider">Activity</div>
          <select className={sel} value={activity} onChange={(e) => setActivity(e.target.value)}>
            <option value="">All activities</option>
            {activities.map((a) => <option key={a} value={a}>{actLabel(a)}</option>)}
          </select>
        </label>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={q.isFetching} onClick={() => q.refetch()}>
          <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} /> {q.isFetching ? "Loading…" : "Refresh"}
        </Button>
        {q.dataUpdatedAt ? <span className="text-xs text-slate-400">Updated {when(new Date(q.dataUpdatedAt).toISOString())}</span> : null}
      </div>

      {q.error ? (
        <p className="text-sm text-red-700">{String((q.error as Error).message ?? q.error)}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Card label="Total cost" value={usd(total)} />
            <Card label="Runs" value={num(runs)} hint="worker requests (discovery round, method check, site map)" />
            <Card label="AI calls" value={num(calls)} />
            <Card label="Average per site map" value={usd(mapping.avg)} hint={`${num(mapping.maps)} maps`} />
            <Card label="Unpriced calls" value={num(unpriced)} hint="model without a list price; tokens kept" />
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">By activity</h3>
            <Table head={["Activity", "Runs", "AI calls", "Input tokens", "Output tokens", "Total", "Avg per run", "Avg per call"]} rows={byActivity} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">By site</h3>
              <Table head={["Site", "Category", "Runs", "AI calls", "Cost"]} rows={bySite} />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">By category</h3>
              <Table head={["Category", "Sites", "Runs", "Cost"]} rows={byCategory} />
            </section>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">
              Log <span className="font-normal text-slate-400">({rows.length > log.length ? `latest ${log.length} of ${num(rows.length)}` : num(rows.length)}; click a line for details)</span>
            </h3>
            <Table
              head={["Time", "Activity", "Category", "Site", "Model", "Calls", "Tokens in / out", "Cost"]}
              rows={log.map((e) => [
                when(e.occurred_at), actLabel(e.activity), gcidLabel(e.gcid), e.domain ?? "—", e.model, num(e.calls || 1),
                `${num((e.input_tokens || 0) + (e.cache_read_tokens || 0) + (e.cache_write_tokens || 0))} / ${num(e.output_tokens || 0)}`,
                e.detail?.unpriced ? "unpriced" : usd(cost(e)),
              ])}
              onRow={(i) => setOpen(log[i])}
            />
          </section>
        </>
      )}

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{open ? actLabel(open.activity) : ""} · {open?.domain ?? gcidLabel(open?.gcid ?? null)}</DialogTitle>
            <DialogDescription>{open ? when(open.occurred_at) : ""}</DialogDescription>
          </DialogHeader>
          {open ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              {([
                ["Category", gcidLabel(open.gcid)], ["Site", open.domain ?? "—"], ["Model", open.model], ["AI calls", num(open.calls || 1)],
                ["Input tokens", num(open.input_tokens)], ["Cache read tokens", num(open.cache_read_tokens)],
                ["Cache write tokens", num(open.cache_write_tokens)], ["Output tokens", num(open.output_tokens)],
                ["Cost", open.detail?.unpriced ? "unpriced" : usd(cost(open))], ["Request", open.request_id != null ? `#${open.request_id}` : "—"],
                ["Job", open.job_id != null ? `#${open.job_id}` : "—"], ["Event", `#${open.event_id}`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}><dt className="text-[11px] uppercase tracking-wider text-slate-500">{k}</dt><dd className="text-ink">{v}</dd></div>
              ))}
              <div className="col-span-2">
                <dt className="text-[11px] uppercase tracking-wider text-slate-500">Detail</dt>
                <dd><pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2 text-xs text-slate-700">{JSON.stringify(open.detail ?? {}, null, 2)}</pre></dd>
              </div>
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
