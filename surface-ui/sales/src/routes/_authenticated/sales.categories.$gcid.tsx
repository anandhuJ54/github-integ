import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Layers, Users } from "lucide-react";
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  Panel,
  StatTile,
} from "@v3/ui/components/console/primitives";
import { loadCategoryDashboard } from "@v3/sales/lib/sales-nav";

export const Route = createFileRoute("/_authenticated/sales/categories/$gcid")({
  head: () => ({
    meta: [
      { title: "Category dashboard — Experience.com Console" },
      { name: "description", content: "Real indexed volume, launch state and sample entities for one GBP category." },
      { property: "og:title", content: "Category dashboard — Experience.com Console" },
      { property: "og:description", content: "Locations, professionals and estimates for a single category." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CategoryDashboard,
});

const nf = new Intl.NumberFormat("en-US");

function CategoryDashboard() {
  const { gcid } = Route.useParams();
  const data = useQuery({ queryKey: ["sn-category", gcid], queryFn: () => loadCategoryDashboard(gcid) });
  const cat = data.data?.category;

  return (
    <PageBody>
      <PageHeader
        eyebrow="Growth Hub · Category"
        title={(cat?.display_name as string) ?? gcid}
        description={`${gcid} · status ${(cat?.status as string) ?? "unknown"} · entity type ${(cat?.entity_type as string) ?? "—"}`}
        actions={
          <Link
            to="/categories/$gcid"
            params={{ gcid }}
            className="text-xs font-semibold text-[color:var(--color-g-blue)] hover:underline"
          >
            Open category model
          </Link>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Indexed locations" tone="blue" icon={<Building2 className="h-4 w-4" />} loading={data.isLoading} value={nf.format(data.data?.orgCount ?? 0)} hint="organizations, demo excluded" />
        <StatTile label="Indexed professionals" tone="purple" icon={<Users className="h-4 w-4" />} loading={data.isLoading} value={nf.format(data.data?.proCount ?? 0)} hint="professionals, demo excluded" />
        <StatTile label="Estimated locations" tone="neutral" icon={<Layers className="h-4 w-4" />} loading={data.isLoading} value={cat?.estimated_locations != null ? nf.format(Number(cat.estimated_locations)) : "—"} hint="gbp_categories estimate" />
        <StatTile label="Estimated profiles" tone="neutral" icon={<Layers className="h-4 w-4" />} loading={data.isLoading} value={cat?.estimated_profiles != null ? nf.format(Number(cat.estimated_profiles)) : "—"} hint="gbp_categories estimate" />
      </div>

      <Panel title="Indexed entities" description="First 25 real organizations in this category." bodyClassName="px-3 py-2">
        <DataTable
          loading={data.isLoading}
          rows={data.data?.sampleOrgs ?? []}
          getRowKey={(r) => r.id as string}
          empty={<EmptyState title="No entities indexed in this category yet" compact />}
          columns={[
            {
              key: "n",
              header: "Name",
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
            { key: "c", header: "City", cell: (r) => [r.address_city, r.address_state].filter(Boolean).join(", ") || "—" },
            { key: "t", header: "Type", cell: (r) => (r.entity_type as string) ?? "—" },
            { key: "cl", header: "Claim", cell: (r) => (r.claimed ? "claimed" : "unclaimed") },
          ]}
        />
      </Panel>
    </PageBody>
  );
}
