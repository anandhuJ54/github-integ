import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, ShieldCheck, TrendingUp } from "lucide-react";
import {
  Panel,
  StatTile,
  DataTable,
  EmptyState,
  type Column,
} from "@v3/ui/components/console/primitives";
import { loadEtlMonitor, type FlaggedRow } from "@v3/etl/lib/etl-monitor";
import { num } from "@v3/ui/lib/console-surfaces";
import { cn } from "@v3/ui/lib/utils";

const pctOf = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 1000) / 10}%` : "—";

function gateTone(rate: number) {
  if (rate < 0.02) return { tone: "green" as const, label: "Healthy", cls: "text-[#1e8e3e]" };
  if (rate < 0.08) return { tone: "yellow" as const, label: "Watch", cls: "text-[#b06000]" };
  return { tone: "red" as const, label: "Degraded", cls: "text-[#c5221f]" };
}

export function EtlRunMonitor() {
  const { data, isLoading } = useQuery({
    queryKey: ["etl-run-monitor"],
    queryFn: loadEtlMonitor,
    refetchInterval: 30_000,
  });

  const p = data?.progress;
  const y = data?.yield;
  const g = data?.gate;
  const d = data?.depth;
  const gt = gateTone(g?.shallowRate ?? 0);

  const flaggedColumns: Column<FlaggedRow>[] = [
    {
      key: "url",
      header: "Detail URL",
      cell: (r) => (
        <span className="block max-w-[420px] truncate font-mono text-[11px] text-[color:var(--color-ink-2)]">
          {r.detail_url ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Flag",
      cell: (r) => (
        <span className="inline-flex items-center rounded-full bg-[color:var(--color-g-yellow-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#b06000]">
          {r.resolution_status}
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => (
        <span className="text-xs text-[color:var(--color-ink-2)]">
          {r.reasons.length ? r.reasons.join("; ") : "—"}
        </span>
      ),
    },
    {
      key: "at",
      header: "Flagged",
      align: "right",
      cell: (r) => (
        <span className="text-xs text-[color:var(--color-ink-3)]">
          {r.resolved_at ? new Date(r.resolved_at).toLocaleString() : "—"}
        </span>
      ),
    },
  ];

  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[color:var(--color-ink-3)]" />
        <h2 className="text-sm font-semibold text-ink">ETL run monitor — State Farm deep hydration</h2>
        <span className="text-xs text-[color:var(--color-ink-3)]">read-only · refreshes every 30s</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Staged agents"
          value={num(p?.total)}
          hint="exp_etl_staging · gcid:insurance_agent"
          icon={<Gauge className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatTile
          label="Processed"
          value={num(p?.processed)}
          hint={p ? `${Math.round(p.pctComplete * 1000) / 10}% complete` : undefined}
          tone="green"
          loading={isLoading}
        />
        <StatTile
          label="Remaining"
          value={num(p?.remaining)}
          hint="field_tier = core"
          loading={isLoading}
        />
        <StatTile
          label="Gate flags"
          value={num(g?.flagged)}
          hint={g ? `${Math.round(g.shallowRate * 1000) / 10}% shallow rate · ${gt.label}` : undefined}
          tone={gt.tone}
          icon={<ShieldCheck className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Panel
          title="Run progress"
          description="Deterministic parser drain across the staged agent universe."
          className="lg:col-span-2"
        >
          <div className="h-3 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
            <div
              className="h-full rounded-full bg-[color:var(--color-g-blue)] transition-[width] duration-500"
              style={{ width: `${Math.min((p?.pctComplete ?? 0) * 100, 100)}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--color-ink-2)]">
            <span>
              {num(p?.processed)} of {num(p?.total)} processed
            </span>
            <span className="font-semibold text-ink">
              {p ? `${Math.round(p.pctComplete * 1000) / 10}%` : "—"}
            </span>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { label: "product_service nodes", value: num(y?.nodes.product_service) },
              { label: "social_profile nodes", value: num(y?.nodes.social_profile) },
              { label: "credential nodes", value: num(y?.nodes.credential) },
            ].map((r) => (
              <div
                key={r.label}
                className="rounded-[12px] border border-[color:var(--color-hairline)] px-4 py-3"
              >
                <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-ink-3)]">
                  {r.label}
                </div>
                <div className="mt-1 text-lg font-semibold text-ink">{r.value}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Depth: before vs after" description="Captured fields per hydrated profile.">
          <div className="flex items-end gap-6">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-ink-3)]">
                Before (core)
              </div>
              <div className="text-3xl font-semibold text-[color:var(--color-ink-3)]">
                {d?.baseline ?? "—"}
              </div>
            </div>
            <TrendingUp className="mb-2 h-5 w-5 text-[#1e8e3e]" />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-ink-3)]">
                Now (deep)
              </div>
              <div className="text-3xl font-semibold text-ink">{d?.avgFieldsNow ?? "—"}</div>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[color:var(--color-ink-2)]">
            Mean over {num(d?.deepRows)} deep-extracted staging rows
            {d?.avgFieldsNow
              ? ` — ${Math.round((d.avgFieldsNow / d.baseline) * 10) / 10}× the core capture.`
              : "."}
          </p>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel
          title="Yield quality"
          description="Promoted State Farm agency profiles and their capture completeness."
        >
          {isLoading || !y ? (
            <div className="h-32 animate-pulse rounded-lg bg-[color:var(--color-surface-2)]" />
          ) : (
            <dl className="space-y-3 text-sm">
              {[
                { label: "Promoted profiles", value: num(y.profiles) },
                { label: "With bio", value: `${pctOf(y.withBio, y.profiles)} (${num(y.withBio)})` },
                {
                  label: "With photo",
                  value: `${pctOf(y.withPhoto, y.profiles)} (${num(y.withPhoto)})`,
                },
                {
                  label: "With Google place id",
                  value: `${pctOf(y.withPlaceId, y.profiles)} (${num(y.withPlaceId)})`,
                },
                {
                  label: "Products / profile",
                  value: y.profiles
                    ? String(Math.round((y.nodes.product_service / y.profiles) * 10) / 10)
                    : "—",
                },
                {
                  label: "Socials / profile",
                  value: y.profiles
                    ? String(Math.round((y.nodes.social_profile / y.profiles) * 10) / 10)
                    : "—",
                },
                {
                  label: "Licenses / profile",
                  value: y.profiles
                    ? String(Math.round((y.nodes.credential / y.profiles) * 10) / 10)
                    : "—",
                },
              ].map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between border-b border-[color:var(--color-hairline)] pb-2 last:border-0 last:pb-0"
                >
                  <dt className="text-[color:var(--color-ink-2)]">{r.label}</dt>
                  <dd className="font-semibold text-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
            Node ratios count every etl-sourced node, including office team credentials.
          </p>
        </Panel>

        <Panel
          title="Field-yield gate"
          description="Per-category floor config; failures are flagged, never promoted."
        >
          <div className="mb-4 flex items-center gap-2">
            <span className={cn("text-sm font-semibold", gt.cls)}>{gt.label}</span>
            <span className="text-xs text-[color:var(--color-ink-2)]">
              {g ? `${Math.round(g.shallowRate * 1000) / 10}% of processed rows flagged` : "—"}
            </span>
          </div>
          {g?.floors.length ? (
            <ul className="space-y-2">
              {g.floors.map((f) => (
                <li
                  key={f.gcid}
                  className="rounded-[12px] border border-[color:var(--color-hairline)] px-4 py-3"
                >
                  <div className="font-mono text-xs text-ink">{f.gcid}</div>
                  <div className="mt-1 text-xs text-[color:var(--color-ink-2)]">
                    ≥{f.min_fields} fields · ≥{f.min_products ?? 0} products · ≥
                    {f.min_licenses ?? 0} licenses
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--color-ink-3)]">
                    required: {f.required_keys?.length ? f.required_keys.join(", ") : "—"}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No floors configured"
              description="The engine falls back to an 8-field minimum."
              compact
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Recently flagged captures"
        description="Rows held back by the gate, with the reason they failed."
        className="mt-6"
        bodyClassName="px-3 py-2"
      >
        <DataTable
          columns={flaggedColumns}
          rows={g?.recent ?? []}
          loading={isLoading}
          getRowKey={(r) => r.stage_id}
          empty={
            <EmptyState
              title="No flagged rows"
              description="Every processed capture has cleared its category floor."
              compact
            />
          }
        />
      </Panel>
    </section>
  );
}
