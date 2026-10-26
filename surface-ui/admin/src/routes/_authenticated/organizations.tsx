import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Building2, BadgeCheck, Gauge, Plug, ExternalLink } from "lucide-react";
import { api } from "@v3/state/api/server-fn";
import { EmpLayout } from "@v3/shared/components/ui/emp-layout";
import {
  PageBody,
  PageHeader,
  Panel,
  StatTile,
  DataTable,
  DetailDrawer,
  EmptyState,
  type Column,
} from "@v3/shared/components/ui/console-primitives";
import { Input } from "@v3/shared/components/ui/input";
import { Button } from "@v3/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v3/shared/components/ui/select";
import { num } from "@v3/shared/public/utils/console-surfaces";
import { loadOrgStats, ORG_COLUMNS, type OrgRow } from "@v3/admin/utils/console-surfaces";
import { cn } from "@v3/shared/components/utils/utils";

export const Route = createFileRoute("/_authenticated/organizations")({
  head: () => ({
    meta: [
      { title: "Organizations — Experience.com Console" },
      {
        name: "description",
        content:
          "Every organization entity on the platform: category, hierarchy depth, claim state, GBP connection and real Search Rank Score.",
      },
      { property: "og:title", content: "Organizations — Experience.com Console" },
      {
        property: "og:description",
        content: "Organization entities with claim state, hierarchy and real Search Rank Scores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrganizationsPage,
});

const PAGE_SIZE = 50;

const ENTITY_TONES: Record<string, string> = {
  brand: "bg-[color:var(--color-g-purple-soft)] text-[#7b4ce0]",
  franchise: "bg-[color:var(--color-g-purple-soft)] text-[#7b4ce0]",
  enterprise: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  firm: "bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]",
  office: "bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]",
  location: "bg-[color:var(--color-g-yellow-soft)] text-[#b06000]",
};

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        className ?? "bg-[color:var(--color-surface-3)] text-[color:var(--color-ink-2)]",
      )}
    >
      {children}
    </span>
  );
}

function ScoreCell({ score }: { score: number | null }) {
  if (score == null)
    return <span className="text-xs text-[color:var(--color-ink-3)]">not scored</span>;
  const pctOf = Math.round((score / 850) * 100);
  const tone =
    pctOf >= 70 ? "text-[#1e8e3e]" : pctOf >= 40 ? "text-[#b06000]" : "text-[#c5221f]";
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={cn("text-sm font-semibold tabular-nums", tone)}>{score}</span>
      <span className="text-[10px] text-[color:var(--color-ink-3)]">/850</span>
    </div>
  );
}

