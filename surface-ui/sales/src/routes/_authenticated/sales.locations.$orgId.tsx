import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, FlaskConical, Gauge, Users } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
function DemoBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-g-purple-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7b4ce0]">
      <FlaskConical className="h-3 w-3" /> demo
    </span>
  );
}
import { TerritoryChip } from "@v3/ui/components/sales/territory-chip";
import { loadBrandRollup, loadEventsFor, loadOrg, loadScore } from "@v3/sales/lib/sales-nav";

export const Route = createFileRoute("/_authenticated/sales/locations/$orgId")({
  head: () => ({
    meta: [
      { title: "Location dashboard — Experience.com Console" },
      { name: "description", content: "Analytics, ownership, activity and Search Rank Score for one location." },
      { property: "og:title", content: "Location dashboard — Experience.com Console" },
      { property: "og:description", content: "One location's real score, claims and activity." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LocationDashboard,
});

const nf = new Intl.NumberFormat("en-US");

function LocationDashboard() {
  const { orgId } = Route.useParams();
  const org = useQuery({ queryKey: ["sn-org", orgId], queryFn: () => loadOrg(orgId) });
  const rollup = useQuery({ queryKey: ["sn-brand-rollup", orgId], queryFn: () => loadBrandRollup(orgId) });
  const score = useQuery({ queryKey: ["sn-score", orgId], queryFn: () => loadScore(orgId) });
  const events = useQuery({
    queryKey: ["sn-loc-events", org.data?.name],
    queryFn: () => loadEventsFor({ location: (org.data?.name as string) ?? "" }),
    enabled: !!org.data?.name,
  });

  const parentId = org.data?.parent_org_id as string | null | undefined;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · Location"
        title={(org.data?.name as string) ?? "Location"}
        description={
          [org.data?.address_street, org.data?.address_city, org.data?.address_state]
            .filter(Boolean)
            .join(", ") || "Location record from organizations."
        }
        actions={
          <div className="flex items-center gap-2">
            {org.data?.is_demo ? <DemoBadge /> : null}
            <TerritoryChip territoryId={(org.data?.territory_id) as string | null} />
            {parentId ? (
              <Link
                to="/sales/brands/$orgId"
                params={{ orgId: parentId }}
                className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
              >
                Parent brand
              </Link>
            ) : null}
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
          label="Search Rank Score"
          tone={score.data ? "green" : "neutral"}
          icon={<Gauge className="h-4 w-4" />}
          loading={score.isLoading}
          value={score.data ? `${nf.format(score.data.total_score ?? 0)}/${nf.format(score.data.max_possible ?? 850)}` : "—"}
          hint={score.data ? "search_rank_scores" : "Not scored yet"}
        />
        <StatTile
          label="Professionals"
          tone="purple"
          icon={<Users className="h-4 w-4" />}
          loading={rollup.isLoading}
          value={nf.format(rollup.data?.proCount ?? 0)}
          hint="Attached to this location"
        />
        <StatTile
          label="Claim state"
          tone={org.data?.claimed ? "green" : "yellow"}
          icon={<BadgeCheck className="h-4 w-4" />}
          loading={org.isLoading}
          value={org.data?.claimed ? "Claimed" : "Unclaimed"}
          hint={org.data?.claimed_at ? `since ${(org.data.claimed_at as string).slice(0, 10)}` : "no claim recorded"}
        />
        <StatTile
          label="Category"
          tone="blue"
          value={(org.data?.gcid as string) ?? "—"}
          hint="gcid on the org record"
        />
      </div>

      <Panel title="Activity" description="exp_activity_events matched to this location." bodyClassName="px-3 py-2">
        <DataTable
          loading={events.isLoading}
          rows={events.data ?? []}
          getRowKey={(r) => r.id as string}
          empty={<EmptyState title="No recorded activity for this location" compact />}
          columns={[
            { key: "type", header: "Event", cell: (r) => (r.event_type as string) ?? "—" },
            { key: "logo", header: "Brand", cell: (r) => (r.logo as string) ?? "—" },
            {
              key: "when",
              header: "When",
              cell: (r) => (r.occurred_at ? (r.occurred_at as string).slice(0, 10) : "—"),
            },
            { key: "demo", header: "", cell: (r) => (r.is_demo ? <DemoBadge /> : null) },
          ]}
        />
      </Panel>
    </PageBody>
  );
}
