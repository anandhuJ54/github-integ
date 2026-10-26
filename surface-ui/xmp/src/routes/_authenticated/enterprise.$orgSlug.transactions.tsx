/**
 * Enterprise → Transactions: data feeds & ingestion health for the
 * impersonated organization. Read-only, real-only: feeds/jobs come from
 * crm_integrations, oauth_connections and sync_jobs scoped to this org. When
 * nothing is wired, each panel and record-state tab renders an honest
 * "instrument to activate" state with the structure in place.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, Download, PlugZap, RefreshCw } from "lucide-react";
import { XmpShell } from "@v3/xmp/components/enterprise/xmp-chrome";
import {
  Column,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/shared/components/ui/console-primitives";
import { Button } from "@v3/shared/components/ui/button";
import { loadBrand } from "@v3/xmp/utils/enterprise-xmp";
import {
  RECORD_STATES,
  csvExport,
  loadIngestion,
  type FeedHealth,
  type FeedRow,
  type SyncJobRow,
  type VolumeAuditRow,
} from "@v3/xmp/utils/enterprise-ops";
import { cn } from "@v3/shared/components/utils/utils";

export const Route = createFileRoute("/_authenticated/enterprise/$orgSlug/transactions")({
  ssr: false,
  component: EnterpriseTransactions,
});

const HEALTH: Record<FeedHealth, { label: string; className: string }> = {
  live: { label: "Live", className: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]" },
  stale: { label: "Behind cadence", className: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]" },
  error: { label: "Error", className: "bg-[color:var(--color-g-red-soft)] text-[#c5221f]" },
  never: { label: "Never received", className: "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]" },
};

function HealthChip({ health }: { health: FeedHealth }) {
  const h = HEALTH[health];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        h.className,
      )}
    >
      {h.label}
    </span>
  );
}

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

function Instrument({ title, description }: { title: string; description: string }) {
  return (
    <EmptyState
      compact
      icon={<PlugZap className="h-4 w-4" />}
      title={title}
      description={description}
      action={
        <span className="inline-flex items-center rounded-full bg-[color:var(--color-g-blue-soft)] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-g-blue)]">
          Instrument to activate
        </span>
      }
    />
  );
}

function EnterpriseTransactions() {
  const { orgSlug } = Route.useParams();
  const brandQ = useQuery({ queryKey: ["xmp-brand", orgSlug], queryFn: () => loadBrand(orgSlug) });
  const orgId = brandQ.data?.id;
  const dataQ = useQuery({
    queryKey: ["xmp-ingestion", orgId],
    queryFn: () => loadIngestion(orgId!),
    enabled: !!orgId,
  });

  const [tab, setTab] = useState<string>(RECORD_STATES[1]);
  const snap = dataQ.data;
  const feeds = snap?.feeds ?? [];
  const jobs = snap?.jobs ?? [];

  const failures = useMemo(
    () => jobs.filter((j) => (j.records_failed ?? 0) > 0 || (j.status ?? "") === "failed"),
    [jobs],
  );

  const feedCols: Column<FeedRow>[] = [
    {
      key: "feed",
      header: "Feed",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{r.display_name}</p>
          <p className="text-[11px] text-[color:var(--color-ink-3)]">
            {r.kind === "crm" ? "CRM / LOS" : "Connector"} · {r.provider}
          </p>
        </div>
      ),
    },
    { key: "dir", header: "Direction", cell: (r) => r.direction ?? "—" },
    { key: "cadence", header: "Expected cadence", cell: (r) => r.cadence ?? "Not set" },
    { key: "last", header: "Last received", cell: (r) => fmtDate(r.last_sync_at) },
    {
      key: "records",
      header: "Records",
      align: "right",
      cell: (r) => (r.records_synced ?? 0).toLocaleString(),
    },
    { key: "health", header: "Health", align: "right", cell: (r) => <HealthChip health={r.health} /> },
  ];

  const jobCols: Column<SyncJobRow>[] = [
    { key: "type", header: "Job", cell: (r) => r.job_type ?? "sync" },
    { key: "status", header: "Status", cell: (r) => r.status ?? "—" },
    { key: "started", header: "Started", cell: (r) => fmtDate(r.started_at) },
    {
      key: "failed",
      header: "Didn't go out",
      align: "right",
      cell: (r) => (r.records_failed ?? 0).toLocaleString(),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => (
        <span className="line-clamp-2 text-xs text-[color:var(--color-ink-2)]">
          {r.error_log ? JSON.stringify(r.error_log).slice(0, 180) : "No reason recorded"}
        </span>
      ),
    },
  ];

  const auditCols: Column<VolumeAuditRow>[] = [
    { key: "p", header: "Source", cell: (r) => r.provider },
    {
      key: "crm",
      header: "Their CRM count",
      align: "right",
      cell: (r) => (r.crm_reported === null ? "Not reported" : r.crm_reported.toLocaleString()),
    },
    {
      key: "ing",
      header: "We ingested",
      align: "right",
      cell: (r) => r.ingested.toLocaleString(),
    },
    {
      key: "var",
      header: "Variance",
      align: "right",
      cell: (r) =>
        r.variance === null ? (
          <span className="text-xs text-[color:var(--color-ink-3)]">—</span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              r.variance === 0
                ? "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]"
                : "bg-[color:var(--color-g-red-soft)] text-[#c5221f]",
            )}
          >
            {r.variance !== 0 ? <AlertTriangle className="h-3 w-3" /> : null}
            {r.variance > 0 ? `+${r.variance.toLocaleString()}` : r.variance.toLocaleString()}
          </span>
        ),
    },
    { key: "last", header: "Last sync", cell: (r) => fmtDate(r.last_sync_at) },
  ];

  return (
    <XmpShell brand={brandQ.data ?? null} slug={orgSlug}>
      <PageHeader
        eyebrow="Data operations"
        title="Transactions"
        description="Inbound feed health, delivery failures, and the CRM-versus-feed volume reconciliation for this organization. Read-only."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="rounded-[10px] text-xs font-semibold"
            onClick={() => void dataQ.refetch()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Inbound feeds"
          value={feeds.length.toLocaleString()}
          hint={`${feeds.filter((f) => f.health === "live").length} live`}
          icon={<Database className="h-4 w-4" />}
          loading={dataQ.isLoading}
        />
        <StatTile
          label="Records ingested"
          value={(snap?.totals.processed ?? 0).toLocaleString()}
          hint="Across recorded sync jobs"
          tone="green"
          loading={dataQ.isLoading}
        />
        <StatTile
          label="Didn't go out"
          value={(snap?.totals.failed ?? 0).toLocaleString()}
          hint="Failed records with reasons"
          tone="red"
          loading={dataQ.isLoading}
        />
        <StatTile
          label="Sync jobs on file"
          value={(snap?.totals.jobs ?? 0).toLocaleString()}
          tone="neutral"
          loading={dataQ.isLoading}
        />
      </div>

      <div className="space-y-6">
        <Panel
          title="Feed & API status"
          description="Is each inbound connection live, when did we last receive data, and is it inside the expected cadence."
          bodyClassName="px-2 py-2"
        >
          <DataTable
            columns={feedCols}
            rows={feeds}
            getRowKey={(r) => r.id}
            loading={dataQ.isLoading}
            empty={
              <Instrument
                title="No inbound feed connected for this organization"
                description="Once a CRM/LOS feed or connector is registered, its status, last-received timestamp, cadence and health appear here automatically."
              />
            }
          />
        </Panel>

        <Panel
          title="Didn't go out — and why"
          description="Survey and record deliveries the pipeline rejected, with the recorded reason."
          bodyClassName="px-2 py-2"
        >
          <DataTable
            columns={jobCols}
            rows={failures}
            getRowKey={(r) => r.id}
            loading={dataQ.isLoading}
            empty={
              <Instrument
                title="No delivery failures recorded"
                description="Failures appear here once the feed runs and the pipeline logs rejected records for this organization."
              />
            }
          />
        </Panel>

        <Panel
          title="Volume audit — their CRM vs our feed"
          description="Reconcile the counts the client's system reports against what we actually ingested. Any non-zero variance is flagged."
          bodyClassName="px-2 py-2"
          actions={
            <Button
              variant="outline"
              size="sm"
              className="rounded-[10px] text-xs font-semibold"
              disabled={!(snap?.audit.length ?? 0)}
              onClick={() => csvExport(`${orgSlug}-volume-audit.csv`, snap?.audit ?? [])}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
          }
        >
          <DataTable
            columns={auditCols}
            rows={snap?.audit ?? []}
            getRowKey={(r, i) => `${r.provider}-${i}`}
            loading={dataQ.isLoading}
            empty={
              <Instrument
                title="Volume reconciliation not instrumented"
                description="We compare the client-reported CRM record count against ingested volume per source. Register a feed and report its source count to activate the audit."
              />
            }
          />
        </Panel>

        <Panel
          title="Record states"
          description="Every ingested record lands in one of these states. Scope: this organization."
          bodyClassName="px-6 py-5"
        >
          <div className="mb-5 flex flex-wrap gap-1.5">
            {RECORD_STATES.map((s) => (
              <button
                key={s}
                onClick={() => setTab(s)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                  tab === s
                    ? "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]"
                    : "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)] hover:text-ink",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-xs text-[color:var(--color-ink-3)]">
              {tab} — 0 records for this organization
            </p>
            <Button variant="outline" size="sm" className="rounded-[10px] text-xs font-semibold" disabled>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export
            </Button>
          </div>
          <Instrument
            title={`No ${tab.toLowerCase()} records yet`}
            description="Record-level states populate from the inbound feed once ingestion is instrumented for this organization. The tab, filter and export structure is already in place."
          />
        </Panel>
      </div>
    </XmpShell>
  );
}