function OrganizationsPage() {
  const [search, setSearch] = useState("");
  const [gcidFilter, setGcidFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("real");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<OrgRow | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["org-stats"],
    queryFn: loadOrgStats,
  });

  const { data: gcidOptions } = useQuery({
    queryKey: ["org-gcid-options"],
    queryFn: () => api.get<string[]>("/admin/organizations/categories"),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["organizations", search, gcidFilter, statusFilter, scopeFilter, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api.get<{ rows: OrgRow[]; count: number }>("/admin/organizations", {
        params: { search, gcid: gcidFilter, status: statusFilter, scope: scopeFilter, page },
      }),
  });

  const rows = data?.rows ?? [];
  const total = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const reset = (fn: () => void) => {
    fn();
    setPage(0);
  };

  const columns: Column<OrgRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Organization",
        cell: (o) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">{o.name}</span>
              {o.is_demo ? <Chip className="bg-[color:var(--color-g-yellow-soft)] text-[#b06000]">Demo</Chip> : null}
              {!o.is_active ? <Chip className="bg-[color:var(--color-g-red-soft)] text-[#c5221f]">Inactive</Chip> : null}
            </div>
            <p className="mt-0.5 text-[11px] text-[color:var(--color-ink-3)]">
              {[o.address_city, o.address_state].filter(Boolean).join(", ") || "No location on file"}
            </p>
          </div>
        ),
      },
      {
        key: "entity",
        header: "Type",
        cell: (o) =>
          o.entity_type ? (
            <Chip className={ENTITY_TONES[o.entity_type]}>{o.entity_type}</Chip>
          ) : (
            <span className="text-[color:var(--color-ink-3)]">—</span>
          ),
      },
      {
        key: "gcid",
        header: "Category",
        cell: (o) => (
          <span className="font-mono text-[11px] text-[color:var(--color-ink-2)]">
            {o.gcid ?? "—"}
          </span>
        ),
      },
      {
        key: "depth",
        header: "Depth",
        align: "center",
        cell: (o) => (
          <span className="text-xs text-[color:var(--color-ink-2)]">{o.hierarchy_depth ?? "—"}</span>
        ),
      },
      {
        key: "claimed",
        header: "Claimed",
        align: "center",
        cell: (o) =>
          o.claimed ? (
            <Chip className="bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]">Claimed</Chip>
          ) : (
            <span className="text-xs text-[color:var(--color-ink-3)]">—</span>
          ),
      },
      {
        key: "gbp",
        header: "GBP",
        align: "center",
        cell: (o) =>
          o.gbp_connected ? (
            <Chip className="bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]">
              Connected
            </Chip>
          ) : (
            <span className="text-xs text-[color:var(--color-ink-3)]">—</span>
          ),
      },
      {
        key: "score",
        header: "Search Rank",
        align: "right",
        cell: (o) => <ScoreCell score={o.search_rank_score} />,
      },
    ],
    [],
  );

  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="Platform"
          title="Organizations"
          description="Every organization entity on the platform — brands, franchises, firms, offices and single-location businesses — with its category, hierarchy depth, claim state and real Search Rank Score. Scores come straight from the scoring engine; an entity with no score row reads “not scored” rather than a guess."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Organizations (real)"
            value={num(stats?.real)}
            hint={stats?.demo ? `${num(stats.demo)} demo excluded` : "No demo rows"}
            icon={<Building2 className="h-4 w-4" />}
            loading={statsLoading}
          />
          <StatTile
            label="Claimed"
            value={num(stats?.claimed)}
            hint="Owner has taken control of the profile"
            icon={<BadgeCheck className="h-4 w-4" />}
            tone="green"
            loading={statsLoading}
          />
          <StatTile
            label="Scored"
            value={num(stats?.scored)}
            hint="Have a Search Rank Score on file"
            icon={<Gauge className="h-4 w-4" />}
            tone="purple"
            loading={statsLoading}
          />
          <StatTile
            label="GBP connected"
            value={num(stats?.gbp)}
            hint="Google Business Profile linked"
            icon={<Plug className="h-4 w-4" />}
            tone={stats?.gbp ? "blue" : "neutral"}
            loading={statsLoading}
          />
        </div>

        <div className="mt-8">
          <Panel
            title="Directory"
            description={`${num(total)} matching ${total === 1 ? "organization" : "organizations"} — click a row for full detail.`}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => reset(() => setSearch(e.target.value))}
                  placeholder="Search by name…"
                  className="h-9 w-48"
                />
                <Select value={scopeFilter} onValueChange={(v) => reset(() => setScopeFilter(v))}>
                  <SelectTrigger className="h-9 w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="real">Real only</SelectItem>
                    <SelectItem value="demo">Demo only</SelectItem>
                    <SelectItem value="all">All rows</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => reset(() => setStatusFilter(v))}>
                  <SelectTrigger className="h-9 w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any status</SelectItem>
                    <SelectItem value="claimed">Claimed</SelectItem>
                    <SelectItem value="unclaimed">Unclaimed</SelectItem>
                    <SelectItem value="scored">Scored</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={gcidFilter} onValueChange={(v) => reset(() => setGcidFilter(v))}>
                  <SelectTrigger className="h-9 w-[190px]">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {(gcidOptions ?? []).map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
            bodyClassName="px-3 py-2"
          >
            <DataTable
              columns={columns}
              rows={rows}
              loading={isLoading}
              getRowKey={(o) => o.id}
              onRowClick={(o) => setSelected(o)}
              empty={
                <EmptyState
                  title="No organizations match"
                  description="Widen the filters — or switch scope to “All rows” to include demo records."
                  compact
                />
              }
            />
            {pages > 1 ? (
              <div className="flex items-center justify-between border-t border-[color:var(--color-hairline)] px-3 py-3">
                <p className="text-xs text-[color:var(--color-ink-3)]">
                  Page {page + 1} of {pages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page + 1 >= pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </Panel>
        </div>

        <DetailDrawer
          open={!!selected}
          onOpenChange={(o) => !o && setSelected(null)}
          title={selected?.name ?? ""}
          description={selected?.gcid ?? undefined}
        >
          {selected ? (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {selected.entity_type ? (
                  <Chip className={ENTITY_TONES[selected.entity_type]}>{selected.entity_type}</Chip>
                ) : null}
                {selected.claimed ? (
                  <Chip className="bg-[color:var(--color-g-green-soft)] text-[#1e8e3e]">Claimed</Chip>
                ) : (
                  <Chip>Unclaimed</Chip>
                )}
                {selected.is_demo ? (
                  <Chip className="bg-[color:var(--color-g-yellow-soft)] text-[#b06000]">
                    Demo record
                  </Chip>
                ) : null}
              </div>

              <div className="rounded-[16px] border border-[color:var(--color-hairline)] p-5 text-center">
                <p className="text-xs uppercase tracking-wider text-[color:var(--color-ink-3)]">
                  Search Rank Score
                </p>
                {selected.search_rank_score == null ? (
                  <>
                    <p className="mt-2 text-2xl font-semibold text-[color:var(--color-ink-3)]">—</p>
                    <p className="mt-1 text-xs text-[color:var(--color-ink-2)]">
                      Not scored yet — no row in search_rank_scores for this entity.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-3xl font-semibold text-ink">
                      {selected.search_rank_score}
                      <span className="text-base font-normal text-[color:var(--color-ink-3)]">
                        {" "}
                        / 850
                      </span>
                    </p>
                    {selected.score_updated_at ? (
                      <p className="mt-1 text-xs text-[color:var(--color-ink-3)]">
                        Updated {new Date(selected.score_updated_at).toLocaleDateString()}
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: "Category (gcid)", value: selected.gcid },
                  { label: "Hierarchy depth", value: selected.hierarchy_depth?.toString() },
                  {
                    label: "Location",
                    value: [selected.address_city, selected.address_state].filter(Boolean).join(", "),
                  },
                  { label: "Phone", value: selected.phone },
                  { label: "GBP connected", value: selected.gbp_connected ? "Yes" : "No" },
                  { label: "Active", value: selected.is_active ? "Yes" : "No" },
                ].map((f) => (
                  <div key={f.label}>
                    <dt className="text-xs text-[color:var(--color-ink-3)]">{f.label}</dt>
                    <dd className="mt-1 break-words text-ink">{f.value || "—"}</dd>
                  </div>
                ))}
              </dl>

              <div className="flex flex-wrap gap-2">
                {selected.slug ? (
                  <Link
                    to="/o/$slug"
                    params={{ slug: selected.slug }}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-g-blue)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    View public profile <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : null}
                {selected.website_url ? (
                  <a
                    href={selected.website_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-hairline)] px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-[color:var(--color-g-blue)] hover:text-[color:var(--color-g-blue)]"
                  >
                    Website <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </DetailDrawer>
      </PageBody>
    </EmpLayout>
  );
}
