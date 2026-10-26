import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { api } from "@v3/ui/lib/server-fn";
import { cn } from "@v3/ui/lib/utils";

type RunRow = {
  run_id: string;
  source_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  pages_fetched: number | null;
  pulled: number | null;
  staged: number | null;
  matched: number | null;
  created: number | null;
  conflicted: number | null;
  errors: number | null;
  entities_yielded: number | null;
};

type FrontierRow = { kind: string | null; status: string | null };

const KINDS = ["sitemap_index", "sitemap", "office_page", "agent_page"];
const STATUSES = ["queued", "fetched", "parsed", "error"];

function fmt(v: string | null) {
  return v ? new Date(v).toLocaleString() : "—";
}

export function RunsTab() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["exp_etl_runs"],
    queryFn: () => api.get<RunRow[]>("/etl/console/runs"),
  });

  const sourceIds = useMemo(
    () => Array.from(new Set(runs.map((r) => r.source_id).filter(Boolean) as string[])),
    [runs],
  );

  const { data: domains = {} } = useQuery({
    enabled: sourceIds.length > 0,
    queryKey: ["exp_etl_runs_domains", sourceIds],
    queryFn: async () => {
      const data = await api.post<{ source_id: string; source_domain: string }[]>("/etl/console/source-domains", {
        ids: sourceIds,
      });
      const map: Record<string, string> = {};
      for (const r of data) map[r.source_id] = r.source_domain;
      return map;
    },
  });

  const { data: frontier = [] } = useQuery({
    queryKey: ["exp_etl_frontier_matrix"],
    // capped at 1000 rows, as the REST read was (docs/BROWSER_TO_API_FOLLOWUPS.md)
    queryFn: () => api.get<FrontierRow[]>("/etl/console/frontier-matrix"),
  });

  const matrix = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const row of frontier) {
      const k = row.kind ?? "unknown";
      const s = row.status ?? "unknown";
      m[k] ??= {};
      m[k][s] = (m[k][s] ?? 0) + 1;
    }
    const kinds = Array.from(new Set([...KINDS, ...Object.keys(m)]));
    return { m, kinds };
  }, [frontier]);

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Frontier</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Kind</th>
                {STATUSES.map((s) => (
                  <th key={s} className="px-3 py-2.5 text-right capitalize">
                    {s}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.kinds.map((k) => {
                const row = matrix.m[k] ?? {};
                const total = Object.values(row).reduce((a, b) => a + b, 0);
                return (
                  <tr key={k} className="border-b border-slate-100">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{k}</td>
                    {STATUSES.map((s) => (
                      <td
                        key={s}
                        className={cn(
                          "px-3 py-2.5 text-right tabular-nums",
                          s === "error" && (row[s] ?? 0) > 0 && "font-semibold text-red-600",
                          (row[s] ?? 0) === 0 && "text-slate-400",
                        )}
                      >
                        {row[s] ?? 0}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            remax.com office pages returned 403 (bot defense) — detail fetching needs the
            browser-worker layer.
          </span>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Runs</h2>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5">Started</th>
                <th className="px-3 py-2.5">Finished</th>
                <th className="px-3 py-2.5 text-right">Pages</th>
                <th className="px-3 py-2.5 text-right">Pulled</th>
                <th className="px-3 py-2.5 text-right">Staged</th>
                <th className="px-3 py-2.5 text-right">Matched</th>
                <th className="px-3 py-2.5 text-right">Created</th>
                <th className="px-3 py-2.5 text-right">Conflicted</th>
                <th className="px-3 py-2.5 text-right">Errors</th>
                <th className="px-3 py-2.5 text-right">Entities</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading runs…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-sm text-slate-500">
                    No runs yet — harvesters have not executed.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.run_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-medium text-ink">
                      {(r.source_id && domains[r.source_id]) || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmt(r.started_at)}</td>
                    <td className="px-3 py-2.5 text-slate-600">{fmt(r.finished_at)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.pages_fetched ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.pulled ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.staged ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.matched ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.created ?? 0}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.conflicted ?? 0}</td>
                    <td
                      className={
                        (r.errors ?? 0) > 0
                          ? "px-3 py-2.5 text-right font-semibold tabular-nums text-red-600"
                          : "px-3 py-2.5 text-right tabular-nums"
                      }
                    >
                      {r.errors ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {r.entities_yielded ?? 0}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
