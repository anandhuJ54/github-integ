import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BadgeCheck, Building2, ExternalLink, Network } from "lucide-react";
import {
  loadExpertiseGraph,
  branchMeta,
  branchOf,
  nodeLabel,
  type GraphKind,
  type GraphNode,
} from "@v3/search/utils/expertise-graph";
import { ExpertiseGraphCanvas } from "@v3/search/components/graph/expertise-graph-canvas";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-white">{value}</div>
      {hint ? <div className="text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

export function ExpertiseGraphPage({ kind, slug }: { kind: GraphKind; slug: string }) {
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["expertise-graph", kind, slug],
    queryFn: () => loadExpertiseGraph(kind, slug),
  });

  const summary = data?.summary ?? [];
  const maxCount = Math.max(1, ...summary.map((s) => s.count));
  const populatedBranches = summary.filter((s) => s.populated).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        {isLoading ? (
          <div className="py-32 text-center text-slate-400">Loading expertise graph…</div>
        ) : !data ? (
          <div className="py-32 text-center">
            <Network className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            <h1 className="text-xl font-semibold">Entity not found</h1>
            <p className="mt-1 text-sm text-slate-400">
              No {kind} exists for “{slug}”.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <Link
                  to={data.entity.profileHref}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 transition hover:text-slate-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back to profile
                </Link>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                  {data.entity.name}
                  <span className="ml-3 align-middle text-sm font-normal text-cyan-300/80">
                    Expertise Graph
                  </span>
                </h1>
                {data.entity.subtitle ? (
                  <p className="mt-1 text-sm text-slate-400">{data.entity.subtitle}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {data.office ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-300">
                      <Building2 className="h-3.5 w-3.5" /> {data.office.name}
                    </span>
                  ) : null}
                  {data.brand ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-400/25 bg-fuchsia-400/10 px-2.5 py-1 text-fuchsia-200">
                      {data.brand.name}
                    </span>
                  ) : null}
                  {data.entity.gcid ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-400">
                      {data.entity.gcid}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Live nodes" value={data.liveCount} hint="from connectors / ETL" />
                <Stat label="Record nodes" value={data.derivedCount} hint="from the profile record" />
                <Stat label="Rings populated" value={`${populatedBranches}/${summary.length}`} />
                <Stat
                  label="Search rank"
                  value={
                    data.entity.score != null
                      ? `${data.entity.score}/${data.entity.maxScore ?? 850}`
                      : "—"
                  }
                  hint={
                    data.entity.score == null
                      ? "not scored yet"
                      : data.localRank
                        ? `#${data.localRank}${data.localRankOf ? ` of ${data.localRankOf}` : ""}`
                        : undefined
                  }
                />
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
              <div>
                {data.nodes.length === 0 ? (
                  <div className="flex h-[70vh] min-h-[520px] flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.02] text-center">
                    <Network className="mb-3 h-8 w-8 text-slate-600" />
                    <p className="text-lg font-medium text-white">Graph not populated yet</p>
                    <p className="mt-1 max-w-sm text-sm text-slate-400">
                      No active graph nodes exist for this entity. Once discovery and
                      connectors populate the rings, they will appear here live.
                    </p>
                  </div>
                ) : (
                  <ExpertiseGraphCanvas
                    graph={data}
                    onSelect={setSelected}
                    selectedId={selected?.id ?? null}
                  />
                )}

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
                  {summary.map((s) => (
                    <span
                      key={s.key}
                      className={s.populated ? "inline-flex items-center gap-2" : "inline-flex items-center gap-2 opacity-45"}
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: s.color }}
                      />
                      {s.label}
                      <span className="text-slate-500">{s.count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400">
                    Ring completeness
                  </p>
                  <div className="mt-3 space-y-2.5">
                    {summary.map((s) => (
                      <div key={s.key}>
                        <div className="flex items-center justify-between text-xs">
                          <span className={s.populated ? "text-slate-200" : "text-slate-500"}>
                            {s.label}
                          </span>
                          <span className={s.populated ? "font-mono text-slate-300" : "text-slate-600"}>
                            {s.populated ? s.count : "not captured"}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.round((s.count / maxCount) * 100)}%`,
                              background: s.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </aside>

                <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  {selected ? (
                    <div className="space-y-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">
                          {branchMeta(selected.branch ?? branchOf(selected)).label}
                        </div>
                        <h2 className="mt-1 text-lg font-semibold leading-snug text-white">
                          {nodeLabel(selected)}
                        </h2>
                      </div>
                      <dl className="space-y-2.5 text-sm">
                        <Row label="Node type" value={selected.node_type.replace(/_/g, " ")} />
                        <Row label="Ring" value={String(selected.ring)} />
                        <Row
                          label="Source"
                          value={selected.structural ? "profile record" : selected.source}
                        />
                        {selected.schema_type ? (
                          <Row label="Schema type" value={selected.schema_type} />
                        ) : null}
                        {selected.schema_property ? (
                          <Row label="Schema property" value={selected.schema_property} />
                        ) : null}
                        {selected.score_points != null ? (
                          <Row
                            label="Score points"
                            value={`${selected.score_points}${selected.score_counted ? " (counted)" : ""}`}
                          />
                        ) : null}
                      </dl>
                      <div
                        className={
                          selected.verified
                            ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-300"
                            : "inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-300"
                        }
                      >
                        <BadgeCheck className="h-3.5 w-3.5" />
                        {selected.verified ? "Verified" : "Unverified"}
                      </div>
                      {selected.url || selected.source_url ? (
                        <a
                          href={(selected.url ?? selected.source_url)!}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-sm text-cyan-300 hover:text-cyan-200"
                        >
                          Open source <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">
                      <p className="font-medium text-slate-200">Node inspector</p>
                      <p className="mt-2">
                        Click any node to inspect its title, source, schema mapping and
                        verification state. Scroll to zoom, drag to pan, hover a branch to
                        isolate it.
                      </p>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-100">{value}</dd>
    </div>
  );
}
