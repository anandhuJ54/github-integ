import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Grid3x3,
  Network,
  Rocket,
  TrendingUp,
  Globe2,
  ArrowRight,
  Info,
} from "lucide-react";
import type { ComponentType } from "react";
import { EmpLayout } from "@v3/ui/components/emp-layout";
import {
  PageBody,
  PageHeader,
  Panel,
  StatTile,
  EmptyState,
} from "@v3/ui/components/console/primitives";
import { num } from "@v3/ui/lib/console-surfaces";
import { loadReportMetrics } from "@v3/admin/lib/console-surfaces";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Experience.com Console" },
      {
        name: "description",
        content:
          "The index of every dashboard in the console — platform, revenue, launch program and demand engine — each with its live headline metric.",
      },
      { property: "og:title", content: "Reports — Experience.com Console" },
      {
        property: "og:description",
        content: "Every console dashboard with its live headline metric.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});

type Metrics = Awaited<ReturnType<typeof loadReportMetrics>>;

type ReportCard = {
  to: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  metrics: (m: Metrics) => { label: string; value: string }[];
};

const REPORTS: ReportCard[] = [
  {
    to: "/",
    title: "Platform health (Home)",
    description:
      "Category coverage, graph volume and scored entities — the top-level state of the Search Rank Platform.",
    icon: BarChart3,
    metrics: (m) => [
      { label: "Categories", value: num(m.categories) },
      { label: "Graph nodes", value: num(m.graphNodes) },
      { label: "Entities scored", value: num(m.scored) },
    ],
  },
  {
    to: "/categories",
    title: "Category intelligence",
    description:
      "The 4,000-category foundation: node registries, knowledge models, taxonomy, compliance and scoring per gcid.",
    icon: Grid3x3,
    metrics: (m) => [
      { label: "Categories", value: num(m.categories) },
      { label: "Launched", value: num(m.launched) },
      { label: "Field models", value: num(m.fieldModels) },
    ],
  },
  {
    to: "/professionals",
    title: "Profiles & graph",
    description:
      "Every professional and organization entity, their expertise graph nodes and real Search Rank Scores.",
    icon: Network,
    metrics: (m) => [
      { label: "Organizations", value: num(m.orgs) },
      { label: "Profiles", value: num(m.pros) },
      { label: "Registry nodes", value: num(m.registry) },
    ],
  },
  {
    to: "/sales",
    title: "Revenue & GTM",
    description:
      "The ALL ROADS navigator, seller performance board, margin-aware CPQ and compensation on net.",
    icon: TrendingUp,
    metrics: (m) => [
      { label: "Real contracts", value: num(m.contracts) },
      { label: "Entitlements active", value: num(m.entitlements) },
    ],
  },
  {
    to: "/dev",
    title: "Launch program",
    description:
      "Weighted readiness toward the Dec 1, 2026 Alpha, team-by-team board and the weekly reporting loop.",
    icon: Rocket,
    metrics: (m) => [
      { label: "Teams", value: num(m.devTeams) },
      { label: "Projects", value: num(m.devProjects) },
    ],
  },
  {
    to: "/website",
    title: "Demand engine",
    description:
      "CMS, tracked lead inbox with routing and SLA, campaigns, ads, trust centre and consent.",
    icon: Globe2,
    metrics: (m) => [
      { label: "Pages", value: num(m.pages) },
      { label: "Leads", value: num(m.leads) },
    ],
  },
];

function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["report-metrics"],
    queryFn: loadReportMetrics,
  });

  return (
    <EmpLayout>
      <PageBody>
        <PageHeader
          eyebrow="Admin"
          title="Reports"
          description="Every dashboard in the console, indexed with its live headline numbers so you can see where the signal is before you click. Each figure is a direct table read — nothing on this page is cached or estimated."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Categories"
            value={num(data?.categories)}
            hint={data ? `${num(data.launched)} product-launched` : undefined}
            icon={<Grid3x3 className="h-4 w-4" />}
            loading={isLoading}
          />
          <StatTile
            label="Graph nodes"
            value={num(data?.graphNodes)}
            hint="Live expertise graph"
            icon={<Network className="h-4 w-4" />}
            tone="purple"
            loading={isLoading}
          />
          <StatTile
            label="Entities scored"
            value={num(data?.scored)}
            hint="Rows in search_rank_scores"
            icon={<BarChart3 className="h-4 w-4" />}
            tone="green"
            loading={isLoading}
          />
          <StatTile
            label="Dashboards"
            value={num(REPORTS.length)}
            hint="Indexed below"
            icon={<ArrowRight className="h-4 w-4" />}
            tone="neutral"
          />
        </div>

        <div className="mt-8 space-y-6">
          <Panel
            title="Dashboard index"
            description="Live headline metrics per surface. Click through for the full report."
          >
            <div className="grid gap-4 md:grid-cols-2">
              {REPORTS.map((r) => {
                const Icon = r.icon;
                const metrics = data ? r.metrics(data) : [];
                return (
                  <Link
                    key={r.to}
                    to={r.to}
                    className="group rounded-[16px] border border-[color:var(--color-hairline)] p-5 transition-all hover:border-[color:var(--color-g-blue)] hover:shadow-[var(--shadow-md)]"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[color:var(--color-g-blue-soft)] text-[color:var(--color-g-blue)]">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold text-ink">{r.title}</h3>
                          <ArrowRight className="h-3.5 w-3.5 text-[color:var(--color-ink-3)] transition-transform group-hover:translate-x-0.5 group-hover:text-[color:var(--color-g-blue)]" />
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-[color:var(--color-ink-2)]">
                          {r.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-[color:var(--color-hairline)] pt-3">
                      {isLoading
                        ? Array.from({ length: 3 }).map((_, i) => (
                            <span
                              key={i}
                              className="h-8 w-16 animate-pulse rounded bg-[color:var(--color-surface-3)]"
                            />
                          ))
                        : metrics.map((m) => (
                            <div key={m.label}>
                              <p className="text-lg font-semibold leading-none text-ink">
                                {m.value}
                              </p>
                              <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-ink-3)]">
                                {m.label}
                              </p>
                            </div>
                          ))}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Panel>

          <Panel title="Scheduled & exported reports">
            <EmptyState
              icon={<Info className="h-4 w-4" />}
              title="Instrument to activate"
              description="Scheduled report delivery, CSV/PDF export and subscription lists are not wired yet — there is no report scheduler or delivery provider connected. Every dashboard above is live and can be read directly in the meantime."
              compact
            />
          </Panel>
        </div>
      </PageBody>
    </EmpLayout>
  );
}
