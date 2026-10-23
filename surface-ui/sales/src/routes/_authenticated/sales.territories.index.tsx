import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Layers, Map as MapIcon, Users } from "lucide-react";
import { AllTerritoriesTab, ReviewQueueTab } from "@v3/sales/components/sales/territories-admin";
import { TerritoryAdminPanel } from "@v3/sales/components/sales/territory-admin-panel";
import {
  ConsoleTabs,
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { loadGroupsOverview, type GroupOverview } from "@v3/sales/lib/category-groups";
import { loadTerritoryRules, routingExplainer } from "@v3/ui/lib/territories";

export const Route = createFileRoute("/_authenticated/sales/territories/")({
  head: () => ({
    meta: [
      { title: "Category-group territories — Experience.com Console" },
      {
        name: "description",
        content:
          "Every sales team owns a bundle of categories: group volume, territory slots, assignment coverage and team quota attainment.",
      },
      { property: "og:title", content: "Category-group territories — Experience.com Console" },
      {
        property: "og:description",
        content: "Groups, territory slots, seller coverage and consolidated team quota.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GroupsListPage,
});

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function DemoChip() {
  return (
    <span className="rounded-full bg-[#fff4d6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8a5a00]">
      Demo
    </span>
  );
}

function GroupsListPage() {
  const groups = useQuery({ queryKey: ["cat-groups-overview"], queryFn: loadGroupsOverview });
  const rules = useQuery({ queryKey: ["territory-rules"], queryFn: loadTerritoryRules });
  const rows = groups.data ?? [];

  const totals = {
    members: rows.reduce((s, g) => s + g.members, 0),
    territories: rows.reduce((s, g) => s + g.territories, 0),
    assigned: rows.reduce((s, g) => s + g.assigned, 0),
    agents: rows.reduce((s, g) => s + g.agents, 0),
  };
  const explain = routingExplainer(rules.data ?? []);

  const groupsView = (
    <>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Category groups"
          tone="blue"
          icon={<Layers className="h-4 w-4" />}
          loading={groups.isLoading}
          value={nf.format(rows.length)}
          hint={`${nf.format(totals.members)} member categories`}
        />
        <StatTile
          label="Territory slots"
          tone="purple"
          icon={<MapIcon className="h-4 w-4" />}
          loading={groups.isLoading}
          value={nf.format(totals.territories)}
          hint={`${nf.format(totals.assigned)} assigned · ${nf.format(totals.territories - totals.assigned)} open`}
        />
        <StatTile
          label="Agents in scope"
          tone="green"
          icon={<Users className="h-4 w-4" />}
          loading={groups.isLoading}
          value={nf.format(totals.agents)}
          hint="summed from generated territory volume"
        />
        <StatTile
          label="Launch-priority groups"
          tone="yellow"
          loading={groups.isLoading}
          value={nf.format(rows.filter((g) => g.is_launch_priority).length)}
          hint="flagged is_launch_priority"
        />
      </div>

      <Panel
        title="Groups"
        description="Click a group to manage its member categories, territory slots and seller onboarding."
        bodyClassName="px-3 py-2"
      >
        <DataTable<GroupOverview>
          loading={groups.isLoading}
          rows={rows}
          getRowKey={(g) => g.group_key}
          empty={<EmptyState title="No category groups yet" description="Create rows in exp_category_groups to activate." compact />}
          columns={[
            {
              key: "label",
              header: "Group",
              cell: (g) => (
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/sales/territories/$groupKey"
                    params={{ groupKey: g.group_key }}
                    className="font-medium text-[color:var(--color-g-blue)] hover:underline"
                  >
                    {g.label}
                  </Link>
                  {g.is_catchall ? (
                    <span className="rounded-full bg-[color:var(--color-surface-3)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                      Catch-all
                    </span>
                  ) : null}
                  {g.is_launch_priority ? (
                    <span className="rounded-full bg-[#e7f5ec] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#1e8e3e]">
                      Launch priority
                    </span>
                  ) : null}
                  {g.isDemo ? <DemoChip /> : null}
                </span>
              ),
            },
            { key: "m", header: "Categories", align: "right", cell: (g) => nf.format(g.members) },
            { key: "b", header: "Brands", align: "right", cell: (g) => nf.format(g.brands) },
            { key: "o", header: "Offices", align: "right", cell: (g) => nf.format(g.offices) },
            { key: "a", header: "Agents", align: "right", cell: (g) => nf.format(g.agents) },
            {
              key: "t",
              header: "Territories",
              align: "right",
              cell: (g) =>
                g.territories ? `${g.assigned} / ${g.territories} assigned` : "—",
            },
            {
              key: "q",
              header: "Team quota",
              align: "right",
              cell: (g) => (g.quotaTarget ? cf.format(g.quotaTarget) : "—"),
            },
            {
              key: "att",
              header: "Attainment",
              align: "right",
              cell: (g) =>
                g.attainment == null ? (
                  "—"
                ) : (
                  <span
                    className={
                      g.attainment >= 100
                        ? "font-semibold text-[#1e8e3e]"
                        : g.attainment >= 80
                          ? "font-semibold text-[#b06000]"
                          : "font-semibold text-[#c5221f]"
                    }
                  >
                    {Math.round(g.attainment)}%
                  </span>
                ),
            },
          ]}
        />
      </Panel>

      <Panel
        className="mt-6"
        title="Lead routing rules"
        description="Derived from exp_territory_rules — read-only here; thresholds are governed in the data model."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {explain.map((e) => (
            <div key={e.lane} className="rounded-xl border border-[color:var(--color-hairline)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-ink-3)]">
                {e.lane} lane
              </p>
              <p className="mt-1 text-sm font-medium text-ink">{e.trigger}</p>
              <p className="mt-1 text-sm text-[color:var(--color-ink-2)]">→ {e.destination}</p>
              <p className="mt-1 text-xs text-[color:var(--color-ink-3)]">{e.fallback}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[color:var(--color-ink-3)]">
          Any lead from a category that belongs to no group yet routes to the vertical-agnostic
          catch-all group (_catchall).
        </p>
      </Panel>
    </>
  );

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · Territories"
        title="Territories"
        description="Every logo has two owners: a Seller for the logo deal and an SRE for its individuals and offices. One owner per lane."
      />
      <ConsoleTabs
        defaultValue="all"
        tabs={[
          { value: "all", label: "All Territories", content: <AllTerritoriesTab /> },
          { value: "groups", label: "Category groups", content: groupsView },
          { value: "review", label: "Review queue", content: <ReviewQueueTab /> },
          { value: "admin", label: "Admin", content: <TerritoryAdminPanel /> },
        ]}
      />
    </PageBody>
  );
}
