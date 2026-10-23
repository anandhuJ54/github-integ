import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@v3/ui/lib/server-fn";
import { ExternalLink, Layers, ListOrdered, Map as MapIcon, Radar, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@v3/ui/components/ui/button";
import { Input } from "@v3/ui/components/ui/input";
import { Switch } from "@v3/ui/components/ui/switch";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { InstrumentNote, Pill } from "@v3/ui/components/website/bits";
import { ReadOnlyLock } from "@v3/ui/components/model-lock";
import { num } from "@v3/ui/lib/console-surfaces";
import { useRole } from "@v3/ui/lib/roles";
import {
  catLabel,
  HELD_PARTITION,
  INDEX_CONFIG_KEYS,
  loadIndexing,
  QUEUE_STATES,
  searchMutations,
  type IndexAgentRow,
  type IndexQueueRow,
  type SitemapPartitionRow,
  type SubmissionLogRow,
} from "@v3/search/lib/search-console";
import { setSiteIndexing } from "@v3/ui/lib/site-indexing.functions";


export const Route = createFileRoute("/_authenticated/search/indexing")({
  head: () => ({
    meta: [
      { title: "Indexing Agent — Search" },
      {
        name: "description",
        content:
          "Monitor and control the always-on auto-indexing agent: discovered, built, indexed and held-below-floor pages, plus the thoroughness-ranked index queue.",
      },
      { property: "og:title", content: "Indexing Agent — Search" },
      { property: "og:description", content: "Thorough pages go to the top of the crawl list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IndexingAgentPage,
});

function Funnel({ agent }: { agent: IndexAgentRow }) {
  const d = Number(agent.discovered ?? 0);
  const stages = [
    { label: "Discovered", value: d, tone: "bg-[color:var(--color-g-blue)]" },
    { label: "Built", value: Number(agent.built ?? 0), tone: "bg-[#7b4ce0]" },
    { label: "Indexed", value: Number(agent.indexed ?? 0), tone: "bg-[#1e8e3e]" },
  ];
  const max = Math.max(d, 1);
  const held = Number(agent.held_shallow ?? 0);

  return (
    <div className="space-y-2.5">
      {stages.map((s) => (
        <div key={s.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-[color:var(--color-ink-2)]">{s.label}</span>
            <span className="font-semibold text-ink">{num(s.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
            <div
              className={`h-full rounded-full ${s.tone}`}
              style={{ width: `${Math.min(100, (s.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 rounded-[10px] bg-[color:var(--color-g-yellow-soft)] px-3 py-2 text-xs text-[#b06000]">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-semibold">{num(held)}</span> held below floor (noindexed)
        </span>
      </div>
    </div>
  );
}

function ConfigField({
  label,
  hint,
  initial,
  disabled,
  onSave,
}: {
  label: string;
  hint: string;
  initial: string;
  disabled: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const dirty = value !== initial;
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <Input value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled} placeholder="Not set" />
        <Button size="sm" disabled={disabled || !dirty} onClick={() => onSave(value)}>
          Save
        </Button>
      </div>
      <p className="mt-1 text-xs text-[color:var(--color-ink-3)]">{hint}</p>
    </div>
  );
}

function IndexingAgentPage() {
  const role = useRole();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["search-indexing"], queryFn: loadIndexing });

  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => searchMutations.setAgentActive(v.id, v.active),
    onSuccess: (_r, v) => {
      toast.success(v.active ? "Agent switched on" : "Agent paused");
      void role.logAudit("index_agent_toggle", v.id, { active: v.active });
      void qc.invalidateQueries({ queryKey: ["search-indexing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rebuild = useMutation({
    mutationFn: searchMutations.rebuildSitemap,
    onSuccess: (r) => {
      toast.success("Sitemap partitions rebuilt");
      void role.logAudit("sitemap_rebuild", "exp_sitemap_partition", r as Record<string, unknown>);
      void qc.invalidateQueries({ queryKey: ["search-indexing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const tick = useMutation({
    mutationFn: () => searchMutations.submitTick(25),
    onSuccess: (r) => {
      const taken = Number((r as { taken?: number }).taken ?? 0);
      const skipped = (r as { skipped?: string }).skipped;
      toast.success(
        skipped === "site_indexing_disabled"
          ? "Indexing is OFF — nothing submitted"
          : skipped === "no_enabled_channel"
            ? "No submission channel enabled — nothing taken"
            : `${taken} page(s) submitted`,
      );
      void role.logAudit("index_submit_tick", "exp_index_queue", r as Record<string, unknown>);
      void qc.invalidateQueries({ queryKey: ["search-indexing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: searchMutations.syncQueue,
    onSuccess: (r) => {
      toast.success("Queue synced from scores and completeness");
      void role.logAudit("index_sync", "exp_index_queue", r as Record<string, unknown>);
      void qc.invalidateQueries({ queryKey: ["search-indexing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveConfig = useMutation({
    mutationFn: (v: { key: string; value: string }) => searchMutations.setIndexConfig(v.key, v.value),
    onSuccess: (_r, v) => {
      toast.success("Saved");
      void role.logAudit("index_config_set", v.key, { set: v.value.length > 0 });
      void qc.invalidateQueries({ queryKey: ["search-indexing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setSwitch = useServerFn(setSiteIndexing);
  const flip = useMutation({
    mutationFn: (enabled: boolean) => setSwitch({ data: { enabled } }),
    onSuccess: (r) => {
      toast.success(r.enabled ? "Site indexing switched ON" : "Site indexing switched OFF");
      void qc.invalidateQueries({ queryKey: ["search-indexing"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const site = data?.siteIndexing;
  const siteOn = site?.enabled === true;

  const labels = data?.labels ?? new globalThis.Map<string, string>();
  const agents = data?.agents ?? [];
  const queue = data?.queue ?? [];
  const partitions = data?.partitions ?? [];
  const log = data?.log ?? [];
  const config = data?.config;
  const t = data?.totals;
  const coverage = data?.coverage ?? QUEUE_STATES.map((state) => ({ state, count: null }));
  const coverageTone: Record<string, "yellow" | "green" | "purple" | undefined> = {
    held: "yellow",
    submitted: "purple",
    indexed: "green",
  };

  return (
    <PageBody>
      <PageHeader
        eyebrow="Search · Indexing agent"
        title="Auto-indexing agent"
        description="The always-on agent that discovers entities, builds pages and submits them for indexing. Pages below the completeness floor are held back and noindexed."
        actions={role.isReadOnly ? <ReadOnlyLock /> : undefined}
      />

      <Panel
        className="mb-6"
        title={siteOn ? "Indexing is ON" : "Indexing is OFF (testing)"}
        description={
          siteOn
            ? "Pages that pass the completeness floor are submitted, listed in the sitemap and open to crawlers."
            : "Nothing is submitted, sitemap empty, robots Disallow /. Every page carries noindex,nofollow. Sync and sitemap rebuild still run so this console shows what would be indexed."
        }
        actions={
          <div className="flex items-center gap-2">
            <Pill value={siteOn ? "on" : "off"} />
            <Switch
              checked={siteOn}
              disabled={!role.isSuperAdmin || isLoading || flip.isPending}
              onCheckedChange={(v) => {
                const msg = v
                  ? "Turn site indexing ON? Pages become indexable, the sitemap fills and the submit tick may ping search engines."
                  : "Turn site indexing OFF? Every page becomes noindex and the sitemap empties.";
                if (window.confirm(msg)) flip.mutate(v);
              }}
              aria-label="Site indexing"
            />
          </div>
        }
      >
        <div className="flex items-center gap-2 text-xs text-[color:var(--color-ink-3)]">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
          <span>
            exp_index_config.site_indexing_enabled = {siteOn ? "true" : "false"}
            {site?.seeded === false ? " (not seeded — reads as OFF)" : ""}
            {site?.updatedAt ? ` · updated ${new Date(site.updatedAt).toLocaleString()}` : ""}
            {role.isSuperAdmin ? "" : " · super admin only"}
          </span>
        </div>
      </Panel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Active agents"
          value={`${num(t?.active ?? 0)} / ${num(agents.length)}`}
          icon={<Radar className="h-4 w-4" />}
          loading={isLoading}
        />
        <StatTile label="Discovered" value={num(t?.discovered ?? null)} loading={isLoading} />
        <StatTile label="Built" value={num(t?.built ?? null)} tone="purple" loading={isLoading} />
        <StatTile label="Indexed" value={num(t?.indexed ?? null)} tone="green" loading={isLoading} />
        <StatTile
          label="Held below floor"
          value={num(t?.held ?? null)}
          hint="Shallow — noindexed until complete"
          tone="yellow"
          loading={isLoading}
        />
      </div>

      <Panel
        className="mt-6"
        title="Queue coverage"
        description="Every queued page by state. Held = below the category completeness floor or demo — the same floor that noindexes the page. Submitted means pinged, not confirmed indexed."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!role.canEdit || sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
            Sync from scores
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {coverage.map((c) => (
            <StatTile
              key={c.state}
              label={c.state}
              value={num(c.count)}
              tone={coverageTone[c.state]}
              loading={isLoading}
            />
          ))}
        </div>
      </Panel>

      {isLoading ? null : agents.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Radar className="h-4 w-4" />}
            title="No indexing agents registered"
            description="Instrument to activate — an agent row per category drives discovery, build and submission."
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Panel
              key={a.id}
              title={catLabel(labels, a.gcid)}
              description={a.last_run_at ? `Last run ${new Date(a.last_run_at).toLocaleString()}` : "Never run"}
              actions={
                <div className="flex items-center gap-2">
                  <Pill value={a.phase ?? "idle"} />
                  <Switch
                    checked={!!a.active}
                    disabled={!role.canEdit || toggle.isPending}
                    onCheckedChange={(v) => toggle.mutate({ id: a.id, active: v })}
                    aria-label="Agent active"
                  />
                </div>
              }
            >
              <div className="mb-4 grid grid-cols-4 gap-2 text-center">
                {[
                  { l: "Discovered", v: a.discovered },
                  { l: "Built", v: a.built },
                  { l: "Indexed", v: a.indexed },
                  { l: "Held", v: a.held_shallow },
                ].map((s) => (
                  <div key={s.l} className="rounded-[12px] bg-[color:var(--color-surface-2)] px-2 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-ink-3)]">
                      {s.l}
                    </p>
                    <p className="mt-1 text-lg font-semibold leading-none text-ink">{num(s.v)}</p>
                  </div>
                ))}
              </div>
              <Funnel agent={a} />
            </Panel>
          ))}
        </div>
      )}

      <Panel
        className="mt-6"
        title="Index queue"
        description="Ranked by thoroughness — the most complete pages go to the top of the crawl list."
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--color-ink-3)]">
            <ListOrdered className="h-3.5 w-3.5" /> {num(queue.length)} queued
          </span>
        }
        bodyClassName="px-3 py-2"
      >
        <DataTable<IndexQueueRow>
          columns={[
            {
              key: "entity",
              header: "Entity",
              cell: (r) => (
                <div className="min-w-0">
                  <div className="font-medium text-ink">{r.entity_type ?? "—"}</div>
                  <div className="truncate text-xs text-[color:var(--color-ink-3)]">{r.entity_id ?? "—"}</div>
                </div>
              ),
            },
            {
              key: "url",
              header: "URL",
              cell: (r) =>
                r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[color:var(--color-g-blue)] hover:underline"
                  >
                    <span className="max-w-[280px] truncate">{r.url}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  "—"
                ),
            },
            { key: "cat", header: "Category", cell: (r) => catLabel(labels, r.gcid) },
            { key: "score", header: "Score", align: "right", cell: (r) => num(r.score) },
            {
              key: "thorough",
              header: "Thoroughness",
              align: "right",
              cell: (r) => (
                <div className="flex items-center justify-end gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[color:var(--color-surface-3)]">
                    <div
                      className="h-full rounded-full bg-[color:var(--color-g-blue)]"
                      style={{ width: `${Math.min(100, Number(r.thoroughness_pct ?? 0))}%` }}
                    />
                  </div>
                  <span className="font-semibold text-ink">{num(r.thoroughness_pct)}%</span>
                </div>
              ),
            },
            { key: "state", header: "State", cell: (r) => <Pill value={r.state} /> },
            { key: "method", header: "Method", cell: (r) => r.method ?? "—" },
          ]}
          rows={queue}
          getRowKey={(r) => r.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Layers className="h-4 w-4" />}
              title="Index queue is empty"
              description="Instrument to activate — the agent writes each built page here with its thoroughness score."
            />
          }
        />
      </Panel>

      <Panel
        className="mt-6"
        title="Sitemap partitions"
        description="Score-banded sitemaps rebuilt from the queue. Pages below the completeness floor stay in the held partition and are never emitted into an indexable sitemap."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!role.canEdit || rebuild.isPending}
            onClick={() => rebuild.mutate()}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${rebuild.isPending ? "animate-spin" : ""}`} />
            Rebuild now
          </Button>
        }
        bodyClassName="px-3 py-2"
      >
        <DataTable<SitemapPartitionRow>
          columns={[
            {
              key: "partition",
              header: "Partition",
              cell: (r) => (
                <div className="flex items-center gap-2">
                  <MapIcon className="h-3.5 w-3.5 text-[color:var(--color-ink-3)]" />
                  <span className="font-medium text-ink">{r.partition_key}</span>
                  {r.partition_key === HELD_PARTITION ? <Pill value="noindex" /> : null}
                </div>
              ),
            },
            { key: "band", header: "Score band", cell: (r) => `${num(r.min_score)}–${num(r.max_score)}` },
            { key: "freq", header: "Changefreq", cell: (r) => r.changefreq ?? "—" },
            { key: "prio", header: "Priority", align: "right", cell: (r) => Number(r.priority ?? 0).toFixed(1) },
            { key: "count", header: "URLs", align: "right", cell: (r) => num(r.url_count) },
            {
              key: "built",
              header: "Last built",
              cell: (r) => (r.last_built_at ? new Date(r.last_built_at).toLocaleString() : "Never"),
            },
            {
              key: "xml",
              header: "XML",
              cell: (r) =>
                r.partition_key === HELD_PARTITION ? (
                  <span className="text-[color:var(--color-ink-3)]">excluded</span>
                ) : (
                  <a
                    href={`/api/public/sitemap/${r.partition_key}.xml`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[color:var(--color-g-blue)] hover:underline"
                  >
                    open <ExternalLink className="h-3 w-3" />
                  </a>
                ),
            },
          ]}
          rows={partitions}
          getRowKey={(r) => r.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<MapIcon className="h-4 w-4" />}
              title="No partitions defined"
              description="Instrument to activate — partitions are score bands over the index queue."
            />
          }
        />
        <p className="px-1 py-2 text-xs text-[color:var(--color-ink-3)]">
          Sitemap index:{" "}
          <a
            href="/api/public/sitemap.xml"
            target="_blank"
            rel="noreferrer"
            className="text-[color:var(--color-g-blue)] hover:underline"
          >
            /api/public/sitemap.xml
          </a>
        </p>
      </Panel>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          title="Submission log"
          description="Every IndexNow and Google Indexing attempt, exactly as the database recorded it."
          actions={
            <Button
              variant="outline"
              size="sm"
              disabled={!role.canEdit || tick.isPending}
              onClick={() => tick.mutate()}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" /> Run tick (25)
            </Button>
          }
          bodyClassName="px-3 py-2"
        >
          <DataTable<SubmissionLogRow>
            columns={[
              {
                key: "url",
                header: "URL",
                cell: (r) => <span className="block max-w-[260px] truncate">{r.url ?? "—"}</span>,
              },
              { key: "cat", header: "Category", cell: (r) => catLabel(labels, r.gcid) },
              { key: "method", header: "Method", cell: (r) => r.method ?? "—" },
              { key: "event", header: "Event", cell: (r) => <Pill value={r.event ?? "—"} /> },
              {
                key: "status",
                header: "HTTP",
                align: "right",
                cell: (r) => (r.http_status == null ? "—" : num(r.http_status)),
              },
              {
                key: "at",
                header: "When",
                cell: (r) => (r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"),
              },
            ]}
            rows={log}
            getRowKey={(r) => r.id}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<Send className="h-4 w-4" />}
                title="No submissions yet"
                description="Instrument to activate — the submission tick writes one row per method per page."
              />
            }
          />
        </Panel>

        <Panel
          title="Submission credentials"
          description="Without an enabled channel the tick takes nothing and pages stay pending — nothing is faked."
        >
          <div className="space-y-4">
            {INDEX_CONFIG_KEYS.map((f) => (
              <ConfigField
                key={f.key}
                label={f.label}
                hint={f.hint}
                initial={config?.get(f.key) ?? ""}
                disabled={!role.canEdit || saveConfig.isPending}
                onSave={(value) => saveConfig.mutate({ key: f.key, value })}
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4">

        <InstrumentNote>
          Counts are the agent's own state rows. Submission delivery and crawl confirmation appear once the search
          submission connector reports back.
        </InstrumentNote>
      </div>
    </PageBody>
  );
}
