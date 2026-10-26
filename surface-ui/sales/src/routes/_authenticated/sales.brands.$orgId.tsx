import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Building2, FlaskConical, Gauge, MapPin, Users } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/shared/components/ui/console-primitives";
function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-purple-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7b4ce0]">
      <FlaskConical className="h-3 w-3" /> demo
    </span>
  );
}
import { TerritoryChip } from "@v3/sales/components/sales/territory-chip";
import { loadBrandRollup, loadEventsFor, loadOrg, loadScore } from "@v3/sales/utils/sales-nav";

export const Route = createFileRoute("/_authenticated/sales/brands/$orgId")({
  head: () => ({
    meta: [
      { title: "Brand dashboard — Experience.com Console" },
      { name: "description", content: "Rolled-up analytics, ownership and activity for a brand and its locations." },
      { property: "og:title", content: "Brand dashboard — Experience.com Console" },
      { property: "og:description", content: "Locations, professionals, claims and score for one brand." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrandDashboard,
});

const nf = new Intl.NumberFormat("en-US");

function BrandDashboard() {
  const { orgId } = Route.useParams();
  const org = useQuery({ queryKey: ["sn-org", orgId], queryFn: () => loadOrg(orgId) });
  const rollup = useQuery({ queryKey: ["sn-brand-rollup", orgId], queryFn: () => loadBrandRollup(orgId) });
  const score = useQuery({ queryKey: ["sn-score", orgId], queryFn: () => loadScore(orgId) });
  const events = useQuery({
    queryKey: ["sn-brand-events", org.data?.name],
    queryFn: () => loadEventsFor({ logo: (org.data?.name as string) ?? "" }),
    enabled: !!org.data?.name,
  });

  const claimedLocations = rollup.data?.claimedLocations ?? 0;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · Brand"
        title={(org.data?.name as string) ?? "Brand"}
        description={
          [org.data?.address_city, org.data?.address_state].filter(Boolean).join(", ") ||
          "Parent brand rolled up across its locations and professionals."
        }
        actions={
          <div className="flex items-center gap-2">
            {org.data?.is_demo ? <DemoBadge /> : null}
            <TerritoryChip territoryId={(org.data?.territory_id) as string | null} />
            {org.data?.slug ? (
              <>
                <Link
                  to="/o/$slug"
                  params={{ slug: org.data.slug as string }}
                  className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
                >
                  Public profile
                </Link>
                <Link
                  to="/o/$slug/graph"
                  params={{ slug: org.data.slug as string }}
                  className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
                >
                  View Graph
                </Link>
              </>
            ) : null}
          </div>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Locations"
          tone="blue"
          icon={<MapPin className="h-4 w-4" />}
          loading={rollup.isLoading}
          value={nf.format(rollup.data?.childCount ?? 0)}
          hint="Direct children in organizations"
        />
        <StatTile
          label="Professionals"
          tone="purple"
          icon={<Users className="h-4 w-4" />}
          loading={rollup.isLoading}
          value={nf.format(rollup.data?.proCount ?? 0)}
          hint="At this brand or one of its offices"
        />
        <StatTile
          label="Claimed locations"
          tone="green"
          icon={<BadgeCheck className="h-4 w-4" />}
          loading={rollup.isLoading}
          value={nf.format(claimedLocations)}
          hint={`${nf.format(rollup.data?.claimedProfessionals ?? 0)} professionals claimed · from claim events`}
        />
        <StatTile
          label="Search Rank Score"
          tone={score.data ? "green" : "neutral"}
          icon={<Gauge className="h-4 w-4" />}
          loading={score.isLoading}
          value={score.data ? `${nf.format(score.data.total_score ?? 0)}/${nf.format(score.data.max_possible ?? 850)}` : "—"}
          hint={score.data ? "search_rank_scores" : "Not scored yet"}
        />
      </div>

      <Panel title="Locations" description="Click through to any location's dashboard." bodyClassName="px-3 py-2">
        <DataTable
          loading={rollup.isLoading}
          rows={rollup.data?.locations ?? []}
          getRowKey={(r) => r.id as string}
          empty={<EmptyState icon={<Building2 className="h-4 w-4" />} title="No child locations" compact />}
          columns={[
            {
              key: "name",
              header: "Location",
              cell: (r) => (
                <Link
                  to="/sales/locations/$orgId"
                  params={{ orgId: r.id as string }}
                  className="font-medium text-[color:var(--color-g-blue)] hover:underline"
                >
                  {r.name as string}
                </Link>
              ),
            },
            {
              key: "city",
              header: "City",
              cell: (r) => [r.address_city, r.address_state].filter(Boolean).join(", ") || "—",
            },
            { key: "type", header: "Type", cell: (r) => (r.entity_type as string) ?? "—" },
            {
              key: "claim",
              header: "Claim",
              cell: (r) => (
                <span className="flex items-center gap-2">
                  {r.claimed ? "claimed" : "unclaimed"}
                  {r.is_demo ? <DemoBadge /> : null}
                </span>
              ),
            },
          ]}
        />
      </Panel>

      <div className="mt-6">
        <Panel title="Activity" description="exp_activity_events matched to this brand as logo." bodyClassName="px-3 py-2">
          <DataTable
            loading={events.isLoading}
            rows={events.data ?? []}
            getRowKey={(r) => r.id as string}
            empty={<EmptyState title="No recorded activity for this brand" compact />}
            columns={[
              { key: "type", header: "Event", cell: (r) => (r.event_type as string) ?? "—" },
              { key: "loc", header: "Location", cell: (r) => (r.location as string) ?? "—" },
              {
                key: "when",
                header: "When",
                cell: (r) => (r.occurred_at ? (r.occurred_at as string).slice(0, 10) : "—"),
              },
              { key: "demo", header: "", cell: (r) => (r.is_demo ? <DemoBadge /> : null) },
            ]}
          />
        </Panel>
      </div>
    </PageBody>
  );
}
